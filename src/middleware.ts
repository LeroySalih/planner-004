import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // OAuth discovery endpoints for MCP clients (e.g. Claude Code v2.1.104+)
  // that proactively run RFC 9396 / RFC 8414 / OpenID discovery BEFORE
  // making any MCP request. Claude Code hits path-specific variants
  // (e.g. /.well-known/oauth-protected-resource/api/MCP) so we use
  // startsWith rather than exact equality.
  //
  // oauth-protected-resource: empty authorization_servers → "no OAuth needed"
  // Everything else (oauth-authorization-server, openid-configuration,
  // client registration) → 404 JSON so the SDK can parse the error rather
  // than receiving a Next.js HTML 404 page which it cannot parse.
  // OAuth discovery endpoints required by Claude Code v2.1.104+ for HTTP MCP
  // servers. Claude Code performs full OAuth 2.0 discovery before connecting.
  // We serve a minimal OAuth AS that auto-approves every authorization request
  // so Claude Code can obtain a Bearer token without any user interaction.
  // The token is accepted by verifyMcpAuthorization when MCP_SERVICE_KEY is unset.
  const origin = request.nextUrl.origin

  if (pathname.startsWith("/.well-known/oauth-protected-resource")) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }
    return NextResponse.json({
      resource: `${origin}/api/MCP`,
      authorization_servers: [origin],
    })
  }

  if (pathname.startsWith("/.well-known/oauth-authorization-server")) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }
    return NextResponse.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    })
  }

  if (
    pathname.startsWith("/.well-known/openid-configuration") ||
    pathname.startsWith("/api/MCP/.well-known/")
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-pathname", pathname + request.nextUrl.search)

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
