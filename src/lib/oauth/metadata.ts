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
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  }
}
