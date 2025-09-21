"use server"

const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i
const OG_TITLE_REGEX = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i
const TWITTER_TITLE_REGEX = /<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
}

export async function fetchLessonLinkMetadataAction(url: string) {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) {
      return { success: false, error: "Only HTTP/HTTPS links are supported", title: null }
    }

    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LessonMetadataBot/1.0; +https://example.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      return { success: false, error: `Failed to fetch metadata (${response.status})`, title: null }
    }

    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("text/html")) {
      return { success: true, title: null }
    }

    const text = await response.text()

    const matchOg = text.match(OG_TITLE_REGEX)
    if (matchOg?.[1]) {
      return { success: true, title: decodeHtml(matchOg[1]) }
    }

    const matchTwitter = text.match(TWITTER_TITLE_REGEX)
    if (matchTwitter?.[1]) {
      return { success: true, title: decodeHtml(matchTwitter[1]) }
    }

    const matchTitle = text.match(TITLE_REGEX)
    if (matchTitle?.[1]) {
      return { success: true, title: decodeHtml(matchTitle[1]) }
    }

    return { success: true, title: null }
  } catch (error) {
    console.error("[v0] Failed to fetch link metadata:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error", title: null }
  }
}
