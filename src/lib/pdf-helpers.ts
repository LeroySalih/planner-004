// src/lib/pdf-helpers.ts
import QRCode from "qrcode"

import { createLocalStorageClient } from "@/lib/storage/local-storage"

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
 * Read an activity image directly from local disk storage, bypassing the HTTP layer.
 * The /api/files route requires a session cookie, so server-to-server fetches would
 * fail with 401. This reads via the storage client instead.
 */
export async function fetchActivityImageAsDataUri(
  lessonId: string,
  activityId: string,
  fileName: string,
): Promise<string | null> {
  try {
    const storage = createLocalStorageClient("lessons")
    const fullPath = `${lessonId}/activities/${activityId}/${fileName}`
    const { stream, metadata } = await storage.getFileStream(fullPath)
    if (!stream || !metadata) return null

    const chunks: Buffer[] = []
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)

    const typedMeta = metadata as { content_type?: string }
    const contentType = typedMeta.content_type || inferImageContentType(fileName)
    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch {
    return null
  }
}

function inferImageContentType(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".webp")) return "image/webp"
  return "image/jpeg"
}

/**
 * Fetch a YouTube video thumbnail as a data URI, trying multiple resolutions.
 * YouTube returns a tiny placeholder (~1 KB) when the resolution isn't available,
 * so we skip results under 2 KB.
 */
export async function fetchYouTubeThumbnailAsDataUri(videoId: string): Promise<string | null> {
  const resolutions = ["hqdefault", "mqdefault", "0"]
  for (const res of resolutions) {
    try {
      const response = await fetch(`https://img.youtube.com/vi/${videoId}/${res}.jpg`)
      if (!response.ok) continue
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength < 2000) continue // skip tiny placeholder images
      return `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`
    } catch {
      continue
    }
  }
  return null
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
      // Standard watch URL: ?v=ID
      const v = parsed.searchParams.get("v")
      if (v) return v
      // Shorts/embed: /shorts/ID or /embed/ID
      const segments = parsed.pathname.split("/").filter(Boolean)
      const idx = segments.findIndex((s) => s === "shorts" || s === "embed")
      if (idx !== -1 && segments[idx + 1]) return segments[idx + 1]
      return null
    }
    if (host === "youtu.be") {
      return parsed.pathname.slice(1).split("?")[0] || null
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
