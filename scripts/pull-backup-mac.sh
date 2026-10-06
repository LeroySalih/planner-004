#!/usr/bin/env bash
# Run on the Mac: copy the newest encrypted dino dump (pushed to the coding
# server by prod via push-to-coding.sh) into ~/Downloads, then delete local
# dino dumps older than 7 days.
#
# Dumps stay GPG-encrypted; decrypt with BACKUP_PASSPHRASE from the server .env:
#   gpg -d postgres_dino_<ts>.dump.gz.gpg | gunzip > dino.dump
set -euo pipefail

REMOTE="${REMOTE:-leroy@coding}"
REMOTE_DIR="prod-mirror/backups"   # relative to the remote home directory
LOCAL_DIR="$HOME/Downloads"
PATTERN="postgres_dino_*.dump.gz.gpg"
RETENTION_DAYS=7

latest=$(ssh "$REMOTE" "ls -1t $REMOTE_DIR/$PATTERN 2>/dev/null | head -n 1")
if [ -z "$latest" ]; then
  echo "No dino dumps found in $REMOTE:$REMOTE_DIR" >&2
  exit 1
fi

name=$(basename "$latest")
if [ -f "$LOCAL_DIR/$name" ]; then
  echo "Already have $name"
else
  echo "Downloading $name"
  # -p keeps the server's timestamp, so the age check below measures the
  # backup's age rather than when it was downloaded.
  scp -p "$REMOTE:$latest" "$LOCAL_DIR/$name.part"
  mv "$LOCAL_DIR/$name.part" "$LOCAL_DIR/$name"
fi

echo "Deleting local dino dumps older than $RETENTION_DAYS days"
find "$LOCAL_DIR" -maxdepth 1 -name "$PATTERN" -type f -mtime +"$RETENTION_DAYS" -print -delete
