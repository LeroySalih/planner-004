import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const execFileAsync = promisify(execFile)

export interface ExtractedImage {
  buffer: Buffer
  mimeType: string
  /** 1-based page the image appears on (best effort from pdfimages -list). */
  page: number
}

export interface ExtractPdfImagesResult {
  images: ExtractedImage[]
  error: string | null
}

// Skip tiny raster images (logos, bullets, rules, spacers) — they add noise and
// waste image-input tokens. Formative figures are comfortably larger than this.
const MIN_DIMENSION = 64

/**
 * Extract embedded RASTER images from a PDF using poppler (`pdfimages -png`).
 * Vector graphics are not extractable this way. Requires `poppler-utils`.
 * Returns images in document order, capped at `maxImages`, with tiny decorative
 * images filtered out. Cleans up all temp files.
 */
export async function extractPdfImages(
  pdfBuffer: Buffer,
  maxImages = 20,
): Promise<ExtractPdfImagesResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "pdf-images-"))
  const pdfPath = path.join(dir, "doc.pdf")

  try {
    await writeFile(pdfPath, pdfBuffer)

    // `pdfimages -list` gives one row per image with page number and dimensions,
    // so we can filter tiny images and keep page/order info.
    let listing = ""
    try {
      const { stdout } = await execFileAsync("pdfimages", ["-list", pdfPath])
      listing = stdout
    } catch {
      return { images: [], error: "Could not read images from the PDF." }
    }

    // Columns: page num type width height color comp bpc enc interp object ID ...
    const rows = listing
      .split("\n")
      .slice(2) // skip header + separator
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 5 && /^\d+$/.test(cols[0]))
      .map((cols) => ({
        page: Number.parseInt(cols[0], 10),
        num: Number.parseInt(cols[1], 10),
        width: Number.parseInt(cols[3], 10),
        height: Number.parseInt(cols[4], 10),
      }))

    const keep = new Set(
      rows.filter((r) => r.width >= MIN_DIMENSION && r.height >= MIN_DIMENSION).map((r) => r.num),
    )
    if (keep.size === 0) return { images: [], error: null }

    try {
      // -png forces PNG output for web compatibility. Files are named
      // <root>-<NNN>.png where NNN is the image number (matches the -list `num`).
      await execFileAsync("pdfimages", ["-png", pdfPath, path.join(dir, "img")])
    } catch {
      return { images: [], error: "Failed to extract images from the PDF." }
    }

    const pageByNum = new Map(rows.map((r) => [r.num, r.page]))
    const entries = await readdir(dir)
    const files = entries
      .map((name) => {
        const m = name.match(/^img-(\d+)\.png$/)
        return m ? { name, num: Number.parseInt(m[1], 10) } : null
      })
      .filter((e): e is { name: string; num: number } => e !== null && keep.has(e.num))
      .sort((a, b) => a.num - b.num)
      .slice(0, maxImages)

    const images = await Promise.all(
      files.map(async (f) => ({
        buffer: await readFile(path.join(dir, f.name)),
        mimeType: "image/png",
        page: pageByNum.get(f.num) ?? 0,
      })),
    )

    return { images, error: null }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
