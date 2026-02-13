#!/bin/bash

# Run dev servers from multiple worktrees on different ports
# Usage: ./scripts/dev-multi.sh

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Starting multiple dev servers...${NC}\n"

# Main directory on port 3000
echo -e "${GREEN}Main: http://localhost:3000${NC}"
cd /Users/leroysalih/nodejs/planner-005 && PORT=3000 npm run dev &

# List worktrees and assign ports
PORT=3001
for worktree in .worktrees/*; do
    if [ -d "$worktree" ]; then
        name=$(basename "$worktree")
        echo -e "${GREEN}$name: http://localhost:$PORT${NC}"
        cd "$worktree" && PORT=$PORT npm run dev &
        ((PORT++))
    fi
done

echo -e "\n${YELLOW}Press Ctrl+C to stop all servers${NC}"
wait
