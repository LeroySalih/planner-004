# First-party OAuth clients, project keys and service tokens

DINO's OAuth server (`src/lib/oauth/`) serves three kinds of client:

| | MCP clients (Claude) | First-party sign-in clients | First-party service clients |
|---|---|---|---|
| `client_type` | `public` | `public` | `service` |
| Who registers it | the client itself, `/oauth/register` | an admin, a script or a project key | an admin, a script or a project key |
| Acts as | a teacher | the person who signed in | itself, never a person |
| Authenticates with | PKCE | PKCE | its own secret |
| Grant | `authorization_code`, `refresh_token` | `authorization_code`, `refresh_token` | `client_credentials` only |
| Access token | opaque, 1 hour | RS256 JWT, `token_use: "user"` | RS256 JWT, `token_use: "service"`, 5–10 min |
| Refresh token | yes | yes | never |

Sign-in clients and their tokens are described in `docs/KERF-SSO.md`. This
document covers how first-party clients are added and managed, and the
service-token flow. MCP is unchanged; see `docs/MCP.md`.

## No shared secret, on purpose

There is no token that every app shares. A leak of a shared token would
compromise every app at once, and could not be revoked for one app without
breaking all of them. Instead:

- each **project** has its own **API key** for managing its own clients,
  limited by a ceiling an admin sets;
- each **service** has its own **client secret**, and gets short-lived tokens
  for the specific apps it is allowed to call;
- a leak is revoked for that project or that service alone.

Keys and secrets are 256-bit random values. Only their SHA-256 is stored, and
they are compared in constant time. They are shown once, when created or
rotated, and never logged.

## Three ways to add a client

All three use the same rules (`src/lib/oauth/clients.ts`) and every change is
written to `oauth_client_audit_log`.

1. **Admin UI**: `/admin/oauth` (admins only). Create sign-in or service
   clients, approve clients a project created, disable and enable clients, and
   rotate service secrets. Clients made here have no owner key and are enabled
   at once. This is the way to do it on production, where the app image has
   no `tsx`.
2. **Script** (dev, or anywhere with `tsx`): `scripts/register-oauth-client.ts`
   creates or updates a client (examples in the script and in
   `docs/KERF-SSO.md`). `--type service` makes a service client and prints its
   secret once.
3. **Project API key**: the project calls `/api/oauth-clients` itself, within
   its ceiling (below).

### Rules for every client

- `client_id`: letters, digits, `_` and `-`, 3 to 64 characters.
- Redirect URIs (sign-in clients): 1 to 20, **exact match only**; https, or
  http on `localhost`/`127.0.0.1`; no fragment, no user name or password, no
  wildcard, no pattern of any kind.
- Roles: some of `pupil`, `teacher`, `admin`, `technician`. User scopes:
  `profile`, `groups`.
- Sign-in token lifetime 60 s to 1 hour (default 15 min); refresh 1 hour to
  30 days (default 7 days).
- Service clients: no redirect URIs, roles or user scopes; at least one
  `allowed_audiences`; any well-formed `service_scopes` (e.g. `groups:read`);
  token lifetime 300 to 600 s (default 300).

## Project API keys

An admin creates a key per project, in the admin UI or on dev with the
script:

```bash
npx tsx scripts/api-key.ts create --name kerf-sabre --prefix kerf- \
  --roles pupil,teacher,technician --scopes profile,groups \
  --hosts kerf.example.org,kerf-admin.example.org --audiences kerf-sabre \
  [--max-clients 5] [--no-approval] [--expires 2027-07-31]
npx tsx scripts/api-key.ts list
npx tsx scripts/api-key.ts rotate kerf-sabre [--overlap 3600]
npx tsx scripts/api-key.ts revoke kerf-sabre
```

The key looks like `dino_pk_` followed by 43 characters. Lists and logs show only
`dino_pk_` plus the first 8 characters of the random part.

**The ceiling.** Nothing a key's clients are given can exceed it:

| Key setting | Limits |
|---|---|
| `allowed_roles` | roles its sign-in clients may allow. `admin` only if listed. |
| `allowed_scopes` | user scopes (`profile`, `groups`) and service scopes its clients may have |
| `allowed_redirect_hosts` | exact host names for redirect URIs (no subdomains); localhost and 127.0.0.1 are always allowed |
| `allowed_audiences` | the `aud` of its sign-in clients, and the audiences its service clients may call |
| `client_id_prefix` | every `client_id` it creates starts with this |
| `max_clients` | how many clients it may own, disabled ones included (default 5) |
| `requires_approval` | new clients start disabled until an admin approves them (default **on**) |
| `expires_at` | optional |

