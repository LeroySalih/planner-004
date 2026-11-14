// Reading a pupil's evidence document (.docx): the text and pictures under
// each heading the teacher named, in document order. Facts only: it never
// decides whether anything earns a mark. Headings are data (the labels the
// teacher gives the questions); nothing here knows any particular paper.
//
// The body is walked in document order: paragraphs, table cells (row by row)
// and text boxes (w:txbxContent, the mc:Choice branch of an
// mc:AlternateContent; a text box's paragraphs follow the paragraph that
// holds it). A paragraph is a heading for a label when its text starts with
// the label as a whole token, optionally after "Task", "Question", "Part" or
// "Q", with any spacing, brackets or dots between the label's parts ("1a",
// "1 (a)", "1(a)", "Task 1a", "Question S1", "S1:"), and it is either
// Heading-styled, at most 120 characters, or the label is followed by ":",
// "-", "–", "—", "." or ")". "1a" never matches "1aa" and "S1" never matches
// "S10". Text after the label on the heading line is answer text. Only the
// first heading for a label counts; a later one is ordinary text.
//
// Content before the first heading, and content after a Heading-styled
// paragraph that is no label and not template text (when it is at the same
// or a higher level than the section's own Heading-styled label), is
// unplaced: kept apart for the teacher, never filed under a heading.
//
// Pictures (a:blip r:embed, v:imagedata r:id) are read through
// word/_rels/document.xml.rels and normalised with sharp: auto-rotated, long
// side at most 1600 px, PNG, or JPEG quality 85 when the PNG would exceed
// 1.5 MB. A picture sharp cannot decode (EMF, WMF, BMP, SVG…), a linked
// picture or one missing from the file is listed as not shown, by name.

import sharp from "sharp"

import { openDocxPackage, type OfficePackage, type Relationship } from "@/lib/pptx/package"
import { attr, child, kids, relAttr, resolveAlternateContent, type XmlElement } from "@/lib/pptx/xml"

const STYLES_PART = "word/styles.xml"
const NUMBERING_PART = "word/numbering.xml"

const MAX_LONG_SIDE_PX = 1600
const MAX_PNG_BYTES = 1.5 * 1024 * 1024
const JPEG_QUALITY = 85
// Pictures decoded per document; past it the rest are listed as not shown.
export const MAX_EVIDENCE_IMAGES = 60
const MAX_INPUT_PIXELS = 100_000_000
// A paragraph longer than this is a heading only when Heading-styled or the
// label is followed by a separator.
const MAX_PLAIN_HEADING_CHARS = 120
// A template paragraph shorter than this is never stripped from the start of
// a pupil's paragraph (only removed when the whole paragraph matches).
const MIN_TEMPLATE_PREFIX_CHARS = 3

export type EvidenceImage = {
  // The media file's name in the package, e.g. "image3.png".
  name: string
  data: Buffer
  mimeType: "image/png" | "image/jpeg"
  width: number
  height: number
  bytes: number
}

export type EvidenceImageNotShown = {
  name: string
  reason: string
}

export type EvidenceSection = {
  // The label asked for, as given.
  label: string
  // The heading paragraph as written in the document.
  heading: string
  text: string
  images: EvidenceImage[]
  notShown: EvidenceImageNotShown[]
}

export type EvidenceUnplaced = {
  text: string
  images: EvidenceImage[]
  notShown: EvidenceImageNotShown[]
}

