# Worktree Development Scripts

This directory contains scripts for managing isolated development environments using git worktrees.

## Overview

Git worktrees allow you to work on multiple branches simultaneously. These scripts extend this functionality by providing each worktree with its own isolated PostgreSQL database.

## Quick Start

```bash
# 1. Create worktree
git worktree add .worktrees/my-feature -b feature/my-feature

# 2. Setup isolated database and environment
./scripts/setup-worktree-db.sh my-feature

# 3. Start development
cd .worktrees/my-feature
pnpm install
pnpm dev
```

## Scripts

### `setup-worktree-db.sh`

Sets up an isolated database and environment for a worktree, optionally starting the dev server in tmux.

**Usage:**
```bash
./scripts/setup-worktree-db.sh <worktree-name> [--start-server]
```

**What it does:**
1. Creates a new database named `postgres-<worktree-name>`
2. Clones all data from the main `postgres` database
3. Copies `.env` from main directory to the worktree
4. Updates `DATABASE_URL` in worktree's `.env` to point to the new database
5. **[Optional]** Starts dev server in tmux on an available port (3001+)

**Examples:**
```bash
# Setup only (manual start)
./scripts/setup-worktree-db.sh test-curriculum-ui

# Setup and auto-start server in tmux
./scripts/setup-worktree-db.sh test-curriculum-ui --start-server
# Creates: postgres-test-curriculum-ui
# Configures: .worktrees/test-curriculum-ui/.env
# Starts: tmux session 'worktree-test-curriculum-ui' on http://localhost:3001
```

**Tmux session management:**
```bash
# Attach to the worktree's dev server
tmux attach -t worktree-test-curriculum-ui

# Detach from tmux (inside session)
# Press: Ctrl+B, then D

# Stop server and kill session
tmux kill-session -t worktree-test-curriculum-ui

# List all tmux sessions
tmux ls
```

### `dev-worktree.sh`

Starts the development server from a specific worktree.

**Usage:**
```bash
./scripts/dev-worktree.sh [worktree-name]
```

- If no name provided, shows interactive menu
- Use "main" to run from the main directory
- Runs on port 3000 (or PORT environment variable)

**Example:**
```bash
./scripts/dev-worktree.sh test-curriculum-ui
```

### `dev-multi.sh`

Runs development servers from all worktrees simultaneously on different ports.

**Usage:**
```bash
./scripts/dev-multi.sh
```

**Port allocation:**
- Main directory: `http://localhost:3000`
- First worktree: `http://localhost:3001`
- Second worktree: `http://localhost:3002`
- etc.

Press Ctrl+C to stop all servers.

## Complete Workflow Example

```bash
# Create and setup worktree
git worktree add .worktrees/auth-improvements -b feature/auth-improvements
./scripts/setup-worktree-db.sh auth-improvements

# Install dependencies and start dev
cd .worktrees/auth-improvements
pnpm install
pnpm dev

# ... make changes, test, commit ...

# When done, go back to main
cd ../..
git worktree remove .worktrees/auth-improvements

# Optional: Drop the database if no longer needed
psql -U postgres -c "DROP DATABASE \"postgres-auth-improvements\";"
```

## Database Isolation Benefits

- **No interference**: Changes in one worktree don't affect others
- **Test migrations**: Try database changes without affecting main dev DB
- **Parallel development**: Multiple features can have different data states
- **Easy cleanup**: Drop database when feature is merged

## Managing Worktrees

```bash
# List all worktrees
git worktree list

# Remove a worktree
git worktree remove .worktrees/<name>

# Prune deleted worktrees
git worktree prune
```

## Managing Databases

```bash
# List all databases
psql -U postgres -l

# Drop a worktree database
psql -U postgres -c "DROP DATABASE \"postgres-<worktree-name>\";"

# Check database size
psql -U postgres -c "SELECT pg_database.datname, pg_size_pretty(pg_database_size(pg_database.datname)) FROM pg_database;"
```

## Troubleshooting

**Database already exists:**
If you recreate a worktree with the same name, either:
1. Drop the old database first
2. The setup script will skip creation and just update the .env

**Port already in use:**
If port 3000 is taken, specify a different port:
```bash
cd .worktrees/my-feature
PORT=3001 pnpm dev
```

**Can't connect to database:**
Verify the DATABASE_URL in the worktree's `.env` file matches the created database name.
