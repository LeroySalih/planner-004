import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const execFileAsync = promisify(execFile)

export interface RasterizeOptions {
  /** Reject the PDF if it has more than this many pages. */
  maxPages: number
  /** Render resolution in DPI (before scaling). */
  dpi?: number
  /** Cap the output width in pixels (aspect ratio preserved). */
  maxWidth?: number
}

export interface RasterizeResult {
  pages: Buffer[]
  error: string | null
}

/**
 * Rasterize each page of a PDF to a JPEG buffer using poppler (`pdftoppm`).
 * Requires `poppler-utils` to be installed on the host. Pages are returned in
 * document order. Enforces the page-count cap and cleans up all temp files.
 */
export async function rasterizePdfToJpegs(
  pdfBuffer: Buffer,
  options: RasterizeOptions,
): Promise<RasterizeResult> {
  const { maxPages, dpi = 150, maxWidth = 1600 } = options
  const dir = await mkdtemp(path.join(tmpdir(), "pdf-import-"))
  const pdfPath = path.join(dir, "deck.pdf")

  try {
    await writeFile(pdfPath, pdfBuffer)

    // Guard on page count first so we never rasterize an oversized deck.
    let pageCount = 0
    try {
      const { stdout } = await execFileAsync("pdfinfo", [pdfPath])
      const match = stdout.match(/^Pages:\s+(\d+)/m)
      pageCount = match ? Number.parseInt(match[1], 10) : 0
    } catch {
      return { pages: [], error: "Could not read the PDF. Is it a valid PDF file?" }
    }

    if (pageCount === 0) {
      return { pages: [], error: "The PDF has no pages." }
    }
    if (pageCount > maxPages) {
      return {
        pages: [],
        error: `The PDF has ${pageCount} pages; the maximum is ${maxPages}.`,
      }
    }

    try {
      await execFileAsync("pdftoppm", [
        "-jpeg",
        "-r", String(dpi),
        "-scale-to-x", String(maxWidth),
        "-scale-to-y", "-1",
        pdfPath,
        path.join(dir, "page"),
      ])
    } catch {
      return { pages: [], error: "Failed to convert the PDF to images." }
    }

    // pdftoppm names outputs page-<n>.jpg (zero-padded to the page count's
    // width), so sort by the numeric suffix rather than lexically.
    const entries = await readdir(dir)
    const pageFiles = entries
      .map((name) => {
        const m = name.match(/^page-(\d+)\.jpg$/)
        return m ? { name, index: Number.parseInt(m[1], 10) } : null
      })
      .filter((entry): entry is { name: string; index: number } => entry !== null)
      .sort((a, b) => a.index - b.index)

    const pages = await Promise.all(
      pageFiles.map((entry) => readFile(path.join(dir, entry.name))),
    )

    return { pages, error: null }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
