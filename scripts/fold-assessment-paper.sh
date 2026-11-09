#!/usr/bin/env bash
# Folds old assessment papers into assessment-paper activities, running
# scripts/fold-assessment-papers.ts in a throwaway container beside the app.
#
#   bash scripts/fold-assessment-paper.sh scripts/fold-mappings/systems-assessment-1.json            dry run
#   bash scripts/fold-assessment-paper.sh scripts/fold-mappings/systems-assessment-1.json --apply    do it
#
# Run from the project directory on the server, with the app (dino-app) and
# the database (db) up. The result is printed and saved under fold-results/.
# Re-running is safe: nothing already folded is created twice. The old
# assessment tables are only read, except that each folded paper is set
# inactive at the end (it leaves Group Progress; re-activate to undo).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

fail() { printf '\033[31mfold-assessment-paper: %s\033[0m\n' "$1" >&2; exit 1; }

[ $# -ge 1 ] || fail "usage: $0 <mapping.json> [--apply]"
MAPPING="$1"; shift
APPLY=""
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY="--apply" ;;
    *) fail "unknown argument $arg" ;;
  esac
done
case "$MAPPING" in scripts/fold-mappings/*.json) ;; *) fail "the mapping must be in scripts/fold-mappings/" ;; esac
[ -f "$MAPPING" ] || fail "no mapping at $MAPPING"
[ -f .env ] || fail "no .env in $PROJECT_DIR"
docker compose ps db --status running -q | grep -q . || fail "the db container is not running"
docker compose ps dino-app --status running -q | grep -q . || fail "the dino-app container is not running"

# Files are written as the app's own user, so the app can read and remove them.
APP_UID="$(docker compose exec -T dino-app id -u)"
APP_GID="$(docker compose exec -T dino-app id -g)"

if ! docker image inspect dino-deps >/dev/null 2>&1; then
  echo "Building the dino-deps image (once)..."
  docker build -q --target deps -f Dockerfile-dino -t dino-deps . >/dev/null
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/stub/server-only" "$WORK/out"
echo 'module.exports = {}' > "$WORK/stub/server-only/index.js"
echo '{"name":"server-only","main":"index.js"}' > "$WORK/stub/server-only/package.json"
chmod -R a+rX "$WORK" && chmod a+w "$WORK/out"

NETWORK="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(docker compose ps -q db)" | awk '{print $1}')"

docker run --rm --network "$NETWORK" --env-file .env \
  -v "$PROJECT_DIR/src:/app/src:ro" -v "$PROJECT_DIR/scripts:/app/scripts:ro" \
  -v "$PROJECT_DIR/tsconfig.json:/app/tsconfig.json:ro" -v "$PROJECT_DIR/files:/app/files" \
  -v "$WORK/stub:/stub:ro" -v "$WORK/out:/out" \
  -e APP_UID="$APP_UID" -e APP_GID="$APP_GID" -e MAPPING="$MAPPING" -e APPLY="$APPLY" \
  dino-deps sh -c '
    set -e
    apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq poppler-utils >/dev/null 2>&1
    export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/dino?sslmode=disable"
    export MARKING_QUEUE_SECRET= NODE_PATH=/stub HOME=/tmp
    cd /app
    exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --clear-groups env HOME=/tmp \
      npx -y tsx scripts/fold-assessment-papers.ts --mapping "$MAPPING" $APPLY --out /out/result.json >/dev/null
  '

mkdir -p fold-results
RESULT="fold-results/$(basename "$MAPPING" .json)-$(date +%Y%m%d_%H%M%S)${APPLY:+-apply}.json"
cp "$WORK/out/result.json" "$RESULT"
cat "$RESULT"
echo
if [ -n "$APPLY" ]; then
  echo "Saved to $RESULT."
else
  echo "Saved to $RESULT. Dry run: nothing changed. Re-run with --apply to do it."
fi
