#!/usr/bin/env bash
set -eo pipefail  # no -u so we can test unset vars safely

# Locate the .env in project root (one dir above ./bin)
ENV_FILE="$(dirname "$0")/../.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
else
  echo "❌ Could not find .env file at $ENV_FILE"
  exit 1
fi

# Defaults
: "${DB_REMOTE_USER:=postgres}"
: "${DB_REMOTE_HOST:=db.pfubrczctgsjtgcypsen.supabase.co}"
: "${DB_REMOTE_PORT:=5432}"
: "${DB_REMOTE_DB:=postgres}"

# Require password
if [[ -z "${DB_REMOTE_PASSWORD:-}" ]]; then
  echo "❌ DB_REMOTE_PASSWORD is not set in $ENV_FILE"
  exit 1
fi

# URL-encode function (RFC3986-safe for password)
urlencode() {
  local s="$1" out="" c
  for (( i=0; i<${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9._~-]) out+="$c" ;;
      *) printf -v hex '%%%02X' "'$c"; out+="$hex" ;;
    esac
  done
  printf '%s' "$out"
}

if [[ -z "${DB_REMOTE_URL:-}" ]]; then
  ENC_PASS="$(urlencode "$DB_REMOTE_PASSWORD")"
  # Add sslmode=require for Supabase
  export DB_REMOTE_URL="postgresql://${DB_REMOTE_USER}:${ENC_PASS}@${DB_REMOTE_HOST}:${DB_REMOTE_PORT}/${DB_REMOTE_DB}?sslmode=require"
fi

# Optional: feedback
echo "🌍 Loaded environment from $(realpath "$ENV_FILE" 2>/dev/null || echo "$ENV_FILE")"
echo "   → Host: ${DB_REMOTE_HOST}"
echo "   → Database: ${DB_REMOTE_DB}"