export type EvidenceDocument = {
  // One per label found, in the order the labels were given.
  sections: EvidenceSection[]
  unplaced: EvidenceUnplaced
  // Labels with no heading in the document, in the order given.
  missingHeadings: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Walking the body

type ImageRef = {
  kind: "embedded" | "linked"
  relId: string
  // Characters of the paragraph's own run text before the picture.
  offset: number
  // Anchored (floating) rather than in the line of text.
  floating: boolean
}

// The innermost table cell a block sits in.
type CellRef = { table: number; row: number; col: number }

type Block = {
  // Spacing normalised, the list number (when numbered) first.
  text: string
  // The runs' own text, unnormalised: what image offsets count.
  runText: string
  numbered: boolean
  // 0 for Title, n for Heading n; null for a paragraph that is not Heading-styled.
  headingLevel: number | null
  images: ImageRef[]
  cell: CellRef | null
}

type StyleInfo = { level: number | null; numId: string | null; ilvl: number | null; basedOn: string | null }

type LevelDef = { start: number; format: string; text: string }

type Numbering = {
  level: (numId: string, ilvl: number) => LevelDef | null
  counters: Map<string, number[]>
}

type WalkContext = {
  styles: Map<string, StyleInfo>
  numbering: Numbering
  tables: number
  cell: CellRef | null
}

function normalise(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim()
}

function fold(text: string) {
  return normalise(text).toLowerCase()
}

function wAttr(el: XmlElement | null | undefined, local: string): string | null {
  return attr(el, `w:${local}`) ?? relAttr(el, local)
}

function intAttr(el: XmlElement | null | undefined, local: string): number | null {
  const value = wAttr(el, local)
  if (value === null) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

function levelFromStyleName(name: string): number | null {
  const heading = name.trim().match(/^heading\s*(\d)$/i)
  if (heading) return Number.parseInt(heading[1], 10)
  if (/^title$/i.test(name.trim())) return 0
  return null
}

function levelFromOutline(pPr: XmlElement | null): number | null {
  const n = intAttr(child(pPr, "outlineLvl"), "val")
  // Level 9 is "body text".
  return n !== null && n >= 0 && n < 9 ? n + 1 : null
}

async function partFor(pkg: OfficePackage, type: string, fallback: string): Promise<string> {
  const rel = (await pkg.rels(pkg.mainPart)).find((r) => r.type === type && !r.external && r.part)
  return rel?.part ?? fallback
}

async function readStyles(pkg: OfficePackage): Promise<Map<string, StyleInfo>> {
  const styles = new Map<string, StyleInfo>()
  const root = await pkg.readXml(await partFor(pkg, "styles", STYLES_PART))
  for (const style of kids(root, "style")) {
    if (wAttr(style, "type") !== "paragraph") continue
    const id = wAttr(style, "styleId")
    if (!id) continue
    const pPr = child(style, "pPr")
    const numPr = child(pPr, "numPr")
    styles.set(id, {
      level: levelFromStyleName(wAttr(child(style, "name"), "val") ?? "") ?? levelFromOutline(pPr),
      numId: wAttr(child(numPr, "numId"), "val"),
      ilvl: intAttr(child(numPr, "ilvl"), "val"),
      basedOn: wAttr(child(style, "basedOn"), "val"),
    })
  }
  return styles
}

// A style's own setting, else the first in its basedOn chain that has one.
function inherited<T>(styles: Map<string, StyleInfo>, styleId: string | null, pick: (s: StyleInfo) => T | null): T | null {
  let id = styleId
  for (let depth = 0; id && depth < 20; depth += 1) {
    const style = styles.get(id)
    if (!style) return null
    const value = pick(style)
    if (value !== null) return value
    id = style.basedOn
  }
  return null
}

function levelDef(lvl: XmlElement | null, base?: LevelDef): LevelDef | null {
  if (!lvl) return base ?? null
  return {
    start: intAttr(child(lvl, "start"), "val") ?? base?.start ?? 1,
    format: wAttr(child(lvl, "numFmt"), "val") ?? base?.format ?? "decimal",
    text: wAttr(child(lvl, "lvlText"), "val") ?? base?.text ?? "",
  }
}

async function readNumbering(pkg: OfficePackage): Promise<Numbering> {
  const root = await pkg.readXml(await partFor(pkg, "numbering", NUMBERING_PART))
  const abstracts = new Map<string, XmlElement>()
  for (const a of kids(root, "abstractNum")) {
    const id = wAttr(a, "abstractNumId")
    if (id !== null) abstracts.set(id, a)
  }
  const nums = new Map<string, XmlElement>()
  for (const n of kids(root, "num")) {
    const id = wAttr(n, "numId")
    if (id !== null) nums.set(id, n)
  }
  const cache = new Map<string, LevelDef | null>()
  const level = (numId: string, ilvl: number) => {
    const key = `${numId}/${ilvl}`
    if (cache.has(key)) return cache.get(key) ?? null
    const num = nums.get(numId)
    const abstract = abstracts.get(wAttr(child(num, "abstractNumId"), "val") ?? "")
    let def = levelDef(kids(abstract, "lvl").find((l) => intAttr(l, "ilvl") === ilvl) ?? null)
    const override = kids(num, "lvlOverride").find((o) => intAttr(o, "ilvl") === ilvl)
    if (override) {
      def = levelDef(child(override, "lvl"), def ?? undefined)
      const start = intAttr(child(override, "startOverride"), "val")
      if (def && start !== null) def = { ...def, start }
    }
    cache.set(key, def)
    return def
  }
  return { level, counters: new Map() }
}

function letters(n: number) {
  const index = Math.max(1, n) - 1
  return String.fromCharCode(97 + (index % 26)).repeat(Math.floor(index / 26) + 1)
}

function roman(n: number) {
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]
  let out = ""
  let rest = n
  for (const [value, digits] of table) {
    while (rest >= value) {
      out += digits
      rest -= value
    }
  }
  return out
}

function formatNumber(n: number, format: string) {
  switch (format) {
    case "lowerLetter":
      return letters(n)
    case "upperLetter":
      return letters(n).toUpperCase()
    case "lowerRoman":
      return roman(n)
    case "upperRoman":
      return roman(n).toUpperCase()
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n)
    case "none":
      return ""
    default:
      return String(n)
  }
}

