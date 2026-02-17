Merge a git worktree's feature branch into main, apply its migrations to the main dev database, then clean up the worktree, database, and tmux sessions.

Arguments: $ARGUMENTS (expects: <name>)

Parse the worktree name from $ARGUMENTS.

IMPORTANT: Always cd to the project root first (`cd /home/leroy/planner-004`) before running any commands to avoid shell breakage if the current directory is inside the worktree being removed.

Run these steps in order:

**Commit any uncommitted work:**

1. Check for uncommitted changes in the worktree: `git -C .worktrees/<name> status --porcelain`
   - If there are staged or unstaged changes (modified or untracked files), commit them all: `git -C .worktrees/<name> add -A && git -C .worktrees/<name> commit -m "<descriptive message based on the changes>"`
   - If the working tree is clean, skip this step.

**Merge and migrate:**

2. Apply any unapplied migrations to the main dev database. Find SQL files in `.worktrees/<name>/src/migrations/` that are NOT inside the `applied/` subdirectory (these are new migrations from the feature branch). For each one, run: `docker exec -i postgres17 psql -U postgres -d dino < <migration_file>`. Report which migrations were applied. If there are none, note that no new migrations were found.
3. Merge the feature branch into main: `cd /home/leroy/planner-004 && git merge feature/<name> --no-ff -m "Merge feature/<name>: <summary>"`
   - Use `git log main..feature/<name> --oneline` to read the branch commits and write a short summary for the merge message.
   - If the merge fails due to conflicts, abort with `git merge --abort`, report the conflicts, and stop — do NOT proceed with cleanup.

**Clean up:**

4. Kill the server tmux session if it exists: `tmux kill-session -t <name>-server` (ignore errors if not running)
5. Kill the Claude tmux session if it exists: `tmux kill-session -t <name>` (ignore errors if not running)
6. Remove the git worktree: `cd /home/leroy/planner-004 && git worktree remove .worktrees/<name> --force`
7. Prune stale worktree references: `cd /home/leroy/planner-004 && git worktree prune`
8. Delete the local branch: `cd /home/leroy/planner-004 && git branch -D feature/<name>`
9. Drop the database via Docker: `docker exec postgres17 dropdb -U postgres "postgres-<name>"`

After completion, confirm with `git worktree list` and `tmux ls`. Summarize: which migrations were applied, the merge commit, and what was cleaned up.
