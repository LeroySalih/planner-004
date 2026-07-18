import "server-only"

const CONVERT_PATH = "/forms/libreoffice/convert"

export function isGotenbergConfigured(): boolean {
  return Boolean(process.env.GOTENBERG_URL)
}

/**
 * Convert an office document (e.g. .pptx) to PDF via a Gotenberg service.
 * Requires GOTENBERG_URL (and optionally GOTENBERG_USERNAME/PASSWORD for basic
 * auth). Gotenberg picks the converter from the file extension, so `fileName`
 * must keep its real extension. Returns the PDF bytes or a friendly error.
 */
export async function convertToPdfViaGotenberg(
  fileBuffer: Buffer,
  fileName: string,
): Promise<{ pdf: Buffer | null; error: string | null }> {
  const baseUrl = process.env.GOTENBERG_URL
  if (!baseUrl) {
    return {
      pdf: null,
      error: "PowerPoint conversion isn't configured on this server.",
    }
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${CONVERT_PATH}`
  const headers: Record<string, string> = {}
  const username = process.env.GOTENBERG_USERNAME
  const password = process.env.GOTENBERG_PASSWORD
  if (username && password) {
    headers.Authorization =
      "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  }

  const form = new FormData()
  form.append("files", new Blob([new Uint8Array(fileBuffer)]), fileName)

  try {
    const response = await fetch(url, { method: "POST", headers, body: form })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      console.error(
        "[gotenberg] conversion failed",
        response.status,
        detail.slice(0, 500),
      )
      return {
        pdf: null,
        error: `The conversion service returned an error (${response.status}).`,
      }
    }
    const arrayBuffer = await response.arrayBuffer()
    return { pdf: Buffer.from(arrayBuffer), error: null }
  } catch (error) {
    console.error("[gotenberg] request failed", error)
    return { pdf: null, error: "Could not reach the conversion service." }
  }
}
