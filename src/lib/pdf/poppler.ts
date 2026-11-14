import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

// PDF facts via poppler-utils (pdfinfo, pdftotext, pdftoppm), run with
// execFile on a copy of the PDF in a temp directory that is always removed.
// The PDF is never opened by anything else here, and nothing in it is run.

export const PDF_TOOL_TIMEOUT_MS = 120_000
// pdftotext's output is read up to this many bytes; past it the call fails
// rather than filling memory.
const MAX_TOOL_OUTPUT_BYTES = 32 * 1024 * 1024

const execFileAsync = promisify(execFile)

const UNREADABLE_PDF_MESSAGE = "Could not read the PDF. Is it a valid PDF file?"
const RENDER_FAILED_MESSAGE = "Failed to convert the PDF to images."

/**
 * The tool ran and refused the file (a non-zero exit): the PDF itself is bad.
 * Anything else (the tool missing, a timeout, too much output, a full disk)
 * is thrown as a plain Error with the same message, so a caller that shows
 * the message shows the same words, and a job that retries can tell the two
 * apart.
 */
export class UnreadablePdfError extends Error {}

/** The tool's failure as UnreadablePdfError when it exited non-zero, else a plain Error. */
function toolFailure(error: unknown, message: string): Error {
  const failure = error as { code?: unknown; killed?: boolean; signal?: unknown }
  const refused = typeof failure?.code === "number" && failure.code !== 0 && !failure.killed && !failure.signal
  return refused ? new UnreadablePdfError(message) : new Error(message, { cause: error })
}

/** Runs `use` with the PDF written to a temp file; the directory is always removed. */
async function withTempPdf<T>(bytes: Buffer, use: (pdfPath: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "dino-pdf-"))
  const pdfPath = path.join(dir, "file.pdf")
  try {
    await writeFile(pdfPath, bytes)
    return await use(pdfPath, dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function pageCountAt(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { timeout: PDF_TOOL_TIMEOUT_MS })
    return Number.parseInt(stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? "0", 10)
  } catch (error) {
    throw toolFailure(error, UNREADABLE_PDF_MESSAGE)
  }
}

/**
 * The PDF's page count from pdfinfo. Throws "Could not read the PDF…": an
 * UnreadablePdfError for a file pdfinfo refuses, a plain Error when pdfinfo
 * could not run.
 */
export async function pdfPageCount(bytes: Buffer): Promise<number> {
  return withTempPdf(bytes, (pdfPath) => pageCountAt(pdfPath))
}

export type PdfText = {
  text: string
  // The text before any cap, in characters.
  chars: number
  truncated: boolean
}

/**
 * The PDF's text from `pdftotext -layout` (columns kept as spacing), capped
 * at `maxChars`. Pages are separated by form feeds, as pdftotext writes them.
 */
export async function pdfText(bytes: Buffer, options: { maxChars: number }): Promise<PdfText> {
  return withTempPdf(bytes, async (pdfPath) => {
    let stdout: string
    try {
      ;({ stdout } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
        timeout: PDF_TOOL_TIMEOUT_MS,
        maxBuffer: MAX_TOOL_OUTPUT_BYTES,
      }))
    } catch (error) {
      throw toolFailure(error, UNREADABLE_PDF_MESSAGE)
    }
    const chars = stdout.length
    const truncated = chars > options.maxChars
    return { text: truncated ? stdout.slice(0, options.maxChars) : stdout, chars, truncated }
  })
}

/**
 * Pages of a PDF as PNGs from pdftoppm at `dpi`, in page order: every page,
 * or `firstPage`..`lastPage` (1-based, inclusive). The PNGs are pdftoppm's
 * own; callers normalise them.
 */
export async function pdfToPngPages(
  bytes: Buffer,
  options: { dpi: number; firstPage?: number; lastPage?: number },
): Promise<Buffer[]> {
  return withTempPdf(bytes, async (pdfPath, dir) => {
    const range = [
      ...(options.firstPage !== undefined ? ["-f", String(options.firstPage)] : []),
      ...(options.lastPage !== undefined ? ["-l", String(options.lastPage)] : []),
    ]
    try {
      await execFileAsync("pdftoppm", [...range, "-r", String(options.dpi), "-png", pdfPath, path.join(dir, "page")], {
        timeout: PDF_TOOL_TIMEOUT_MS,
      })
    } catch (error) {
      throw toolFailure(error, RENDER_FAILED_MESSAGE)
    }
    // pdftoppm names pages page-<n>.png, zero-padded to the page count's
    // width, so they are sorted by number rather than by name.
    const pages = (await readdir(dir))
      .map((name) => ({ name, index: Number.parseInt(name.match(/^page-(\d+)\.png$/)?.[1] ?? "", 10) }))
      .filter((entry) => Number.isFinite(entry.index))
      .sort((a, b) => a.index - b.index)
    return Promise.all(pages.map((entry) => readFile(path.join(dir, entry.name))))
  })
}
