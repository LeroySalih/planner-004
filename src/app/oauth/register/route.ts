import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Dynamic Client Registration (RFC 7591) — dev-only, disabled in production.
// Claude Code registers itself here before starting the OAuth flow.
export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // body is optional per RFC 7591
  }

  return NextResponse.json(
    {
      client_id: 'local-mcp-client',
      client_id_issued_at: Math.floor(Date.now() / 1000),
      grant_types: body.grant_types ?? ['authorization_code'],
      response_types: body.response_types ?? ['code'],
      redirect_uris: body.redirect_uris ?? [],
      token_endpoint_auth_method: 'none',
    },
    { status: 201 },
  )
}