A key can **never**: act as a person, open `/api/MCP` or `/oauth/userinfo`,
see or change another project's clients, MCP clients or admin-made clients,
create or change keys, approve its own clients, or set anything outside its
ceiling. Admin changes to a client are allowed beyond the ceiling.

**Rotation.** Rotating issues a new key for the same project. Its ceiling and
clients stay the same. With an overlap, the old key keeps working for that
many seconds, up to 7 days, so the project can switch over. The default, 0,
stops the old key at once.

A client an admin disables stays disabled until an admin enables it. The
project that owns it cannot switch it back on.

**Revocation** stops the key at once. Clients it created keep working; disable
them in the admin UI if they should stop too.

### API reference

Base URL `https://dino.example.org/api/oauth-clients`, JSON bodies,
`Authorization: Bearer dino_pk_…`. Unknown body fields are refused.

| | |
|---|---|
| `POST /api/oauth-clients` | create a client |
| `GET /api/oauth-clients` | list the key's own clients |
| `GET /api/oauth-clients/{id}` | one of them |
| `PATCH /api/oauth-clients/{id}` | change `client_name`, `roles`, `scopes`, `allowed_audiences`, `service_scopes`, `access_ttl_seconds`, `refresh_ttl_seconds` |
| `POST /api/oauth-clients/{id}/redirect-uris` | `{ "uri": … }` add one |
| `DELETE /api/oauth-clients/{id}/redirect-uris` | `{ "uri": … }` remove one (never the last) |
| `POST /api/oauth-clients/{id}/disable` | stop sign-in, refresh and service tokens |
| `POST /api/oauth-clients/{id}/enable` | re-enable (not while awaiting approval, nor after an admin disabled it) |
| `POST /api/oauth-clients/{id}/rotate-secret` | service clients: `{ "overlap_seconds": 0 }` optional |

