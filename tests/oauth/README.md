# OAuth checks

Plain `tsx` scripts, not Playwright specs: they drive the OAuth server through
its store functions and over HTTP, and never forge a browser session.

| Check | Needs | Covers |
|---|---|---|
| `unit.check.ts` | nothing | JWT signing/verification, service tokens, client validation rules |
| `kerf-signin.check.ts` | dev DB + dev server | Kerf sign-in end to end, MCP alongside it, `MCP_SERVICE_KEY` |
| `project-keys.check.ts` | dev DB + dev server | project API keys, the ceiling, approval, audit, client_credentials |

Run against a **dev** database and a dev server built from the same code, with
`DATABASE_URL`, `MCP_SERVICE_KEY` and the `OAUTH_JWT_*` keys from `.env`:

```bash
OAUTH_TEST_BASE=http://localhost:3000 pnpm test:oauth
```

Each check creates its own users, clients and keys (`oauthtest-*`,
`kerftest-*`) and deletes them at the end. Never point them at production.
