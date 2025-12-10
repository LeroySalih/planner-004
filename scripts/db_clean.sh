#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/reset_clean.sql"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DB_URL="${DATABASE_URL:-}"

if [[ -z "$DB_URL" ]]; then
  echo "[db:clean] DATABASE_URL is not set (checked .env). Export it before running." >&2
  exit 1
fi

echo "[db:clean] Resetting database (keeping auth + profiles)..."
psql "$DB_URL" -f "$SCRIPT_PATH"
echo "[db:clean] Done."
