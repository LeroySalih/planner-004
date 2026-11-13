// Opening a .pptx safely: the file type is checked from its first bytes,
// the zip's entry count and the bytes decompressed are capped (a zip bomb
// stops at the cap), and every relationship target is resolved inside the
// package. Nothing in the file is ever run.

import { createHash } from "node:crypto"

import JSZip from "jszip"

import { PptxInspectError } from "./errors"
import { parseXml, type XmlElement } from "./xml"

export const MAX_ENTRIES = 2000
export const MAX_XML_BYTES = 50 * 1024 * 1024
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const HEADER_BYTES = 1024 * 1024

const OLD_PPT_MESSAGE = "This is an old .ppt file. Open it in PowerPoint and save it as a .pptx."
const NOT_PPTX_MESSAGE = "This is not a PowerPoint .pptx file."
const DAMAGED_MESSAGE = "This PowerPoint file is damaged and could not be read."

export type Relationship = {
  id: string
  type: string
  target: string
  external: boolean
  // The package part a relationship points at, e.g. "ppt/slides/slide3.xml".
  part: string | null
}

export type PptxPackage = {
  entryNames: string[]
  hasPart: (part: string) => boolean
  readXml: (part: string) => Promise<XmlElement | null>
  rels: (part: string) => Promise<Relationship[]>
  readMedia: (part: string) => Promise<MediaBytes | null>
}

export type MediaBytes = {
  bytes: number
  sha256: string | null
  header: Uint8Array
  // The whole file, when it was read within the media budget.
  data: Uint8Array | null
}

function startsWith(buffer: Uint8Array, bytes: number[]) {
  return bytes.every((b, i) => buffer[i] === b)
}

function containsUtf16(buffer: Uint8Array, text: string) {
  const needle = Buffer.from(text, "utf16le")
  return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).indexOf(needle) !== -1
}

export function checkFileType(buffer: Uint8Array) {
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0])) {
    // A password-protected .pptx is also a compound file, holding an
    // EncryptedPackage stream; telling the pupil to re-save as .pptx would
    // not help them.
    if (containsUtf16(buffer, "EncryptedPackage")) {
      throw new PptxInspectError(
        "This PowerPoint file is password-protected. Remove the password in PowerPoint and save it again.",
        "OLE compound file with EncryptedPackage",
      )
    }
    throw new PptxInspectError(OLD_PPT_MESSAGE, "OLE compound file (D0 CF 11 E0)")
  }
  if (!startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    throw new PptxInspectError(NOT_PPTX_MESSAGE, "no zip signature")
  }
}

// The resolved part name for a relationship target, relative to the part that
// owns the .rels file. Returns null for a target that leaves the package.
export function resolveTarget(fromPart: string, target: string): string | null {
  const base = target.startsWith("/") ? [] : fromPart.split("/").slice(0, -1)
  const segments = [...base]
  for (const segment of target.replace(/^\//, "").split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  try {
    return segments.map((s) => decodeURIComponent(s)).join("/")
  } catch {
    return segments.join("/")
  }
}

function relsPartFor(part: string) {
  const parts = part.split("/")
  const file = parts.pop()
  return [...parts, "_rels", `${file}.rels`].join("/")
}

// JSZip's typings omit internalStream and the central directory's sizes.
type EntryStream = {
  on(event: "data", listener: (chunk: Uint8Array) => void): EntryStream
  on(event: "error", listener: (error: Error) => void): EntryStream
  on(event: "end", listener: () => void): EntryStream
  pause(): EntryStream
  resume(): EntryStream
}

type ZipEntry = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number }
  internalStream(type: "uint8array"): EntryStream
}

// Reads one entry, stopping once `limit` bytes have come out. `stopEarly`
// returns what was read so far instead of failing (for image headers).
function readEntry(entry: ZipEntry, limit: number, stopEarly = false): Promise<{ data: Uint8Array; complete: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let total = 0
    let settled = false
    const stream = entry.internalStream("uint8array")
    const finish = (complete: boolean) => {
      settled = true
      resolve({ data: Buffer.concat(chunks), complete })
    }
    stream
      .on("data", (chunk: Uint8Array) => {
        if (settled) return
        total += chunk.length
        if (total > limit) {
          stream.pause()
          if (stopEarly) {
            chunks.push(chunk.subarray(0, chunk.length - (total - limit)))
            finish(false)
          } else {
            settled = true
            reject(new PptxInspectError(DAMAGED_MESSAGE, `${entry.name} decompresses past the size limit`))
          }
          return
        }
        chunks.push(chunk)
      })
      .on("error", (error: Error) => {
        if (settled) return
        settled = true
        reject(new PptxInspectError(DAMAGED_MESSAGE, `${entry.name}: ${error.message}`))
      })
      .on("end", () => {
        if (!settled) finish(true)
      })
      .resume()
  })
}

