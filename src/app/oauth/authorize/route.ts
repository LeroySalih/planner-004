import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Authorization endpoint (RFC 6749 §3.1) — dev-only, disabled in production.
// Auto-approves immediately: Claude Code opens this URL in a browser and we
// redirect back to its callback with a code instantly.
export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { searchParams } = request.nextUrl
  const redirectUri = searchParams.get('redirect_uri')
  const state = searchParams.get('state')

  if (!redirectUri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri is required' },
      { status: 400 },
    )
  }

  const callbackUrl = new URL(redirectUri)
  callbackUrl.searchParams.set('code', 'local-dev-auth-code')
  if (state) callbackUrl.searchParams.set('state', state)

  return NextResponse.redirect(callbackUrl.toString())
}
