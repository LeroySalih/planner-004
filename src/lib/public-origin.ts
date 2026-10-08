// The origin the outside world reaches this server on — the OAuth issuer and
// every URL advertised to MCP clients.
//
// APP_ORIGIN (e.g. https://dino.mr-salih.org) always wins and is required in
// production. Forwarding headers are client-controlled, so deriving the origin
// from them would let anyone make the discovery documents point at their own
// host. They are only a fallback for local development, where
// `request.nextUrl.origin` is no help either: behind the Cloudflare tunnel it is
// the upstream the tunnel dials (it reported https://localhost:3000).
//
// Edge-safe: middleware imports it.
export function publicOrigin(headers: Headers): string {
  const configured = process.env.APP_ORIGIN?.trim()
  if (configured) return configured.replace(/\/+$/, "")

  const host = firstValue(headers.get("x-forwarded-host")) ?? headers.get("host") ?? "localhost"
  const proto = firstValue(headers.get("x-forwarded-proto")) ?? (isLoopback(host) ? "http" : "https")
  return `${proto}://${host}`
}

function firstValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim()
  return first ? first : null
}

function isLoopback(host: string): boolean {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
}
