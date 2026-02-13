#!/bin/bash

# Dev server launcher for worktrees
# Usage: ./scripts/dev-worktree.sh [worktree-name]

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# If worktree name provided, use it
if [ -n "$1" ]; then
    WORKTREE=".worktrees/$1"
    if [ ! -d "$WORKTREE" ]; then
        echo "❌ Worktree '$WORKTREE' not found"
        exit 1
    fi
else
    # List available worktrees
    echo -e "${BLUE}Available worktrees:${NC}"
    git worktree list | grep ".worktrees" | awk '{print $1}' | xargs -I {} basename {}
    echo ""

    # Show main directory option
    echo -e "${BLUE}Options:${NC}"
    echo "  main - Run from main directory"
    echo "  [worktree-name] - Run from specific worktree"
    echo ""

    read -p "Enter worktree name (or 'main'): " CHOICE

    if [ "$CHOICE" = "main" ]; then
        WORKTREE="."
    else
        WORKTREE=".worktrees/$CHOICE"
        if [ ! -d "$WORKTREE" ]; then
            echo "❌ Worktree '$WORKTREE' not found"
            exit 1
        fi
    fi
fi

# Navigate to worktree and run dev server
echo -e "${GREEN}Starting dev server from: $WORKTREE${NC}"
cd "$WORKTREE" && npm run dev
