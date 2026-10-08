import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import path from 'node:path'

/** The limit every MCP upload path shares. */
export const MCP_UPLOAD_MAX_BYTES = 5 * 1024 * 1024

export type FileInput = { buffer: Buffer; fileName: string; contentType: string | null }

export function decodeBase64File(base64Content: string): Buffer {
  const buffer = Buffer.from(base64Content, 'base64')
  if (buffer.byteLength === 0) throw new Error('File content is empty')
  assertWithinLimit(buffer.byteLength)
  return buffer
}

function assertWithinLimit(bytes: number) {
  if (bytes > MCP_UPLOAD_MAX_BYTES) {
    throw new Error(`File exceeds the 5 MB limit (${bytes} bytes)`)
  }
}

/**
 * A file name safe to use as one storage path segment. Names can come from a
 * remote server's Content-Disposition, so nothing about them is trusted.
 */
export function cleanFileName(raw: string): string {
  const base = path.posix.basename(raw.replace(/\\/g, '/'))
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/^\.+/, '').trim().slice(0, 200)
  return cleaned || 'download'
}

// ---------------------------------------------------------------------------
// Fetching a file by URL
//
// The server fetches the URL itself, so this is an SSRF surface: the app sits
// on a Docker network beside Postgres, n8n and Gotenberg. Only https on the
// default port is allowed, and every address a hostname resolves to is
// checked inside the socket's own DNS lookup, so a name cannot pass the
// check and then rebind to a private address before the connection opens.
// Redirects are followed by hand so each hop is checked the same way.
// ---------------------------------------------------------------------------

// Two lists, because a BlockList also matches IPv4 addresses against IPv6
// rules through their mapped form — one list holding ::ffff:0:0/96 blocks
// every IPv4 address on the internet.
const blockedV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4')
}
const blockedV6 = new BlockList()
for (const [network, prefix] of [
  ['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6')
}

const isBlockedAddress = (address: string, family: number) =>
  family === 6 ? blockedV6.check(address, 'ipv6') : blockedV4.check(address, 'ipv4')

function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean },
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, '')
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address, a.family))) {
      return callback(new Error(`${hostname} is not a public internet address`), '')
    }
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

function assertFetchableUrl(url: URL) {
  if (url.protocol !== 'https:') throw new Error('Only https:// links can be fetched')
  if (url.username || url.password) throw new Error('Links with embedded credentials are not accepted')
  if (url.port && url.port !== '443') throw new Error('Only the standard https port is allowed')
  // An IP literal skips DNS, so the lookup check above never sees it.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  if (family && isBlockedAddress(host, family)) throw new Error(`${host} is not a public internet address`)
}

/**
 * Sharing links open a viewer page rather than the file; point them at the
 * download instead. Google files must be shared "Anyone with the link".
 */
function toDirectDownloadUrl(url: URL): URL {
  if (url.hostname === 'drive.google.com') {
    const id = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get('id')
    if (id) return new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`)
  }
  if (url.hostname === 'docs.google.com') {
    const match = url.pathname.match(/^\/(presentation|document|spreadsheets)\/d\/([^/]+)/)
    if (match) {
      const format = { presentation: 'pptx', document: 'docx', spreadsheets: 'xlsx' }[match[1] as 'presentation' | 'document' | 'spreadsheets']
      return new URL(`https://docs.google.com/${match[1]}/d/${encodeURIComponent(match[2])}/export/${format}`)
    }
  }
  return url
}

type Hop =
  | { kind: 'redirect'; location: URL }
  | { kind: 'file'; buffer: Buffer; contentType: string | null; disposition: string | null }

function fetchOnce(url: URL): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { lookup: publicOnlyLookup as never, timeout: 20_000, headers: { 'user-agent': 'DINO-MCP/1.0', accept: '*/*' } },
      (response) => {
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume()
          return resolve({ kind: 'redirect', location: new URL(response.headers.location, url) })
        }
        if (status !== 200) {
          response.resume()
          return reject(new Error(`The link returned HTTP ${status}`))
        }
        const declared = Number(response.headers['content-length'])
        if (Number.isFinite(declared) && declared > MCP_UPLOAD_MAX_BYTES) {
          request.destroy()
          return reject(new Error(`File exceeds the 5 MB limit (${declared} bytes)`))
        }
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total > MCP_UPLOAD_MAX_BYTES) {
            request.destroy()
            return reject(new Error('File exceeds the 5 MB limit'))
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve({
          kind: 'file',
          buffer: Buffer.concat(chunks),
          contentType: response.headers['content-type']?.split(';')[0].trim().toLowerCase() || null,
          disposition: response.headers['content-disposition'] ?? null,
        }))
        response.on('error', reject)
      },
    )
    request.on('timeout', () => request.destroy(new Error('The link took too long to respond')))
    request.on('error', reject)
  })
}

function fileNameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null
  const extended = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/)?.[1]
  if (extended) {
    try {
      return decodeURIComponent(extended.trim())
    } catch {
      // fall through to the plain parameter
    }
  }
  return disposition.match(/filename\s*=\s*"([^"]+)"/)?.[1] ?? disposition.match(/filename\s*=\s*([^;]+)/)?.[1]?.trim() ?? null
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export async function fetchFileFromUrl(rawUrl: string, fileName?: string | null): Promise<FileInput> {
  let url: URL
  try {
    url = toDirectDownloadUrl(new URL(rawUrl))
  } catch {
    throw new Error('Not a valid URL')
  }

  for (let hop = 0; hop <= 5; hop += 1) {
    assertFetchableUrl(url)
    const result = await fetchOnce(url)
    if (result.kind === 'redirect') {
      url = result.location
      continue
    }
    if (result.buffer.byteLength === 0) throw new Error('The link returned an empty file')
    // A web page means the link is a viewer or sign-in page, not the file —
    // and DINO serves uploads inline, so it must not store HTML either.
    if (result.contentType === 'text/html' || result.contentType === 'application/xhtml+xml') {
      throw new Error(
        'The link returned a web page, not a file. Use a direct download link; a Google Drive file must be shared "Anyone with the link".',
      )
    }
    // SVG can carry script and would be served inline from DINO's origin.
    if (result.contentType === 'image/svg+xml') {
      throw new Error('SVG files cannot be uploaded by link. Convert the image to PNG first.')
    }
    return {
      buffer: result.buffer,
      fileName: cleanFileName(fileName || fileNameFromDisposition(result.disposition) || safeDecode(url.pathname)),
      contentType: result.contentType,
    }
  }
  throw new Error('The link redirected too many times')
}