// The text Word shows for a list paragraph ("1a", "2.", "(iii)"), counting in
// document order; "" for a bullet or no list.
function numberText(numbering: Numbering, numId: string | null, ilvl: number): string {
  if (!numId || numId === "0") return ""
  const def = numbering.level(numId, ilvl)
  if (!def || def.format === "bullet") return ""
  const counters = numbering.counters.get(numId) ?? []
  counters[ilvl] = counters[ilvl] === undefined ? def.start : counters[ilvl] + 1
  counters.length = ilvl + 1
  numbering.counters.set(numId, counters)
  return def.text.replace(/%([1-9])/g, (_, d: string) => {
    const at = Number.parseInt(d, 10) - 1
    const levelDefAt = numbering.level(numId, at)
    const value = counters[at] ?? levelDefAt?.start ?? 1
    return formatNumber(value, levelDefAt?.format ?? "decimal")
  })
}

type InlineState = { text: string; images: ImageRef[]; boxes: XmlElement[] }

function showingPlaceholder(sdt: XmlElement) {
  return child(child(sdt, "sdtPr"), "showingPlcHdr") !== null
}

// Pictures and text boxes inside a w:drawing, w:pict or w:object.
function graphic(el: XmlElement, state: InlineState, floating: boolean) {
  for (const c of resolveAlternateContent(el.children)) {
    const offset = state.text.length
    if (c.name === "txbxContent") {
      state.boxes.push(c)
    } else if (c.name === "blip") {
      const embed = attr(c, "r:embed") ?? relAttr(c, "embed")
      const link = attr(c, "r:link") ?? relAttr(c, "link")
      if (embed) state.images.push({ kind: "embedded", relId: embed, offset, floating })
      else if (link) state.images.push({ kind: "linked", relId: link, offset, floating })
    } else if (c.name === "imagedata") {
      const id = attr(c, "r:id") ?? attr(c, "o:relid") ?? relAttr(c, "id") ?? relAttr(c, "relid")
      if (id) state.images.push({ kind: "embedded", relId: id, offset, floating })
    } else {
      graphic(c, state, floating || c.name === "anchor")
    }
  }
}

function run(r: XmlElement, state: InlineState) {
  for (const c of resolveAlternateContent(r.children)) {
    switch (c.name) {
      case "t":
        state.text += c.text
        break
      case "tab":
      case "ptab":
      case "br":
      case "cr":
        state.text += " "
        break
      case "noBreakHyphen":
        state.text += "-"
        break
      case "drawing":
      case "pict":
      case "object":
        graphic(c, state, false)
        break
      default:
        break
    }
  }
}

