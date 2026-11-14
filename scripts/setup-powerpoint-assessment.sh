#!/usr/bin/env bash
# Creates PowerPoint assessment activities from spec files, running
# scripts/setup-powerpoint-assessment.ts in a throwaway container beside the app,
# and optionally copies pupils' old Upload File work into them.
#
#   bash scripts/setup-powerpoint-assessment.sh scripts/powerpoint-assessments/*.json            dry run
#   bash scripts/setup-powerpoint-assessment.sh scripts/powerpoint-assessments/*.json --apply    create
#   bash scripts/setup-powerpoint-assessment.sh scripts/powerpoint-assessments/*.json --apply --copy --hand-in
#
# Options:
#   --apply                 write (default: dry run, nothing changes)
#   --copy                  then run scripts/copy-uploads-to-powerpoint-assessment.sh for every
#                           spec with a copy_mapping (same --apply)
#   --hand-in               with --copy: hand in every pupil whose required slots are filled.
#                           This queues REAL AI marking; you are asked to type "yes" first.
#   --yes                   skip that prompt
#   --files-root <dir>      the app's files directory, mounted writable (default: ./files)
#   --fallback-root <dir>   passed to the copy: read-only second place to look for pupils' files
#
# Run from the project directory, with the app (dino-app) and the database (db)
# up. Re-running is safe: an activity with the spec's lesson and title is
# reused, and its questions are never rewritten once set. Results are saved
# under powerpoint-copy-results/.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

fail() { printf '\033[31msetup-powerpoint-assessment: %s\033[0m\n' "$1" >&2; exit 1; }

SPECS=(); APPLY=""; COPY=""; HAND_IN=""; YES=""; FILES_ROOT="$PROJECT_DIR/files"; FALLBACK_ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY="--apply" ;;
    --copy) COPY=1 ;;
    --hand-in) HAND_IN="--hand-in" ;;
    --yes) YES="--yes" ;;
    --files-root) shift; FILES_ROOT="$(cd "${1:?}" && pwd)" ;;
    --fallback-root) shift; FALLBACK_ROOT="$(cd "${1:?}" && pwd)" ;;
    --*) fail "unknown argument $1" ;;
    *) SPECS+=("$1") ;;
  esac
  shift
done
[ ${#SPECS[@]} -gt 0 ] || fail "usage: $0 <spec.json>... [--apply] [--copy [--hand-in] [--yes]] [--files-root <dir>] [--fallback-root <dir>]"
[ -n "$HAND_IN" ] && [ -z "$COPY" ] && fail "--hand-in needs --copy"
for spec in "${SPECS[@]}"; do
  case "$spec" in scripts/powerpoint-assessments/*.json) ;; *) fail "specs must be in scripts/powerpoint-assessments/ ($spec)" ;; esac
  [ -f "$spec" ] || fail "no spec at $spec"
done
[ -f .env ] || fail "no .env in $PROJECT_DIR"
[ -d "$FILES_ROOT" ] || fail "no files directory at $FILES_ROOT"
docker compose ps db --status running -q | grep -q . || fail "the db container is not running"
docker compose ps dino-app --status running -q | grep -q . || fail "the dino-app container is not running"

# Files are written as the app's own user, so the app can read and remove them.
APP_UID="$(docker compose exec -T dino-app id -u </dev/null)"
APP_GID="$(docker compose exec -T dino-app id -g </dev/null)"

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

mkdir -p powerpoint-copy-results
STAMP="$(date +%Y%m%d_%H%M%S)"
FAILED=0
for spec in "${SPECS[@]}"; do
  name="$(basename "$spec" .json)"
  echo
  echo "== $name"
  # The queue trigger's secret is blanked: setting up an activity never queues marking.
  if docker run --rm </dev/null --network "$NETWORK" --env-file .env -e MARKING_QUEUE_SECRET= \
    -v "$PROJECT_DIR/src:/app/src:ro" -v "$PROJECT_DIR/scripts:/app/scripts:ro" \
    -v "$PROJECT_DIR/tsconfig.json:/app/tsconfig.json:ro" -v "$FILES_ROOT:/app/files" \
    -v "$WORK/stub:/stub:ro" -v "$WORK/out:/out" \
    -e APP_UID="$APP_UID" -e APP_GID="$APP_GID" -e SPEC="$spec" -e OUT="/out/$name.json" -e ARGS="$APPLY" \
    dino-deps sh -c '
      set -e
      apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq poppler-utils >/dev/null 2>&1 || true
      export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/dino?sslmode=disable"
      export NODE_PATH=/stub HOME=/tmp
      cd /app
      exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --clear-groups env HOME=/tmp \
        npx -y tsx scripts/setup-powerpoint-assessment.ts --spec "$SPEC" $ARGS --out "$OUT"
    ' 2> >(grep -v '^npm notice' >&2); then
    :
  else
    FAILED=1
    echo "  (not set up; see the problems above)"
  fi
  [ -f "$WORK/out/$name.json" ] && cp "$WORK/out/$name.json" "powerpoint-copy-results/setup-$name-$STAMP${APPLY:+-apply}.json"
done

if [ -n "$COPY" ]; then
  for spec in "${SPECS[@]}"; do
    mapping="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("copy_mapping") or "")' "$spec")"
    [ -n "$mapping" ] || continue
    echo
    echo "== copy pupils' work: $mapping"
    copy_args=("$mapping")
    [ -n "$APPLY" ] && copy_args+=(--apply)
    [ -n "$HAND_IN" ] && copy_args+=(--hand-in)
    [ -n "$YES" ] && copy_args+=(--yes)
    copy_args+=(--files-root "$FILES_ROOT")
    [ -n "$FALLBACK_ROOT" ] && copy_args+=(--fallback-root "$FALLBACK_ROOT")
    bash scripts/copy-uploads-to-powerpoint-assessment.sh "${copy_args[@]}" || FAILED=1
  done
fi

echo
if [ -n "$APPLY" ]; then echo "Applied."; else echo "Dry run: nothing changed. Re-run with --apply to do it."; fi
exit "$FAILED"
