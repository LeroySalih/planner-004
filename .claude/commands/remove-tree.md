Remove a git worktree, its tmux sessions, and its isolated database. No code is merged and no migrations are applied.

Arguments: $ARGUMENTS (expects: <name>)

Parse the worktree name from $ARGUMENTS.

IMPORTANT: Always cd to the project root first (`cd /home/leroy/planner-004`) before running any commands to avoid shell breakage if the current directory is inside the worktree being removed.

Run these steps in order:

1. Kill the server tmux session if it exists: `tmux kill-session -t <name>-server` (ignore errors if not running)
2. Kill the Claude tmux session if it exists: `tmux kill-session -t <name>` (ignore errors if not running)
3. Remove the git worktree: `cd /home/leroy/planner-004 && git worktree remove .worktrees/<name> --force`
4. Prune stale worktree references: `cd /home/leroy/planner-004 && git worktree prune`
5. Delete the local branch: `cd /home/leroy/planner-004 && git branch -D feature/<name>`
6. Drop the database via Docker: `docker exec postgres17 dropdb -U postgres "postgres-<name>"`

After completion, confirm with `git worktree list` and `tmux ls` and summarize what was removed.
