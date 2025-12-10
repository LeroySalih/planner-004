# Database connectivity helper

`tests/db-connect.js` exercises the existing `pg` client to confirm the server can reach the database.

Usage example:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/db node tests/db-connect.js
```
.
