# Database connectivity helper

`tests/db-connect.js` exercises the existing `pg` client to confirm the server can reach the database.

Usage example:

```
POSTSQL_URL=postgresql://user:pass@localhost:5432/db node tests/db-connect.js
```

The script resolves the same environment variables as the app (`POSTSQL_URL`, `SUPABASE_DB_URL`, `DATABASE_URL`) and prints a success/failure message. You can rerun it anytime you need to verify the connection without touching the UI.
