import { NextResponse } from 'next/server'

// Token endpoint (RFC 6749 §3.2) — opt-in with MCP_DEV_OAUTH=true, off otherwise.
// Issues MCP_SERVICE_KEY as the Bearer token so verifyMcpAuthorization
// accepts it on the MCP endpoint. Set MCP_SERVICE_KEY in .env.local.
//
// It hands the key to anyone who asks, so it must never run on a reachable
// server. Gating on NODE_ENV was not enough: a dev server exposed through a
// tunnel gave the key to the internet.
export async function POST(): Promise<Response> {
  if (process.env.MCP_DEV_OAUTH !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const key = process.env.MCP_SERVICE_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'server_error', error_description: 'MCP_SERVICE_KEY is not set.' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    access_token: key,
    token_type: 'Bearer',
    expires_in: 86400,
  })
}
