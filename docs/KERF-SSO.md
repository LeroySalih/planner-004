# Kerf Sabre sign-in (first-party OAuth)

DINO's OAuth server (`src/lib/oauth/`, `src/app/oauth/`) signs people in to the
Kerf Sabre apps as well as to MCP. MCP is unchanged; see `docs/MCP.md`. How
first-party clients are added and managed (admin UI, script, project API
keys) and service-to-service tokens are in `docs/FIRST-PARTY-CLIENTS.md`.

| | MCP clients (Claude) | First-party clients (Kerf) |
|---|---|---|
| Registration | Self-register at `/oauth/register` (RFC 7591) | `/admin/oauth`, `scripts/register-oauth-client.ts`, or a project API key |
| Redirect URI | Claude callback or loopback on any port | Exact match against the registered list |
| Who can sign in | Teachers | The client's `allowed_roles` |
| Consent page | Allow / Deny | None |
| Access token | Opaque, 1 hour | RS256 JWT, `access_ttl_seconds` (Kerf: 15 min) |
| Refresh token | Opaque, 30 days | Opaque, `refresh_ttl_seconds` (Kerf: 7 days) |
| Scopes | None (any requested scope is ignored) | `profile`, `groups`, limited to `allowed_scopes` |

Not OpenID Connect: no `id_token`, and `/.well-known/openid-configuration` stays a 404.

## Clients

Both are public clients using PKCE S256, with `first_party = true`,
`token_format = 'jwt'` and `audience = 'kerf-sabre'`.

| client_id | Used by | Roles | Scopes |
|---|---|---|---|
| `kerf-editor` | Kerf Editor (pupils and staff) | pupil, teacher, admin, technician | profile |
| `kerf-admin` | Kerf Admin | teacher, admin | profile, groups |

Redirect URIs differ per environment, so register them with the script, once
per environment, listing every origin used (production, school LAN, localhost):

```bash
npx tsx scripts/register-oauth-client.ts --id kerf-editor --name "Kerf Sabre Editor" \
  --redirect-uri https://kerf.example.org/auth/callback \
  --redirect-uri http://localhost:5173/auth/callback \
  --roles pupil,teacher,admin,technician --scopes profile \
  --audience kerf-sabre --access-ttl 900 --refresh-ttl 604800

npx tsx scripts/register-oauth-client.ts --id kerf-admin --name "Kerf Sabre Admin" \
  --redirect-uri https://kerf-admin.example.org/auth/callback \
  --roles teacher,admin --scopes profile,groups \
  --audience kerf-sabre --access-ttl 900 --refresh-ttl 604800
```

Running it again updates the client; live connections are kept. It refuses
to turn an MCP client into a first-party one. On production, where the app
image has no `tsx`, add the clients at `/admin/oauth` instead. That page
applies the same rules (`src/lib/oauth/clients.ts`) and audits the change.

A disabled client (`/admin/oauth`, or by the project that owns it) cannot
sign anyone in or refresh, and userinfo refuses its tokens.

`/oauth/register` can never create or change a first-party client: it always
mints a new random `client_id` with `first_party = false`. `pruneExpired` never
deletes a first-party client.

## Flow

1. Kerf sends the browser to `/oauth/authorize` with `response_type=code`,
   `client_id`, `redirect_uri`, `code_challenge` (S256), `state`, and optionally
   `scope` and `resource` (if given, it must be `kerf-sabre`).
2. Someone not signed in goes to `/signin?returnTo=…` and comes back. Pupils
   sign in there as usual. Anyone on the default password changes it first
   (`/change-password`), then carries on.
3. If the user has one of the client's roles, the page redirects straight back
   with `code` and `state`. No consent page. Otherwise it shows "Your account
   cannot sign in to …".
4. Kerf posts the code and `code_verifier` to `/oauth/token` and gets
   `{ access_token, token_type, expires_in, refresh_token, scope }`.
5. Before `exp`, Kerf refreshes with `grant_type=refresh_token`. Each refresh
   rotates the refresh token; presenting an old one revokes the connection.
   Roles are checked again, so someone who lost every allowed role (or was
   deleted) cannot refresh.
6. Sign out: `POST /oauth/revoke` with `token` (refresh token or access JWT) and
   `client_id`. Always 200.

Errors go back to the client as `error` / `error_description` / `state` on the
redirect URI (`invalid_scope`, `invalid_target`, `invalid_request`,
`unsupported_response_type`). An unknown client or a redirect URI that does not
match exactly shows an error page and redirects nowhere.

## The access token

A JWT, header `{ alg: "RS256", typ: "at+jwt", kid }` (RFC 9068), built by
`buildAccessTokenClaims` in `src/lib/oauth/jwt.ts`:

| Claim | Value |
|---|---|
| `token_use` | `"user"`. A service token says `"service"` (docs/FIRST-PARTY-CLIENTS.md); userinfo refuses one. |
| `iss` | `APP_ORIGIN` (no trailing slash) |
| `sub` | `profiles.user_id`, a lowercase UUID. Kerf uses it as the person's ID. Personal data. |
| `aud` | the client's audience, `kerf-sabre` |
| `iat`, `nbf`, `exp` | issue time, same, issue + access lifetime |
| `jti` | random 128-bit, base64url |
| `sid` | the connection (`oauth_tokens.id`); the same across refreshes |
| `client_id` | the OAuth client |
| `scope` | granted scopes, space separated (`""` if none) |
| `roles` | lowercase role ids by the same rule as a DINO session (`effectiveRoles` in `src/lib/roles.ts`): every `user_roles` row, `teacher` for the legacy `is_teacher` flag, `["pupil"]` if there are none. An admin usually also has `teacher` and `pupil`, so Kerf should rank them. |
| `groups` | only with the `groups` scope: `[{ "id": group_id }]` for the user's **active** class memberships, which can span school years and subjects |

Never a name or email: tokens end up in browser storage, headers and proxy
logs.

**The Kerf server must** verify the signature against `/oauth/jwks`, pin
`alg` to RS256 (refuse `none` and HS256), require `typ: at+jwt`, and check
`iss`, `aud`, `exp` and `nbf`. It should also require `token_use: "user"`
and a `sid`, and that `client_id` is one of its own clients, so a service
token is never taken for a person.

An access JWT cannot be revoked before it expires. Revoking a connection or
removing a role stops refresh at once, but an issued JWT works until `exp`.
That is why it lives 15 minutes. Do not lengthen it to compensate.

## Endpoints

| Endpoint | |
|---|---|
| `GET /.well-known/oauth-authorization-server` | adds `jwks_uri`, `userinfo_endpoint`, `revocation_endpoint`, `scopes_supported`, `access_token_signing_alg_values_supported` |
| `GET /oauth/jwks` | `{ keys: [{ kty, n, e, use: "sig", alg: "RS256", kid }] }`, current key plus previous during a rotation. `Cache-Control: public, max-age=300`. CORS `*`. |
| `GET /oauth/userinfo` | `Authorization: Bearer <JWT>`. `{ sub, roles }`, read live; with `profile`, `name` and, for teachers and admins only, `email`. Never email for a pupil. Display only: Kerf must not store them. 401 with `WWW-Authenticate: Bearer error="invalid_token"` for a bad, expired or revoked token. |
| `POST /oauth/revoke` | RFC 7009, form body `token`, `client_id`, optional `token_type_hint`. Always 200. |

All `/oauth/*` endpoints allow any origin; none take cookies.

Rate limiting: DINO has no per-IP limiter for these endpoints. Sign-in itself
is limited (`signinAction`), and codes and refresh tokens are 256-bit random
secrets.

## Signing keys

| Variable | |
|---|---|
| `OAUTH_JWT_PRIVATE_KEY` | RSA private key, PKCS#8 PEM, at least 2048 bits. Newlines may be written as `\n`. Required at startup. |
| `OAUTH_JWT_KEY_ID` | its `kid`. Required at startup. |
| `OAUTH_JWT_PREVIOUS_PUBLIC_KEY`, `OAUTH_JWT_PREVIOUS_KEY_ID` | optional; the key being rotated out |

Generate a key and write it to `.env` on one line, without printing it:

```bash
KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | awk 'BEGIN{ORS="\\n"} {print}')
printf 'OAUTH_JWT_PRIVATE_KEY="%s"\nOAUTH_JWT_KEY_ID=%s\n' "$KEY" "prod-$(date +%Y%m%d)" >> .env
unset KEY
```

If a JWT client is used with no usable key, `/oauth/token` answers
`server_error` and logs why. It never falls back to an unsigned or opaque token,
and the pupil's code is not spent.

### Rotation

1. Generate a new key.
2. Move the current key's **public** half into `OAUTH_JWT_PREVIOUS_PUBLIC_KEY`
   (`openssl pkey -pubout`) and its kid into `OAUTH_JWT_PREVIOUS_KEY_ID`.
3. Set the new key as `OAUTH_JWT_PRIVATE_KEY` with a new `OAUTH_JWT_KEY_ID`.
4. Deploy. New tokens use the new kid; old ones still verify.
5. After the longest access lifetime (15 minutes) plus the JWKS cache (5
   minutes), remove the `PREVIOUS` variables and deploy again.

## Logging

Token issue, refusal and revocation log `clientId`, `sub` and the outcome.
Tokens, codes and JWTs are never logged.