// The entry count from the zip's end-of-central-directory record, read before
// JSZip builds an object per entry. 0xFFFF means a Zip64 archive, which no
// real .pptx needs.
function declaredEntryCount(buffer: Buffer): number | null {
  const from = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= from; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return buffer.readUInt16LE(i + 10)
  }
  return null
}

export async function openPackage(buffer: Buffer): Promise<PptxPackage> {
  checkFileType(buffer)
  const declared = declaredEntryCount(buffer)
  if (declared !== null && declared > MAX_ENTRIES) {
    throw new PptxInspectError(DAMAGED_MESSAGE, `${declared} zip entries declared (limit ${MAX_ENTRIES})`)
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: false })
  } catch (error) {
    throw new PptxInspectError(NOT_PPTX_MESSAGE, error instanceof Error ? error.message : String(error))
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir) as ZipEntry[]
  if (entries.length > MAX_ENTRIES) {
    throw new PptxInspectError(DAMAGED_MESSAGE, `${entries.length} zip entries (limit ${MAX_ENTRIES})`)
  }
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ""), e]))
  if (!byName.has("ppt/presentation.xml")) {
    throw new PptxInspectError(NOT_PPTX_MESSAGE, "no ppt/presentation.xml")
  }

  let xmlBudget = MAX_XML_BYTES
  let mediaBudget = MAX_MEDIA_BYTES
  const xmlCache = new Map<string, Promise<XmlElement | null>>()
  const relsCache = new Map<string, Promise<Relationship[]>>()
  const mediaCache = new Map<string, Promise<MediaBytes | null>>()

  const readXml = (part: string) => {
    const cached = xmlCache.get(part)
    if (cached) return cached
    const promise = (async () => {
      const entry = byName.get(part)
      if (!entry) return null
      const declared = entry._data?.uncompressedSize ?? 0
      if (declared > xmlBudget) {
        throw new PptxInspectError(DAMAGED_MESSAGE, `XML parts exceed ${MAX_XML_BYTES} bytes at ${part}`)
      }
      const { data } = await readEntry(entry, xmlBudget)
      xmlBudget -= data.length
      return parseXml(Buffer.from(data).toString("utf8"), part)
    })()
    xmlCache.set(part, promise)
    return promise
  }

  const rels = (part: string) => {
    const cached = relsCache.get(part)
    if (cached) return cached
    const promise = (async () => {
      const root = await readXml(relsPartFor(part))
      if (!root) return []
      return root.children
        .filter((c) => c.name === "Relationship")
        .map((c) => {
          const target = c.attrs.Target ?? ""
          const external = c.attrs.TargetMode === "External"
          return {
            id: c.attrs.Id ?? "",
            type: (c.attrs.Type ?? "").split("/").pop() ?? "",
            target,
            external,
            part: external ? null : resolveTarget(part, target),
          }
        })
    })()
    relsCache.set(part, promise)
    return promise
  }

  const readMedia = (part: string) => {
    const cached = mediaCache.get(part)
    if (cached) return cached
    const promise = (async () => {
      const entry = byName.get(part)
      if (!entry) return null
      const declared = entry._data?.uncompressedSize ?? 0
      if (declared <= mediaBudget) {
        const { data, complete } = await readEntry(entry, mediaBudget, true)
        mediaBudget -= data.length
        if (complete) {
          return {
            bytes: data.length,
            sha256: createHash("sha256").update(data).digest("hex"),
            header: data.subarray(0, HEADER_BYTES),
            data,
          }
        }
        return { bytes: declared, sha256: null, header: data.subarray(0, HEADER_BYTES), data: null }
      }
      // Past the media budget: read only enough for the pixel size.
      const { data } = await readEntry(entry, HEADER_BYTES, true)
      return { bytes: declared, sha256: null, header: data, data: null }
    })()
    mediaCache.set(part, promise)
    return promise
  }

  return {
    entryNames: [...byName.keys()],
    hasPart: (part) => byName.has(part),
    readXml,
    rels,
    readMedia,
  }
}
