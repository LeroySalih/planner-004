#!/usr/bin/env bash
# Copies pupils' work from old Upload File activities into a PowerPoint
# assessment's upload slots, running scripts/copy-uploads-to-powerpoint-assessment.ts
# in a throwaway container beside the app.
#
#   bash scripts/copy-uploads-to-powerpoint-assessment.sh scripts/powerpoint-mappings/<name>.json            dry run
#   bash scripts/copy-uploads-to-powerpoint-assessment.sh scripts/powerpoint-mappings/<name>.json --apply    copy
#
# Options:
#   --apply                 write (default: dry run, nothing changes)
#   --hand-in               after copying, hand in every pupil whose required slots are filled.
#                           This queues REAL AI marking; you are asked to type "yes" first.
#   --replace               also replace slots that already hold a different file, and touch
#                           pupils who have handed in (their AI marks are cleared and re-queued).
#   --yes                   skip the "yes" prompt for --hand-in / --replace
#   --files-root <dir>      the app's files directory, mounted writable (default: ./files)
#   --fallback-root <dir>   read-only second place to look for source files
#                           (e.g. a prod mirror on a dev box)
#
# Run from the project directory, with the app (dino-app) and the database (db)
# up. A summary table (ids only, no names) is printed; the full result is saved
# under powerpoint-copy-results/. Re-running copies nothing twice.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

fail() { printf '\033[31mcopy-uploads: %s\033[0m\n' "$1" >&2; exit 1; }

[ $# -ge 1 ] || fail "usage: $0 <mapping.json> [--apply] [--hand-in] [--replace] [--yes] [--files-root <dir>] [--fallback-root <dir>]"
MAPPING="$1"; shift
APPLY=""; HAND_IN=""; REPLACE=""; YES=""; FILES_ROOT="$PROJECT_DIR/files"; FALLBACK_ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY="--apply" ;;
    --hand-in) HAND_IN="--hand-in" ;;
    --replace) REPLACE="--replace" ;;
    --yes) YES=1 ;;
    --files-root) shift; FILES_ROOT="$(cd "${1:?}" && pwd)" ;;
    --fallback-root) shift; FALLBACK_ROOT="$(cd "${1:?}" && pwd)" ;;
    *) fail "unknown argument $1" ;;
  esac
  shift
done
case "$MAPPING" in scripts/powerpoint-mappings/*.json) ;; *) fail "the mapping must be in scripts/powerpoint-mappings/" ;; esac
[ -f "$MAPPING" ] || fail "no mapping at $MAPPING"
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

# run <out-name> <args...>: one pass of the TS script.
run() {
  local out="$1"; shift
  local fallback_mount=() fallback_arg=""
  if [ -n "$FALLBACK_ROOT" ]; then
    fallback_mount=(-v "$FALLBACK_ROOT:/fallback:ro")
    fallback_arg="--fallback-root /fallback"
  fi
  # The queue trigger's secret is only passed when handing in, so nothing
  # else this run does can poke the queue processor.
  local queue_secret=()
  case " $* " in *" --hand-in "*) ;; *) queue_secret=(-e MARKING_QUEUE_SECRET=) ;; esac
  docker run --rm </dev/null --network "$NETWORK" --env-file .env "${queue_secret[@]}" \
    -v "$PROJECT_DIR/src:/app/src:ro" -v "$PROJECT_DIR/scripts:/app/scripts:ro" \
    -v "$PROJECT_DIR/tsconfig.json:/app/tsconfig.json:ro" -v "$FILES_ROOT:/app/files" \
    "${fallback_mount[@]}" \
    -v "$WORK/stub:/stub:ro" -v "$WORK/out:/out" \
    -e APP_UID="$APP_UID" -e APP_GID="$APP_GID" -e MAPPING="$MAPPING" -e OUT="/out/$out" \
    -e ARGS="$* $fallback_arg" \
    dino-deps sh -c '
      set -e
      export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/dino?sslmode=disable"
      export NODE_PATH=/stub HOME=/tmp
      cd /app
      exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --clear-groups env HOME=/tmp \
        npx -y tsx scripts/copy-uploads-to-powerpoint-assessment.ts --mapping "$MAPPING" $ARGS --out "$OUT"
    '
}

summary_value() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["summary"][sys.argv[2]])' "$1" "$2"
}

if [ -n "$APPLY" ] && { [ -n "$HAND_IN" ] || [ -n "$REPLACE" ]; }; then
  echo "Checking what --apply would do first (dry run)..."
  run preview.json $HAND_IN $REPLACE >/dev/null
  WOULD_HAND_IN=0; WOULD_REQUEUE="$(summary_value "$WORK/out/preview.json" would_requeue)"
  [ -n "$HAND_IN" ] && WOULD_HAND_IN="$(summary_value "$WORK/out/preview.json" would_hand_in)"
  if [ "$WOULD_HAND_IN" -gt 0 ] || [ "$WOULD_REQUEUE" -gt 0 ]; then
    printf '\033[33mWARNING: this queues REAL AI marking on the live queue (model calls, cost):\033[0m\n'
    [ "$WOULD_HAND_IN" -gt 0 ] && echo "  - $WOULD_HAND_IN pupil(s) will be handed in, which sends their work for marking now"
    [ "$WOULD_REQUEUE" -gt 0 ] && echo "  - $WOULD_REQUEUE handed-in pupil(s) will have files replaced: their AI marks are cleared and re-queued"
    if [ -z "$YES" ]; then
      printf 'Type "yes" to go ahead: '
      read -r ANSWER || fail "no answer (no terminal?); pass --yes to go ahead without the prompt"
      [ "$ANSWER" = "yes" ] || fail "stopped; nothing changed"
    fi
  fi
fi

CONFIRMED=""
[ -n "$APPLY" ] && [ -n "$HAND_IN" ] && CONFIRMED="--confirmed"
run result.json $APPLY $HAND_IN $CONFIRMED $REPLACE

mkdir -p powerpoint-copy-results
RESULT="powerpoint-copy-results/$(basename "$MAPPING" .json)-$(date +%Y%m%d_%H%M%S)${APPLY:+-apply}.json"
cp "$WORK/out/result.json" "$RESULT"
echo
if [ -n "$APPLY" ]; then
  echo "Saved to $RESULT (pupils' file names are in it: teacher copy)."
else
  echo "Saved to $RESULT. Dry run: nothing changed. Re-run with --apply to do it."
fi
