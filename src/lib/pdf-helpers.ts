// src/lib/pdf-helpers.ts
import QRCode from "qrcode"

/**
 * Fetch a URL (relative or absolute) and return it as a base64 data URI.
 * Returns null on any failure so the PDF can degrade gracefully.
 */
export async function fetchAsDataUri(url: string, baseUrl: string): Promise<string | null> {
  try {
    const fullUrl = url.startsWith("/") ? `${baseUrl}${url}` : url
    const res = await fetch(fullUrl)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const contentType = res.headers.get("content-type") || "image/jpeg"
    const base64 = Buffer.from(buffer).toString("base64")
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

/**
 * Generate a QR code for a URL as a PNG data URI.
 * Returns null if the URL is invalid or generation fails.
 */
export async function generateQrDataUri(url: string): Promise<string | null> {
  try {
    new URL(url) // validate URL
    return await QRCode.toDataURL(url, { width: 150, margin: 1 })
  } catch {
    return null
  }
}

/**
 * Extract the YouTube video ID from a YouTube URL.
 * Returns null if not a YouTube URL or ID cannot be parsed.
 */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace("www.", "")
    if (host === "youtube.com" || host === "m.youtube.com") {
      return parsed.searchParams.get("v")
    }
    if (host === "youtu.be") {
      return parsed.pathname.slice(1) || null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get base URL from a Request object for resolving relative image paths.
 */
export function getBaseUrl(request: Request): string {
  const host = request.headers.get("host") || "localhost:3000"
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"
  return `${proto}://${host}`
}