function inline(children: XmlElement[], state: InlineState) {
  for (const c of resolveAlternateContent(children)) {
    switch (c.name) {
      case "r":
        run(c, state)
        break
      case "hyperlink":
      case "smartTag":
      case "ins":
      case "moveTo":
      case "customXml":
      case "fldSimple":
      case "bdo":
      case "dir":
        inline(c.children, state)
        break
      case "sdt":
        // Placeholder text ("Click or tap here to enter text.") is not an answer.
        if (!showingPlaceholder(c)) inline(child(c, "sdtContent")?.children ?? [], state)
        break
      case "drawing":
      case "pict":
        graphic(c, state, false)
        break
      // Deleted text (tracked changes) is not part of the document.
      default:
        break
    }
  }
}

function paragraph(p: XmlElement, out: Block[], ctx: WalkContext) {
  const state: InlineState = { text: "", images: [], boxes: [] }
  inline(p.children, state)
  const pPr = child(p, "pPr")
  const styleId = wAttr(child(pPr, "pStyle"), "val")
  const numPr = child(pPr, "numPr")
  const numId = numPr ? wAttr(child(numPr, "numId"), "val") : inherited(ctx.styles, styleId, (s) => s.numId)
  const ilvl = intAttr(child(numPr, "ilvl"), "val") ?? inherited(ctx.styles, styleId, (s) => s.ilvl) ?? 0
  const number = numberText(ctx.numbering, numId, ilvl)
  const level =
    levelFromOutline(pPr) ??
    (styleId
      ? inherited(ctx.styles, styleId, (s) => s.level) ?? levelFromStyleName(styleId.replace(/^heading(\d)$/i, "heading $1"))
      : null)
  out.push({
    text: normalise(number ? `${number} ${state.text}` : state.text),
    runText: state.text,
    numbered: number !== "",
    headingLevel: level,
    images: state.images,
    cell: ctx.cell,
  })
  for (const box of state.boxes) walkBlocks(box.children, out, ctx)
}

function table(el: XmlElement, out: Block[], ctx: WalkContext) {
  const outer = ctx.cell
  const id = ctx.tables
  ctx.tables += 1
  let row = -1
  const rows = (node: XmlElement) => {
    for (const c of resolveAlternateContent(node.children)) {
      if (c.name === "tr") {
        row += 1
        let col = 0
        const cells = (rowNode: XmlElement) => {
          for (const cc of resolveAlternateContent(rowNode.children)) {
            if (cc.name === "tc") {
              ctx.cell = { table: id, row, col }
              walkBlocks(cc.children, out, ctx)
              col += 1
            } else if (cc.name === "sdt") {
              const content = child(cc, "sdtContent")
              if (content) cells(content)
            } else if (cc.name === "customXml" || cc.name === "sdtContent") {
              cells(cc)
            }
          }
        }
        cells(c)
      } else if (c.name === "sdt") {
        const content = child(c, "sdtContent")
        if (content) rows(content)
      } else if (c.name === "customXml" || c.name === "sdtContent") {
        rows(c)
      }
    }
  }
  rows(el)
  ctx.cell = outer
}

function walkBlocks(children: XmlElement[], out: Block[], ctx: WalkContext) {
  for (const el of resolveAlternateContent(children)) {
    switch (el.name) {
      case "p":
        paragraph(el, out, ctx)
        break
      case "tbl":
        table(el, out, ctx)
        break
      case "sdt":
        if (!showingPlaceholder(el)) walkBlocks(child(el, "sdtContent")?.children ?? [], out, ctx)
        break
      case "customXml":
      case "ins":
      case "moveTo":
        walkBlocks(el.children, out, ctx)
        break
      default:
        break
    }
  }
}

async function readBlocks(pkg: OfficePackage): Promise<Block[]> {
  const root = await pkg.readXml(pkg.mainPart)
  const body = child(root, "body")
  const ctx: WalkContext = { styles: await readStyles(pkg), numbering: await readNumbering(pkg), tables: 0, cell: null }
  const blocks: Block[] = []
  walkBlocks(body?.children ?? [], blocks, ctx)
  return blocks
}

