#!/bin/bash

# Setup isolated database and environment for a worktree
# Usage: ./scripts/setup-worktree-db.sh <worktree-name> [--start-server]

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

if [ -z "$1" ]; then
  echo -e "${RED}Error: Worktree name required${NC}"
  echo "Usage: $0 <worktree-name> [--start-server]"
  exit 1
fi

WORKTREE_NAME="$1"
START_SERVER=false

# Check for --start-server flag
if [ "$2" = "--start-server" ]; then
  START_SERVER=true
fi

WORKTREE_PATH=".worktrees/$WORKTREE_NAME"
DB_NAME="postgres-$WORKTREE_NAME"
TMUX_SESSION="worktree-$WORKTREE_NAME"

# Verify worktree exists
if [ ! -d "$WORKTREE_PATH" ]; then
  echo -e "${RED}Error: Worktree '$WORKTREE_PATH' not found${NC}"
  echo "Create it first with: git worktree add $WORKTREE_PATH"
  exit 1
fi

# Read DATABASE_URL from main .env
if [ ! -f ".env" ]; then
  echo -e "${RED}Error: .env file not found in main directory${NC}"
  exit 1
fi

# Extract database connection details from DATABASE_URL
DB_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-)
DB_USER=$(echo "$DB_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASSWORD=$(echo "$DB_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo "$DB_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo "$DB_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
SOURCE_DB=$(echo "$DB_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo -e "${BLUE}Setting up isolated database for worktree: $WORKTREE_NAME${NC}"
echo ""

# Step 1: Create database as clone
echo -e "${YELLOW}1. Creating database '$DB_NAME' as clone of '$SOURCE_DB'...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -c "CREATE DATABASE \"$DB_NAME\" WITH TEMPLATE \"$SOURCE_DB\" OWNER \"$DB_USER\";" 2>&1 | grep -v "already exists" || {
  if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo -e "${YELLOW}   Database already exists, skipping creation${NC}"
  else
    echo -e "${RED}   Failed to create database${NC}"
    exit 1
  fi
}
echo -e "${GREEN}   ✓ Database created${NC}"

# Step 2: Copy .env to worktree
echo -e "${YELLOW}2. Copying .env to worktree...${NC}"
cp .env "$WORKTREE_PATH/.env"
echo -e "${GREEN}   ✓ .env copied${NC}"

# Step 3: Update DATABASE_URL in worktree's .env
echo -e "${YELLOW}3. Updating DATABASE_URL to use '$DB_NAME'...${NC}"
sed -i.bak "s|/${SOURCE_DB}?|/${DB_NAME}?|g" "$WORKTREE_PATH/.env"
rm "$WORKTREE_PATH/.env.bak"
echo -e "${GREEN}   ✓ DATABASE_URL updated${NC}"

echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo -e "${BLUE}Worktree configuration:${NC}"
echo "  Path: $WORKTREE_PATH"
echo "  Database: $DB_NAME"

# Step 4: Start dev server in tmux (if requested)
if [ "$START_SERVER" = true ]; then
  echo ""
  echo -e "${YELLOW}4. Starting dev server in tmux...${NC}"

  # Find available port starting from 3001
  PORT=3001
  while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    ((PORT++))
  done

  # Check if tmux session already exists
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo -e "${YELLOW}   Tmux session '$TMUX_SESSION' already exists, killing it...${NC}"
    tmux kill-session -t "$TMUX_SESSION"
  fi

  # Get absolute path to worktree
  ABS_WORKTREE_PATH="$(cd "$WORKTREE_PATH" && pwd)"

  # Create tmux session and start dev server
  tmux new-session -d -s "$TMUX_SESSION" -c "$ABS_WORKTREE_PATH"

  # Source shell profile to ensure pnpm is available
  if [ -f "$HOME/.zshrc" ]; then
    tmux send-keys -t "$TMUX_SESSION" "source ~/.zshrc" C-m
  elif [ -f "$HOME/.bashrc" ]; then
    tmux send-keys -t "$TMUX_SESSION" "source ~/.bashrc" C-m
  fi
  sleep 1

  # Install dependencies if needed
  tmux send-keys -t "$TMUX_SESSION" "pnpm install" C-m
  sleep 3

  # Start dev server with PORT
  tmux send-keys -t "$TMUX_SESSION" "PORT=$PORT pnpm dev" C-m

  echo -e "${GREEN}   ✓ Server starting in tmux session${NC}"
  echo ""
  echo -e "${BLUE}Server details:${NC}"
  echo "  Port: $PORT"
  echo "  URL: http://localhost:$PORT"
  echo "  Tmux session: $TMUX_SESSION"
  echo ""
  echo -e "${BLUE}Manage tmux session:${NC}"
  echo "  tmux attach -t $TMUX_SESSION    # Attach to session"
  echo "  tmux detach                     # Detach (Ctrl+B, then D)"
  echo "  tmux kill-session -t $TMUX_SESSION  # Stop server and kill session"
else
  echo ""
  echo -e "${BLUE}Next steps:${NC}"
  echo "  cd $WORKTREE_PATH"
  echo "  pnpm install"
  echo "  pnpm dev"
  echo ""
  echo -e "${BLUE}Or start server in tmux:${NC}"
  echo "  $0 $WORKTREE_NAME --start-server"
fi
