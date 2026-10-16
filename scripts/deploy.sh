#!/usr/bin/env bash
# Deploys DINO on the server this repo is checked out on (prod):
#
#   1. git pull (fast-forward only)
#   2. makes sure the OAuth JWT signing key is in .env (the app will not start
#      without it); generates one if missing, never printing it
#   3. backs up the database and applies pending migrations (scripts/migrate.sh)
#   4. rebuilds and restarts dino-app, then checks it answers
#
#   bash scripts/deploy.sh              asks before each step that changes something
#   bash scripts/deploy.sh --yes        no questions
#   bash scripts/deploy.sh --no-backup  skip the backup (only if you just took one)
#
# New migrations are listed in scripts/migrate.sh.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

YES=false
BACKUP=true
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    --no-backup) BACKUP=false ;;
    *) echo "usage: $0 [--yes] [--no-backup]" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31mdeploy: %s\033[0m\n' "$1" >&2; exit 1; }
confirm() {
  $YES && return 0
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "stopped"
}

[ -f .env ] || fail ".env not found in $PROJECT_DIR"
docker compose ps db --status running -q | grep -q . || fail "the db container is not running"

step "1. Pull"
git fetch --quiet
echo "on $(git rev-parse --abbrev-ref HEAD) at $(git rev-parse --short HEAD); incoming:"
git log --oneline HEAD..@{u} || true
git pull --ff-only || fail "git pull failed (local changes or diverged). Fix by hand, then run again."

step "2. OAuth signing key"
if grep -q '^OAUTH_JWT_PRIVATE_KEY=' .env && grep -q '^OAUTH_JWT_KEY_ID=' .env; then
  echo "present in .env ($(grep '^OAUTH_JWT_KEY_ID=' .env))"
else
  grep -q '^OAUTH_JWT_PRIVATE_KEY=\|^OAUTH_JWT_KEY_ID=' .env && fail "only one of OAUTH_JWT_PRIVATE_KEY / OAUTH_JWT_KEY_ID is in .env; fix by hand"
  confirm "No JWT signing key in .env. Generate one now?"
  cp .env ".env.bak.$(date +%Y%m%d_%H%M%S)"
  KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | awk 'BEGIN{ORS="\\n"} {print}')
  [ -n "$KEY" ] || fail "openssl did not produce a key"
  printf '\nOAUTH_JWT_PRIVATE_KEY="%s"\nOAUTH_JWT_KEY_ID=%s\n' "$KEY" "prod-$(date +%Y%m%d)" >> .env
  unset KEY
  echo "added (kid prod-$(date +%Y%m%d)); the old .env is kept as .env.bak.*"
fi

step "3. Backup and migrations"
migrate_args=()
$YES && migrate_args+=(--yes)
$BACKUP || migrate_args+=(--no-backup)
bash scripts/migrate.sh "${migrate_args[@]}"

step "4. Build and restart"
confirm "Rebuild and restart dino-app?"
docker compose build dino-app
docker compose up -d dino-app

echo "waiting for the app"
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null http://localhost:3000/oauth/jwks 2>/dev/null && break
  sleep 2
done
curl -fsS -o /dev/null http://localhost:3000/oauth/jwks || {
  docker compose logs --tail 40 dino-app
  fail "the app is not answering on :3000 (logs above)"
}
curl -fsS http://localhost:3000/.well-known/oauth-authorization-server | grep -q client_credentials \
  || fail "the app is up but is not serving the new OAuth metadata"
echo "app is up; JWKS and metadata OK"

printf '\n\033[32mDeployed %s\033[0m\n' "$(git rev-parse --short HEAD)"
echo "Next: add the Kerf clients at /admin/oauth (docs/KERF-SSO.md), then click-test sign-in."