// ---------------------------------------------------------------------------
// Headings

type LabelMatcher = { label: string; key: string; pattern: RegExp; joints: number }

function labelKey(label: string) {
  return label.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// "1a" → 1, a with optional spacing, dots and brackets between; "S10" → s, 10.
// Each joint between parts is captured, to tell "1(a)" from "1. A".
function labelMatcher(label: string): LabelMatcher | null {
  const key = labelKey(label)
  const parts = key.match(/[a-z]+|[0-9]+/g)
  if (!parts) return null
  const body = parts.map(escapeRegExp).join("([\\s.]*[(\\[]?\\s*)")
  const pattern = new RegExp(`^(?:(?:task|question|part|q)\\s*[.:#]?\\s*)?[(\\[]?\\s*${body}\\s*[)\\]]?(?![a-z0-9])`, "i")
  return { label, key, pattern, joints: parts.length - 1 }
}

const SEPARATOR = /^\s*[:\-–—.)]/
// What may follow a label whose parts are joined only by spacing or a dot
// ("1 a", "1.a"): the end of the line or a separator, not more words, so
// "1. A screenshot must be cropped." is not 1a.
const LOOSE_LABEL_END = /^\s*($|[:\-–—)])/

type HeadingMatch = { matcher: LabelMatcher; rest: string; separated: boolean }

function matchHeading(text: string, matchers: LabelMatcher[], trusted: boolean): HeadingMatch | null {
  let best: HeadingMatch | null = null
  for (const matcher of matchers) {
    const found = matcher.pattern.exec(text)
    if (!found) continue
    if (best && best.matcher.key.length >= matcher.key.length) continue
    const after = text.slice(found[0].length)
    const loose = found.slice(1, matcher.joints + 1).some((joint) => joint !== "" && !/[(\[]/.test(joint))
    if (loose && !trusted && !/[)\]]$/.test(found[0]) && !LOOSE_LABEL_END.test(after)) continue
    best = { matcher, rest: after.replace(/^[\s:\-–—.)\]]+/, ""), separated: SEPARATOR.test(after) }
  }
  return best
}

// ---------------------------------------------------------------------------
// Template text

type Template = { exact: Set<string>; prefixes: string[] }

function buildTemplate(paragraphs: readonly string[] | undefined): Template {
  const exact = new Set<string>()
  for (const p of paragraphs ?? []) {
    const f = fold(p)
    if (f) exact.add(f)
  }
  const prefixes = [...exact].filter((p) => p.length >= MIN_TEMPLATE_PREFIX_CHARS).sort((a, b) => b.length - a.length)
  return { exact, prefixes }
}

function isTemplateText(text: string, template: Template) {
  return text !== "" && template.exact.has(text.toLowerCase())
}

// The pupil's own text in a paragraph: "" when the whole paragraph is template
// text, or what follows template text it starts with.
function subtractTemplate(text: string, template: Template): string {
  if (!text) return ""
  const f = text.toLowerCase()
  if (template.exact.has(f)) return ""
  if (f.length !== text.length) return text
  for (const prefix of template.prefixes) {
    if (f.startsWith(prefix) && !/[a-z0-9]/i.test(f.charAt(prefix.length))) {
      return text.slice(prefix.length).replace(/^[\s:\-–—.)]+/, "").trim()
    }
  }
  return text
}

// ---------------------------------------------------------------------------
// Pictures

const SUPPORTED: { format: string; test: (b: Uint8Array) => boolean }[] = [
  { format: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { format: "jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { format: "gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    format: "webp",
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    format: "tiff",
    test: (b) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a),
  },
]

function describeUnsupported(name: string, header: Uint8Array): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "emf" || ext === "wmf" || ext === "emz" || ext === "wmz") return `an ${ext.toUpperCase()} drawing, which cannot be shown`
  if (header[0] === 0x42 && header[1] === 0x4d) return "a BMP image, which cannot be shown"
  if (ext === "svg") return "an SVG image, which cannot be shown"
  return `a ${ext ? `.${ext} ` : ""}file that is not a picture that can be shown`
}