| Status | Meaning |
|---|---|
| 401 | missing, unknown, revoked or expired key (`WWW-Authenticate: Bearer`) |
| 403 | outside the key's ceiling, more than `max_clients`, or enabling a client that is awaiting approval or that an admin disabled |
| 404 | no such client, **or one the key does not own** (never 403, so other projects' client ids are not revealed) |
| 409 | `client_id` already taken |
| 422 | invalid input |
| 429 | more than 60 requests a minute for this key (`Retry-After`) |

Errors are `{ "error": …, "error_description": … }`.

```bash
KEY=dino_pk_...   # from the project's .env, never in code

# A sign-in client
curl -sS https://dino.example.org/api/oauth-clients \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"client_id":"kerf-editor","client_name":"Kerf Sabre Editor",
       "redirect_uris":["https://kerf.example.org/auth/callback","http://localhost:5173/auth/callback"],
       "roles":["pupil","teacher","technician"],"scopes":["profile"],"audience":"kerf-sabre"}'
# → 201 {"client":{…,"status":"pending_approval"}}   until an admin approves it

# A service client: the response carries client_secret ONCE
curl -sS https://dino.example.org/api/oauth-clients \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"client_id":"kerf-sync","client_name":"Kerf sync","client_type":"service",
       "allowed_audiences":["planner-api"],"service_scopes":["groups:read"]}'

curl -sS https://dino.example.org/api/oauth-clients -H "Authorization: Bearer $KEY"
curl -sS -X PATCH https://dino.example.org/api/oauth-clients/kerf-editor \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"access_ttl_seconds":600}'
curl -sS https://dino.example.org/api/oauth-clients/kerf-editor/redirect-uris \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"uri":"https://kerf.lan.example.org/auth/callback"}'
curl -sS -X DELETE https://dino.example.org/api/oauth-clients/kerf-editor/redirect-uris \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"uri":"http://localhost:5173/auth/callback"}'
curl -sS -X POST https://dino.example.org/api/oauth-clients/kerf-editor/disable -H "Authorization: Bearer $KEY"
curl -sS -X POST https://dino.example.org/api/oauth-clients/kerf-sync/rotate-secret \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"overlap_seconds":3600}'
```

Client JSON: `client_id`, `client_name`, `client_type`, `redirect_uris`,
`roles`, `scopes`, `audience`, `allowed_audiences`, `service_scopes`,
`access_ttl_seconds`, `refresh_ttl_seconds`, `status` (`enabled`,
`disabled`, `pending_approval`), `created_at`, `previous_secret_expires_at`.
It never includes a secret or a hash.

## Service tokens (client_credentials)

A service calling another app as itself, for example a sync job reading
from another app's API:

```bash
curl -sS https://dino.example.org/oauth/token \
  -u "kerf-sync:$KERF_SYNC_SECRET" \
  -d grant_type=client_credentials -d audience=planner-api -d scope=groups:read
# → {"access_token":"eyJ…","token_type":"Bearer","expires_in":300,"scope":"groups:read"}
```

- Authenticate with HTTP Basic (`client_secret_basic`; RFC 6749 §2.3.1:
  url-encode id and secret before base64) **or** `client_id` +
  `client_secret` in the form body (`client_secret_post`), not both.
- `audience` (or `resource`) is required and must be one of the client's
  `allowed_audiences` (`invalid_target` otherwise). `scope` is optional; only
  scopes listed are granted, and none if omitted (`invalid_scope` for one it
  may not have).
- An unknown client, a wrong secret and a disabled or unapproved client all
  get the same `401 invalid_client`, in the same time.
- No refresh token. Fetch a new token when the old one is about to expire.

The token is an RS256 JWT signed with the same key and published in the same
`/oauth/jwks` as user tokens:

| Claim | Value |
|---|---|
| `token_use` | `"service"` |
| `iss` | DINO's origin |
| `sub`, `client_id` | the calling service's `client_id` |
| `aud` | the requested audience |
| `iat`, `nbf`, `exp` | 5 to 10 minutes |
| `jti` | random |
| `scope` | granted scopes, space separated |

No `roles`, `groups`, `sid` or user. User tokens now also carry
`token_use: "user"`. Existing verifiers ignore the new claim.

**Audiences are never shared between the two kinds.** A service audience
can't equal any sign-in client's `audience`, and the reverse is refused
too (422, for admins as well). So a service token never carries a
user-facing audience such as `kerf-sabre`. An app that both signs people
in and receives service calls uses two audiences, for example `kerf-sabre`
and `kerf-sabre-api`.

**A service token never passes as a user token**, and the reverse. DINO's
userinfo and `/api/MCP` refuse service tokens. Kerf (and any user-facing
resource server) already requires the token's `client_id` to be one of its
own sign-in clients (per the Kerf spec), and never sees a service token
for its audience. User-facing verifiers should still require
`token_use: "user"` and a `sid`. A service must check
`token_use: "service"`, so it refuses user tokens.

### For service authors

Calling another service:

1. Keep `client_id` and secret in `.env`, never in code.
2. Fetch a token for that service's audience; cache it until about 30 seconds
   before `exp`, then fetch another.
3. Send it as `Authorization: Bearer <token>`.

Receiving calls, verify every incoming token against `/oauth/jwks` (cache the
JWKS; refetch on an unknown `kid`):

- `alg` pinned to **RS256** (refuse `none` and HS256), header `typ: at+jwt`;
- `iss` = DINO's origin, `aud` = **your own** audience, `exp` and `nbf`
  (allow a few seconds of skew);
- `token_use` = `"service"`;
- `client_id` (= `sub`) on **your allow-list** of callers.

`verifyServiceJwt` in `src/lib/oauth/jwt.ts` is the reference
implementation. With `jose`:

```ts
const jwks = createRemoteJWKSet(new URL('https://dino.example.org/oauth/jwks'))
const { payload } = await jwtVerify(token, jwks, {
  algorithms: ['RS256'], typ: 'at+jwt', issuer: 'https://dino.example.org', audience: 'planner-api',
})
if (payload.token_use !== 'service' || !ALLOWED_CALLERS.includes(String(payload.client_id))) throw new Error('forbidden')
```

### Secret rotation

`POST /api/oauth-clients/{id}/rotate-secret`, or *Rotate secret* in the admin
UI, returns a new secret once. With `overlap_seconds` (default 0, at most 7
days) the old secret keeps working that long: deploy the new secret, then let
the overlap run out.

## The JWT caveat

An access JWT cannot be revoked before it expires. Disabling a client,
revoking a key or rotating a secret stops **new** tokens at once. Tokens
already issued work until `exp`: up to 15 minutes for Kerf sign-in tokens,
10 minutes for service tokens. That is why they are short. Do not lengthen
them to make up for it.

## Audit

`oauth_client_audit_log` has one row per API call, admin action and script
run. Each row records the actor (`api_key`, `admin` or `script`), the key's
name and prefix or the admin's user id, the `client_id`, the action, the
before and after settings (redirect URIs, roles, scopes, audiences, TTLs,
status), the outcome (`ok`, `refused`, `error`) and the HTTP status. It never
holds a key, a secret or a hash of one. Calls with no valid key (401) are not
audited, so anyone on the internet cannot fill the table.

```sql
select created_at, actor, key_name, client_id, action, outcome, status, error
from oauth_client_audit_log order by created_at desc limit 50;
```

## Tests

`tests/oauth/` has three checks: `unit`, `kerf-signin` and `project-keys`.
Run them against a dev server with `pnpm test:oauth` (see
`tests/oauth/README.md`).
