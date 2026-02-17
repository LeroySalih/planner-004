Create a git worktree with an isolated database and dev server.

Arguments: $ARGUMENTS (expects: <name> <port>)

Parse the two arguments from $ARGUMENTS: the first is the worktree name, the second is the port number.

Run these steps in order:

1. Create the worktree: `git worktree add .worktrees/<name> -b feature/<name>`
2. Clone the database via Docker: `docker exec postgres17 createdb -U postgres -T dino "postgres-<name>"`
3. Copy `.env` from the project root into `.worktrees/<name>/.env`
4. In the copied `.env`, replace the `DATABASE_URL` database name (`dino`) with `postgres-<name>`
5. Run `pnpm install` inside `.worktrees/<name>/`
6. Start the dev server in a tmux session: `tmux new-session -d -s <name>-server -c .worktrees/<name> 'PORT=<port> pnpm dev'`
7. Create a Claude Code tmux session: `tmux new-session -d -s <name> -c .worktrees/<name>`

After completion, confirm the tmux sessions are running with `tmux ls` and summarize what was created. Remind the user to attach with `tmux attach -t <name>` to launch Claude Code in the worktree.
