// Discovery documents for MCP's OAuth flow (MCP authorization spec 2025-06-18).
// Edge-safe: served from middleware so no page guard can redirect them.

export function mcpResourceUrl(origin: string): string {
  return `${origin}/api/MCP`
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`
}

/** RFC 9728 — tells an MCP client which server to sign in with. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  }
}

/** RFC 8414 — DINO is its own authorization server. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    // "none" for sign-in clients (PKCE) and MCP; the secret methods are for
    // first-party service clients only (docs/FIRST-PARTY-CLIENTS.md).
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    // First-party sign-in (docs/KERF-SSO.md). MCP clients ignore all of these:
    // their tokens stay opaque and they are granted no scopes.
    jwks_uri: `${origin}/oauth/jwks`,
    userinfo_endpoint: `${origin}/oauth/userinfo`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: ["profile", "groups"],
    access_token_signing_alg_values_supported: ["RS256"],
  }
}