type DecodedImage = { image: EvidenceImage } | { notShown: string }

async function normaliseImage(name: string, data: Uint8Array): Promise<DecodedImage> {
  if (!SUPPORTED.some((s) => s.test(data))) return { notShown: describeUnsupported(name, data) }
  try {
    const base = sharp(data, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_LONG_SIDE_PX, height: MAX_LONG_SIDE_PX, fit: "inside", withoutEnlargement: true })
    const png = await base.clone().png().toBuffer({ resolveWithObject: true })
    if (png.data.length <= MAX_PNG_BYTES) {
      return { image: { name, data: png.data, mimeType: "image/png", width: png.info.width, height: png.info.height, bytes: png.data.length } }
    }
    const jpeg = await base.clone().flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY }).toBuffer({ resolveWithObject: true })
    return { image: { name, data: jpeg.data, mimeType: "image/jpeg", width: jpeg.info.width, height: jpeg.info.height, bytes: jpeg.data.length } }
  } catch {
    return { notShown: "a picture that could not be decoded" }
  }
}

function baseName(part: string) {
  return part.split("/").pop() ?? part
}

// ---------------------------------------------------------------------------

type Bucket = { texts: string[]; images: EvidenceImage[]; notShown: EvidenceImageNotShown[] }

function emptyBucket(): Bucket {
  return { texts: [], images: [], notShown: [] }
}

/**
 * The evidence under each of `headings` (labels such as "1a" or "S1").
 * `templateParagraphs` are the blank template's paragraphs (readDocxParagraphs
 * of it); a paragraph equal to one, ignoring case and spacing, is removed, and
 * one starting with one keeps only what follows. Headings are never removed.
 * Throws DocxReadError for a file that is not a readable .docx.
 */
