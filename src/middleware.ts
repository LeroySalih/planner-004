import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Self-contained maintenance page (no app assets, so it renders even when the
// rest of the app is being worked on). Served with HTTP 503 + Retry-After.
const MAINTENANCE_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>We'll be back soon</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
    font-family: system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#eef2f0; color:#13211b; }
  @media (prefers-color-scheme: dark){ body{ background:#0d1512; color:#e9efeb; } .card{ background:#15201b !important; border-color:#26332c !important; } .muted{ color:#9db0a7 !important; } }
  .card { max-width:520px; width:100%; background:#fff; border:1px solid #dbe4df; border-radius:18px;
    padding:40px 32px; text-align:center; box-shadow:0 8px 30px rgba(19,33,27,.08); }
  .badge { width:64px; height:64px; margin:0 auto 20px; border-radius:16px; display:grid; place-items:center;
    background:#e5f3ec; color:#1f7d54; }
  h1 { font-size:26px; margin:0 0 10px; letter-spacing:-.02em; }
  p { margin:0 0 8px; font-size:16px; line-height:1.5; }
  .muted { color:#5c6b63; font-size:14px; }
</style></head>
<body>
  <main class="card">
    <div class="badge" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z"/>
      </svg>
    </div>
    <h1>We&rsquo;re doing some maintenance</h1>
    <p>The site is temporarily offline while we make some improvements.</p>
    <p class="muted">We expect to be back within 24 hours. Thanks for your patience.</p>
  </main>
</body></html>`

function maintenanceResponse() {
  return new NextResponse(MAINTENANCE_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Retry-After": "86400",
      "Cache-Control": "no-store",
    },
  })
}

export function middleware(request: NextRequest) {
  // Maintenance mode: when MAINTENANCE_MODE=true, every request gets a 503
  // maintenance page. Set MAINTENANCE_BYPASS=<token> to let an admin through via
  // a ?maint_bypass=<token> link (stored as a cookie) — omit it to block everyone.
  if (process.env.MAINTENANCE_MODE === "true") {
    const token = process.env.MAINTENANCE_BYPASS
    const fromQuery = request.nextUrl.searchParams.get("maint_bypass")
    const fromCookie = request.cookies.get("maint_bypass")?.value
    const bypassed = Boolean(token) && (fromQuery === token || fromCookie === token)
    if (!bypassed) {
      return maintenanceResponse()
    }
    if (token && fromQuery === token) {
      const res = NextResponse.next()
      res.cookies.set("maint_bypass", token, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 })
      return res
    }
  }

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
