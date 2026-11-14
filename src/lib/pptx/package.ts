// Opening an Office file (.pptx, .docx) safely: the file type is checked from
// its first bytes, the zip's entry count and the bytes decompressed are capped
// (a zip bomb stops at the cap), a DOCTYPE or entity declaration is refused,
// and every relationship target is resolved inside the package. Nothing in
// the file is ever run.

import { createHash } from "node:crypto"

import JSZip from "jszip"

import { DocxReadError, PptxInspectError, type OfficeFileError } from "./errors"
import { parseXml, type XmlElement, type XmlRefusal } from "./xml"

export const MAX_ENTRIES = 2000
export const MAX_XML_BYTES = 50 * 1024 * 1024
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const HEADER_BYTES = 1024 * 1024

// What a refusal says to the pupil or teacher, per file kind.
export type OfficePackageMessages = {
  // An OLE compound file without an EncryptedPackage stream: the old binary format.
  oldFormat: string
  passwordProtected: string
  // Not a zip, or a zip without the kind's main part.
  notThisType: string
  damaged: string
  error: (message: string, detail: string) => OfficeFileError
}

export const PPTX_MESSAGES: OfficePackageMessages = {
  oldFormat: "This is an old .ppt file. Open it in PowerPoint and save it as a .pptx.",
  passwordProtected: "This PowerPoint file is password-protected. Remove the password in PowerPoint and save it again.",
  notThisType: "This is not a PowerPoint .pptx file.",
  damaged: "This PowerPoint file is damaged and could not be read.",
  error: (message, detail) => new PptxInspectError(message, detail),
}

export const DOCX_MESSAGES: OfficePackageMessages = {
  oldFormat: "This is an old .doc file. Open it in Word and save it as a .docx.",
  passwordProtected: "This Word file is password-protected. Remove the password in Word and save it again.",
  notThisType: "This is not a Word .docx file.",
  damaged: "This Word file is damaged and could not be read.",
  error: (message, detail) => new DocxReadError(message, detail),
}

export const PPTX_MAIN_PART = "ppt/presentation.xml"
export const DOCX_MAIN_PART = "word/document.xml"

export type Relationship = {
  id: string
  type: string
  target: string
  external: boolean
  // The package part a relationship points at, e.g. "ppt/slides/slide3.xml".
  part: string | null
}

export type OfficePackage = {
  // The main part: ppt/presentation.xml, or the .docx's officeDocument part.
  mainPart: string
  entryNames: string[]
  hasPart: (part: string) => boolean
  readXml: (part: string) => Promise<XmlElement | null>
  rels: (part: string) => Promise<Relationship[]>
  readMedia: (part: string) => Promise<MediaBytes | null>
}

export type PptxPackage = OfficePackage

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

// Refuses anything that is not a zip, naming the old binary format and a
// password-protected file (also a compound file, holding an EncryptedPackage
// stream; telling the pupil to re-save in the new format would not help them).
export function checkOfficeFileType(buffer: Uint8Array, messages: OfficePackageMessages) {
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0])) {
    if (containsUtf16(buffer, "EncryptedPackage")) {
      throw messages.error(messages.passwordProtected, "OLE compound file with EncryptedPackage")
    }
    throw messages.error(messages.oldFormat, "OLE compound file (D0 CF 11 E0)")
  }
  if (!startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    throw messages.error(messages.notThisType, "no zip signature")
  }
}

export function checkFileType(buffer: Uint8Array) {
  checkOfficeFileType(buffer, PPTX_MESSAGES)
}

export function checkDocxFileType(buffer: Uint8Array) {
  checkOfficeFileType(buffer, DOCX_MESSAGES)
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
function readEntry(
  entry: ZipEntry,
  limit: number,
  messages: OfficePackageMessages,
  stopEarly = false,
): Promise<{ data: Uint8Array; complete: boolean }> {
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
            reject(messages.error(messages.damaged, `${entry.name} decompresses past the size limit`))
          }
          return
        }
        chunks.push(chunk)
      })
      .on("error", (error: Error) => {
        if (settled) return
        settled = true
        reject(messages.error(messages.damaged, `${entry.name}: ${error.message}`))
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
  return openOfficePackage(buffer, { mainPart: PPTX_MAIN_PART, messages: PPTX_MESSAGES })
}

// A .docx's main part is wherever _rels/.rels says (word/document.xml when it
// says nothing usable), and must be a w:document.
export async function openDocxPackage(buffer: Buffer): Promise<OfficePackage> {
  return openOfficePackage(buffer, { mainPart: DOCX_MAIN_PART, messages: DOCX_MESSAGES, mainPartFromRels: true, mainPartRoot: "document" })
}

export async function openOfficePackage(
  buffer: Buffer,
  options: { mainPart: string; messages: OfficePackageMessages; mainPartFromRels?: boolean; mainPartRoot?: string },
): Promise<OfficePackage> {
  const { messages } = options
  const refusal: XmlRefusal = { notThisType: messages.notThisType, damaged: messages.damaged, error: messages.error }
  checkOfficeFileType(buffer, messages)
  const declared = declaredEntryCount(buffer)
  if (declared !== null && declared > MAX_ENTRIES) {
    throw messages.error(messages.damaged, `${declared} zip entries declared (limit ${MAX_ENTRIES})`)
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: false })
  } catch (error) {
    throw messages.error(messages.notThisType, error instanceof Error ? error.message : String(error))
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir) as ZipEntry[]
  if (entries.length > MAX_ENTRIES) {
    throw messages.error(messages.damaged, `${entries.length} zip entries (limit ${MAX_ENTRIES})`)
  }
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ""), e]))

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
        throw messages.error(messages.damaged, `XML parts exceed ${MAX_XML_BYTES} bytes at ${part}`)
      }
      const { data } = await readEntry(entry, xmlBudget, messages)
      xmlBudget -= data.length
      return parseXml(Buffer.from(data).toString("utf8"), part, refusal)
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
        const { data, complete } = await readEntry(entry, mediaBudget, messages, true)
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
      const { data } = await readEntry(entry, HEADER_BYTES, messages, true)
      return { bytes: declared, sha256: null, header: data, data: null }
    })()
    mediaCache.set(part, promise)
    return promise
  }

  let mainPart = options.mainPart
  if (options.mainPartFromRels) {
    const root = await readXml("_rels/.rels")
    const declared = root?.children
      .filter((c) => c.name === "Relationship" && c.attrs.TargetMode !== "External")
      .find((c) => (c.attrs.Type ?? "").split("/").pop() === "officeDocument")
    const part = declared ? resolveTarget("", declared.attrs.Target ?? "") : null
    if (part && byName.has(part)) mainPart = part
  }
  if (!byName.has(mainPart)) {
    throw messages.error(messages.notThisType, `no ${mainPart}`)
  }
  // The main part must be this kind's (a .pptx's _rels/.rels also names an
  // officeDocument part).
  if (options.mainPartRoot && (await readXml(mainPart))?.name !== options.mainPartRoot) {
    throw messages.error(messages.notThisType, `${mainPart} is not a ${options.mainPartRoot}`)
  }

  return {
    mainPart,
    entryNames: [...byName.keys()],
    hasPart: (part) => byName.has(part),
    readXml,
    rels,
    readMedia,
  }
}