export async function readEvidenceDocument(
  buffer: Buffer,
  options: { headings: readonly string[]; templateParagraphs?: readonly string[] },
): Promise<EvidenceDocument> {
  const pkg = await openDocxPackage(buffer)
  const blocks = await readBlocks(pkg)
  const template = buildTemplate(options.templateParagraphs)

  const matchers: LabelMatcher[] = []
  const seenKeys = new Set<string>()
  for (const label of options.headings) {
    const matcher = labelMatcher(label)
    if (!matcher || seenKeys.has(matcher.key)) continue
    seenKeys.add(matcher.key)
    matchers.push(matcher)
  }

  // Which blocks are headings. A template line is a heading whatever its
  // length, as is a Heading-styled one; any other must be short or have a
  // separator after the label.
  const headingOf = blocks.map((block): HeadingMatch | null => {
    if (!block.text) return null
    const templateLine = isTemplateText(block.text, template)
    const styled = block.headingLevel !== null
    const match = matchHeading(block.text, matchers, styled || templateLine)
    if (!match) return null
    return styled || templateLine || block.text.length <= MAX_PLAIN_HEADING_CHARS || match.separated ? match : null
  })

  // Table rows of labels only, as column headers ("1a | 1j" over a row of
  // screenshots): two or more cells, each a single heading, no pictures.
  const rowCells = new Map<string, Map<number, number[]>>()
  for (const [i, block] of blocks.entries()) {
    if (!block.cell) continue
    const rowKey = `${block.cell.table}/${block.cell.row}`
    const cells = rowCells.get(rowKey) ?? new Map<number, number[]>()
    cells.set(block.cell.col, [...(cells.get(block.cell.col) ?? []), i])
    rowCells.set(rowKey, cells)
  }
  const labelRows = new Set<string>()
  for (const [rowKey, cells] of rowCells) {
    let labels = 0
    let ok = true
    for (const indexes of cells.values()) {
      if (indexes.some((i) => blocks[i].images.length > 0)) ok = false
      const texts = indexes.filter((i) => blocks[i].text !== "")
      if (texts.length === 0) continue
      if (texts.length === 1 && headingOf[texts[0]]) labels += 1
      else ok = false
    }
    if (ok && labels >= 2) labelRows.add(rowKey)
  }

  const rels = await pkg.rels(pkg.mainPart)
  const relById = new Map<string, Relationship>(rels.map((r) => [r.id, r]))
  const decoded = new Map<string, Promise<DecodedImage>>()
  let decodedCount = 0
  const warnings: string[] = []

  const sections = new Map<string, { label: string; heading: string; level: number | null; bucket: Bucket }>()
  const unplaced = emptyBucket()
  let current: { level: number | null; bucket: Bucket; label: string | null } = { level: null, bucket: unplaced, label: null }
  const duplicateHeadings = new Set<string>()
  // Per table, the latest label row and the section key of each of its columns.
  const columnLabels = new Map<number, { row: number; cols: Map<number, string> }>()

  const place = async (refs: ImageRef[], bucket: Bucket, where: string) => {
    for (const ref of refs) {
      const rel = relById.get(ref.relId)
      if (ref.kind === "linked" || rel?.external) {
        const name = rel ? baseName(rel.target) : ref.relId
        bucket.notShown.push({ name, reason: "a linked picture, not stored in the file" })
        warnings.push(`Picture ${name} ${where} is linked, not stored in the file, so it is not shown.`)
        continue
      }
      const part = rel?.part ?? null
      const media = part ? await pkg.readMedia(part) : null
      const name = part ? baseName(part) : ref.relId
      if (!part || !media) {
        bucket.notShown.push({ name, reason: "missing from the file" })
        warnings.push(`Picture ${name} ${where} is missing from the file.`)
        continue
      }
      if (!media.data) {
        bucket.notShown.push({ name, reason: "too large to read" })
        warnings.push(`Picture ${name} ${where} is too large to read, so it is not shown.`)
        continue
      }
      let pending = decoded.get(part)
      if (!pending) {
        if (decodedCount >= MAX_EVIDENCE_IMAGES) {
          bucket.notShown.push({ name, reason: `past the limit of ${MAX_EVIDENCE_IMAGES} pictures` })
          warnings.push(`Picture ${name} ${where} is past the limit of ${MAX_EVIDENCE_IMAGES} pictures, so it is not shown.`)
          continue
        }
        decodedCount += 1
        pending = normaliseImage(name, media.data)
        decoded.set(part, pending)
      }
      const result = await pending
      if ("image" in result) {
        bucket.images.push(result.image)
      } else {
        bucket.notShown.push({ name, reason: result.notShown })
        warnings.push(`Picture ${name} ${where} is ${result.notShown}.`)
      }
    }
  }

  const where = () => (current.label ? `under ${current.label}` : "outside any task heading")

  for (const [i, block] of blocks.entries()) {
    const match = headingOf[i]
    const cell = block.cell
    const inLabelRow = cell !== null && labelRows.has(`${cell.table}/${cell.row}`)
    if (match && inLabelRow && cell) {
      let map = columnLabels.get(cell.table)
      if (!map || map.row !== cell.row) {
        map = { row: cell.row, cols: new Map() }
        columnLabels.set(cell.table, map)
      }
      map.cols.set(cell.col, match.matcher.key)
    }

    if (match && !sections.has(match.matcher.key)) {
      // A picture in the line before the label (pasted at the start of the
      // next heading's line) belongs to the section before. A floating
      // picture anchored here, or one after the label, belongs to this one.
      const firstChar = block.runText.search(/\S/)
      const leading = block.numbered || firstChar < 0 ? [] : block.images.filter((im) => !im.floating && im.offset <= firstChar)
      if (leading.length) await place(leading, current.bucket, where())

      const bucket = emptyBucket()
      sections.set(match.matcher.key, { label: match.matcher.label, heading: block.text, level: block.headingLevel, bucket })
      current = { level: block.headingLevel, bucket, label: match.matcher.label }
      // The heading line's own answer text, unless it is the template's.
      const ownLine = subtractTemplate(block.text, template)
      const rest = ownLine === "" ? "" : ownLine === block.text ? subtractTemplate(match.rest, template) : ownLine
      if (rest) bucket.texts.push(rest)
      await place(block.images.filter((im) => !leading.includes(im)), bucket, where())
      continue
    }
    // The template's own repeated headings (sub-parts such as "3e (i)",
    // "3e (ii)") are expected; a pupil's are worth a warning.
    if (match && !isTemplateText(block.text, template)) duplicateHeadings.add(match.matcher.label)

    const text = subtractTemplate(block.text, template)

    // Under a row of column labels, each cell goes to its column's label.
    const map = cell ? columnLabels.get(cell.table) : undefined
    const columnKey = cell && map && !inLabelRow && cell.row > map.row ? map.cols.get(cell.col) : undefined
    const columnSection = columnKey ? sections.get(columnKey) : undefined
    if (columnSection) {
      if (text) columnSection.bucket.texts.push(text)
      await place(block.images, columnSection.bucket, `under ${columnSection.label}`)
      continue
    }

    // A Heading-styled line that is no label: the template's own ends a
    // section at the same or a higher level, a pupil's only at a higher one.
    if (!match && block.headingLevel !== null && current.label !== null && current.level !== null) {
      const templateLine = isTemplateText(block.text, template)
      if (templateLine ? block.headingLevel <= current.level : block.headingLevel < current.level) {
        current = { level: null, bucket: unplaced, label: null }
      } else if (!templateLine && text) {
        warnings.push(`The heading "${text}" under ${current.label} is not a task heading; what follows it is kept under ${current.label}.`)
      }
    }

    if (text) current.bucket.texts.push(text)
    await place(block.images, current.bucket, where())
  }

  for (const label of duplicateHeadings) {
    warnings.push(`The heading ${label} appears more than once; only the first is used.`)
  }
  if (unplaced.texts.length || unplaced.images.length || unplaced.notShown.length) {
    const parts = [
      unplaced.texts.length ? `${unplaced.texts.length} paragraph${unplaced.texts.length === 1 ? "" : "s"}` : null,
      unplaced.images.length ? `${unplaced.images.length} picture${unplaced.images.length === 1 ? "" : "s"}` : null,
    ].filter(Boolean)
    if (parts.length) warnings.push(`${parts.join(" and ")} are not under any task heading.`)
  }

  const found: EvidenceSection[] = []
  const missingHeadings: string[] = []
  for (const matcher of matchers) {
    const section = sections.get(matcher.key)
    if (!section) {
      missingHeadings.push(matcher.label)
      continue
    }
    found.push({
      label: section.label,
      heading: section.heading,
      text: section.bucket.texts.join("\n"),
      images: section.bucket.images,
      notShown: section.bucket.notShown,
    })
  }

  return {
    sections: found,
    unplaced: { text: unplaced.texts.join("\n"), images: unplaced.images, notShown: unplaced.notShown },
    missingHeadings,
    warnings,
  }
}

/**
 * The headings a blank evidence template does not have, read as a pupil's
 * copy of it would be: a label listed here can never be found in a pupil's
 * file built from the template, so the teacher should be warned at setup.
 */
export async function checkEvidenceTemplate(templateBuffer: Buffer, headings: readonly string[]): Promise<string[]> {
  const templateParagraphs = await readDocxParagraphs(templateBuffer)
  const read = await readEvidenceDocument(templateBuffer, { headings, templateParagraphs })
  return read.missingHeadings
}

/**
 * The non-empty paragraphs of a .docx in document order (table cells and text
 * boxes included, list numbers shown), spacing normalised: a blank template's
 * paragraphs for readEvidenceDocument, or a reference document's text.
 */
export async function readDocxParagraphs(buffer: Buffer): Promise<string[]> {
  const pkg = await openDocxPackage(buffer)
  return (await readBlocks(pkg)).map((block) => block.text).filter((text) => text !== "")
}

/** The plain text of a .docx, one paragraph per line. */
export async function readDocxText(buffer: Buffer): Promise<string> {
  return (await readDocxParagraphs(buffer)).join("\n")
}
