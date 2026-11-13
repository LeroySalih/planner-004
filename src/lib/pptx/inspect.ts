// Reads the facts a marker needs from a PowerPoint .pptx: slide size, the
// slide master and layouts, each slide's text, pictures, footers, overlaps,
// transition, animations, links and notes, the notes and handout masters,
// and every media file. Pure: no database, no network, and nothing in the
// file is run (macros are only reported).

import { readAnimations } from "./animations"
import { colourElement, describeColour, readColourMap, readTheme, resolveColour, type ColourMap, type Theme } from "./colour"
import { PptxInspectError } from "./errors"
import { readImageSize } from "./image-size"
import { matchImage, type ImageMatch, type KnownImage } from "./known-images"
import { openPackage, type PptxPackage, type Relationship } from "./package"
import { transitionName } from "./effect-names"
import { alignName, paragraphAlign, paragraphText, readParagraphs, runStyle, summariseText, textRuns, type StyleSources } from "./text"
import type {
  ActionButton,
  BackgroundInfo,
  Box,
  CropPercent,
  Field,
  FooterItem,
  HeaderFooterFlags,
  ImageUse,
  LayoutInfo,
  Link,
  MasterInfo,
  MediaInfo,
  NotesMasterInfo,
  OffSlide,
  Overlap,
  PictureFill,
  PictureInfo,
  PlaceholderInfo,
  PlaceholderRef,
  PresentationReport,
  ShapeInfo,
  SlideInfo,
  TextRunStyle,
  TextSummary,
  TitleStyle,
  TransitionInfo,
} from "./types"
import { attr, boolAttr, child, descendants, kids, numAttr, path, relAttr, resolveAlternateContent, type XmlElement } from "./xml"

export { PptxInspectError } from "./errors"
export type { KnownImage } from "./known-images"
export type { PresentationReport } from "./types"

export type InspectOptions = {
  // The images the pupil was given (an assessment's IMAGES folder). Each
  // picture is then named after the one it is, exactly or by likeness.
  knownImages?: KnownImage[]
}

const EMU_PER_CM = 360000

function cm(emu: number) {
  return Math.round((emu / EMU_PER_CM) * 100) / 100
}

type Rect = { x: number; y: number; cx: number; cy: number }
type PartialRect = { x?: number; y?: number; cx?: number; cy?: number }

type Ph = { type: string; idx: number | null }

type PartShape = {
  el: XmlElement
  kind: ShapeInfo["kind"]
  id: string
  name: string
  descr: string | null
  hidden: boolean
  ph: Ph | null
  xfrm: PartialRect
  geometry: string | null
  txBody: XmlElement | null
  inGroup: string | null
  cNvPr: XmlElement | null
}

type PartKind = "master" | "layout" | "slide" | "notes master" | "handout master" | "notes"

type PartData = {
  kind: PartKind
  part: string
  root: XmlElement
  shapes: PartShape[]
  rels: Relationship[]
  parent: PartData | null
  // Master text styles and the colour map, shared down the chain.
  master: PartData | null
}

const FOOTER_TYPES: Record<string, FooterItem["kind"]> = {
  dt: "date",
  ftr: "footer",
  sldNum: "slide number",
  hdr: "header",
}

// ---------------------------------------------------------------- shapes

function readXfrm(xfrm: XmlElement | null): PartialRect {
  const out: PartialRect = {}
  const off = child(xfrm, "off")
  const ext = child(xfrm, "ext")
  const x = numAttr(off, "x")
  const y = numAttr(off, "y")
  const cx = numAttr(ext, "cx")
  const cy = numAttr(ext, "cy")
  if (x !== null && y !== null) {
    out.x = x
    out.y = y
  }
  if (cx !== null && cy !== null) {
    out.cx = cx
    out.cy = cy
  }
  return out
}

type Transform = (r: PartialRect) => PartialRect

const IDENTITY: Transform = (r) => r

function groupTransform(grpSpPr: XmlElement | null, outer: Transform): Transform {
  const xfrm = child(grpSpPr, "xfrm")
  const off = readXfrm(xfrm)
  const chOff = child(xfrm, "chOff")
  const chExt = child(xfrm, "chExt")
  const chX = numAttr(chOff, "x") ?? 0
  const chY = numAttr(chOff, "y") ?? 0
  const chCx = numAttr(chExt, "cx") ?? 0
  const chCy = numAttr(chExt, "cy") ?? 0
  const sx = chCx > 0 && off.cx !== undefined ? off.cx / chCx : 1
  const sy = chCy > 0 && off.cy !== undefined ? off.cy / chCy : 1
  return (r) => {
    const mapped: PartialRect = {}
    if (r.x !== undefined && r.y !== undefined) {
      mapped.x = (off.x ?? 0) + (r.x - chX) * sx
      mapped.y = (off.y ?? 0) + (r.y - chY) * sy
    }
    if (r.cx !== undefined && r.cy !== undefined) {
      mapped.cx = r.cx * sx
      mapped.cy = r.cy * sy
    }
    return outer(mapped)
  }
}

function readPh(nvPr: XmlElement | null): Ph | null {
  const ph = child(nvPr, "ph")
  if (!ph) return null
  return { type: attr(ph, "type") ?? "obj", idx: numAttr(ph, "idx") }
}

function collectShapes(spTree: XmlElement | null): PartShape[] {
  const out: PartShape[] = []
  const walk = (children: XmlElement[], transform: Transform, group: string | null) => {
    for (const el of resolveAlternateContent(children)) {
      if (el.name === "grpSp") {
        const cNvPr = path(el, "nvGrpSpPr", "cNvPr")
        walk(el.children, groupTransform(child(el, "grpSpPr"), transform), attr(cNvPr, "name") ?? "group")
        continue
      }
      let nv: XmlElement | null = null
      let spPr: XmlElement | null = null
      let kind: ShapeInfo["kind"]
      if (el.name === "sp") {
        nv = child(el, "nvSpPr")
        spPr = child(el, "spPr")
        kind = boolAttr(child(nv, "cNvSpPr"), "txBox") ? "text box" : "shape"
      } else if (el.name === "pic") {
        nv = child(el, "nvPicPr")
        spPr = child(el, "spPr")
        const nvPr = child(nv, "nvPr")
        kind = child(nvPr, "videoFile") || child(nvPr, "audioFile") ? "media" : "picture"
      } else if (el.name === "graphicFrame") {
        nv = child(el, "nvGraphicFramePr")
        const uri = attr(path(el, "graphic", "graphicData"), "uri") ?? ""
        kind = uri.includes("table") ? "table" : uri.includes("chart") ? "chart" : uri.includes("diagram") ? "diagram" : uri.includes("ole") ? "ole object" : "graphic frame"
      } else if (el.name === "cxnSp") {
        nv = child(el, "nvCxnSpPr")
        spPr = child(el, "spPr")
        kind = "connector"
      } else {
        continue
      }
      const cNvPr = child(nv, "cNvPr")
      const xfrmEl = el.name === "graphicFrame" ? child(el, "xfrm") : child(spPr, "xfrm")
      out.push({
        el,
        kind,
        id: attr(cNvPr, "id") ?? "",
        name: attr(cNvPr, "name") ?? "",
        descr: attr(cNvPr, "descr"),
        hidden: boolAttr(cNvPr, "hidden") === true,
        ph: readPh(child(nv, "nvPr")),
        xfrm: transform(readXfrm(xfrmEl)),
        geometry: attr(child(spPr, "prstGeom"), "prst") ?? (child(spPr, "custGeom") ? "custom" : null),
        txBody: child(el, "txBody"),
        inGroup: group,
        cNvPr,
      })
    }
  }
  walk(kids(spTree), IDENTITY, null)
  return out
}

function normalType(type: string) {
  if (type === "title" || type === "ctrTitle") return "title"
  if (["dt", "ftr", "sldNum", "hdr", "sldImg"].includes(type)) return type
  return "body"
}

// The placeholder a shape inherits from in the part above it. A slide finds
// its layout placeholder by idx first, then type; a layout finds the master's
// by type only, as PowerPoint does.
function inheritedPlaceholder(shape: PartShape, data: PartData): { shape: PartShape; data: PartData } | null {
  const parent = data.parent
  if (!shape.ph || !parent) return null
  const candidates = parent.shapes.filter((s) => s.ph)
  let match: PartShape | undefined
  if (data.kind === "slide" || data.kind === "notes") {
    if (shape.ph.idx !== null && shape.ph.idx !== 0) match = candidates.find((s) => s.ph!.idx === shape.ph!.idx)
    if (!match) match = candidates.find((s) => s.ph!.type === shape.ph!.type)
  }
  if (!match) match = candidates.find((s) => normalType(s.ph!.type) === normalType(shape.ph!.type))
  return match ? { shape: match, data: parent } : null
}

function resolveRect(shape: PartShape, data: PartData): { rect: Rect | null; inherited: boolean } {
  const merged: PartialRect = { ...shape.xfrm }
  let inherited = false
  let current: { shape: PartShape; data: PartData } | null = { shape, data }
  while ((merged.x === undefined || merged.cx === undefined) && current) {
    current = inheritedPlaceholder(current.shape, current.data)
    if (!current) break
    const up = current.shape.xfrm
    if (merged.x === undefined && up.x !== undefined) {
      merged.x = up.x
      merged.y = up.y
      inherited = true
    }
    if (merged.cx === undefined && up.cx !== undefined) {
      merged.cx = up.cx
      merged.cy = up.cy
      inherited = true
    }
  }
  if (merged.x === undefined || merged.cx === undefined) return { rect: null, inherited }
  return { rect: { x: merged.x, y: merged.y!, cx: merged.cx, cy: merged.cy! }, inherited }
}

function toBox(rect: Rect | null): Box | null {
  if (!rect) return null
  return { xCm: cm(rect.x), yCm: cm(rect.y), widthCm: cm(rect.cx), heightCm: cm(rect.cy) }
}

function masterOf(data: PartData) {
  return data.master ?? (data.kind === "master" ? data : null)
}

function colourMapFor(data: PartData): ColourMap {
  // Slides and layouts use the master's map unless they override it.
  let current: PartData | null = data
  while (current) {
    const override = path(current.root, "clrMapOvr", "overrideClrMapping")
    if (override) return readColourMap(override)
    if (current.kind === "master" || current.kind === "notes master" || current.kind === "handout master") {
      return readColourMap(child(current.root, "clrMap"))
    }
    current = current.parent
  }
  return {}
}

function textStylesFor(shape: PartShape, data: PartData, presentation: XmlElement): (XmlElement | null)[] {
  const master = masterOf(data)
  const txStyles = child(master?.root, "txStyles")
  const defaults = child(presentation, "defaultTextStyle")
  if (master?.kind === "notes master" || master?.kind === "handout master") {
    return [child(master.root, "notesStyle"), defaults]
  }
  if (shape.ph) {
    const t = normalType(shape.ph.type)
    if (t === "title") return [child(txStyles, "titleStyle"), defaults]
    if (t === "body") return [child(txStyles, "bodyStyle"), defaults]
  }
  return [child(txStyles, "otherStyle"), defaults]
}

function styleSources(shape: PartShape, data: PartData, presentation: XmlElement, theme: Theme): StyleSources {
  const lists: (XmlElement | null)[] = [child(shape.txBody, "lstStyle")]
  let current: { shape: PartShape; data: PartData } | null = { shape, data }
  while (current) {
    current = inheritedPlaceholder(current.shape, current.data)
    if (current) lists.push(child(current.shape.txBody, "lstStyle"))
  }
  lists.push(...textStylesFor(shape, data, presentation))
  const fontRef = shape.ph ? null : colourElement(path(shape.el, "style", "fontRef"))
  return { lists, fontRefColour: fontRef, theme, colourMap: colourMapFor(data) }
}

// ---------------------------------------------------------------- report pieces

function readFields(txBody: XmlElement | null): Field[] {
  const out: Field[] = []
  for (const p of kids(txBody, "p")) {
    for (const fld of kids(p, "fld")) {
      const type = attr(fld, "type") ?? ""
      out.push({ type, text: child(fld, "t")?.text ?? "", updatesAutomatically: type.startsWith("datetime") })
    }
  }
  return out
}

function bodyText(txBody: XmlElement | null) {
  return kids(txBody, "p").map(paragraphText).join("\n").trim()
}

function readHeaderFooter(el: XmlElement | null): HeaderFooterFlags | null {
  if (!el) return null
  const flag = (name: string) => boolAttr(el, name) ?? true
  return { slideNumber: flag("sldNum"), header: flag("hdr"), footer: flag("ftr"), date: flag("dt") }
}

function corner(rect: Rect | null, size: { cx: number; cy: number }) {
  if (!rect) return null
  const cx = rect.x + rect.cx / 2
  const cy = rect.y + rect.cy / 2
  const h = cx < size.cx / 3 ? "left" : cx > (2 * size.cx) / 3 ? "right" : "centre"
  const v = cy < size.cy / 3 ? "top" : cy > (2 * size.cy) / 3 ? "bottom" : "middle"
  if (h === "centre" && v === "middle") return "centre"
  return `${v} ${h}`
}

const LINK_JUMPS: Record<string, string> = {
  firstslide: "First Slide",
  lastslide: "Last Slide",
  nextslide: "Next Slide",
  previousslide: "Previous Slide",
  endshow: "End Show",
  lastslideviewed: "Last Slide Viewed",
}

type Context = {
  pkg: PptxPackage
  presentation: XmlElement
  theme: Theme
  size: { cx: number; cy: number }
  slideNumbers: Map<string, number>
  slideTitles: Map<string, string | null>
  media: Map<string, MediaInfo>
  warnings: string[]
  known: KnownImage[] | null
  matches: Map<string, Promise<ImageMatch>>
}

function describeTargetSlide(n: { number: number; title: string | null }) {
  return `slide ${n.number}${n.title ? ` "${n.title}"` : ""}`
}

function readLink(
  el: XmlElement,
  event: Link["event"],
  on: Link["on"],
  shape: PartShape,
  text: string | null,
  data: PartData,
  ctx: Context,
): Link {
  const action = attr(el, "action")
  const rid = relAttr(el, "id")
  const rel = rid ? data.rels.find((r) => r.id === rid) ?? null : null
  const target = rel ? rel.target : null
  let kind: Link["kind"] = "other"
  let targetSlide: Link["targetSlide"] = null
  let jump: string | null = null
  let description = ""

  const slideFromRel = () => {
    if (rel?.part && ctx.slideNumbers.has(rel.part)) {
      targetSlide = { number: ctx.slideNumbers.get(rel.part)!, title: ctx.slideTitles.get(rel.part) ?? null }
    }
  }

  if (action?.startsWith("ppaction://hlinksldjump")) {
    kind = "slide"
    slideFromRel()
    description = targetSlide ? describeTargetSlide(targetSlide) : `a slide that is not in the presentation (${target ?? "no target"})`
  } else if (action?.startsWith("ppaction://hlinkshowjump")) {
    kind = "show jump"
    jump = /jump=([a-z]+)/i.exec(action)?.[1]?.toLowerCase() ?? null
    description = jump ? LINK_JUMPS[jump] ?? jump : action
  } else if (action?.startsWith("ppaction://noaction")) {
    kind = "no action"
    description = "no action"
  } else if (action?.startsWith("ppaction://hlinkpres")) {
    kind = "other presentation"
    description = `another presentation: ${target ?? ""}`
  } else if (action?.startsWith("ppaction://customshow")) {
    kind = "custom show"
    description = `custom show ${action}`
  } else if (action?.startsWith("ppaction://program")) {
    kind = "program"
    description = `run a program: ${target ?? ""}`
  } else if (action?.startsWith("ppaction://macro")) {
    kind = "macro"
    description = `run a macro: ${action.split("name=")[1] ?? ""}`
  } else if (action?.startsWith("ppaction://hlinkfile")) {
    kind = "file"
    description = fileDescription(target)
  } else if (rel && !rel.external && rel.type === "slide") {
    kind = "slide"
    slideFromRel()
    description = targetSlide ? describeTargetSlide(targetSlide) : `slide part ${rel.part}`
  } else if (target !== null) {
    if (/^https?:\/\//i.test(target) || /^www\./i.test(target)) {
      kind = "web"
      description = `web address ${target}`
    } else if (/^mailto:/i.test(target)) {
      kind = "email"
      description = `email ${target.replace(/^mailto:/i, "")}`
    } else if (/^file:/i.test(target) || /^[a-z]:[\\/]/i.test(target) || !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      kind = "file"
      description = fileDescription(target)
    } else {
      kind = "other"
      description = target
    }
  } else if (!action) {
    kind = "no action"
    description = "no action"
  } else {
    description = action
  }

  const file = (kind === "file" || kind === "other presentation") && target !== null ? fileTarget(target) : null
  return {
    event,
    on,
    shapeName: shape.name,
    shapeGeometry: shape.geometry,
    text,
    kind,
    action,
    target,
    targetSlide,
    jump,
    fileName: file?.name ?? null,
    absolutePath: file?.absolute ?? null,
    description,
  }
}

// A linked file's name, and whether the link holds a full path (C:\…,
// \\server\…, /Users/…, file:///…) rather than one relative to the
// presentation. The path itself is not repeated in the text report: it can
// carry the account name of whoever made the link.
function fileTarget(target: string) {
  const stripped = decodeURIComponentSafe(target.replace(/^file:\/*/i, ""))
  const absolute = /^file:/i.test(target) || /^[a-z]:[\\/]/i.test(stripped) || /^[\\/]/.test(stripped)
  const name = stripped.split(/[\\/]/).filter((s) => s !== "").pop() ?? stripped
  return { name, absolute }
}

function fileDescription(target: string | null) {
  if (!target) return "a file (no target)"
  const file = fileTarget(target)
  return `file "${file.name}" (${file.absolute ? "a full path on the computer the link was made on" : "a path relative to the presentation"})`
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function readLinks(shapes: PartShape[], data: PartData, ctx: Context): Link[] {
  const out: Link[] = []
  for (const shape of shapes) {
    for (const c of kids(shape.cNvPr)) {
      if (c.name === "hlinkClick") out.push(readLink(c, "click", "shape", shape, null, data, ctx))
      if (c.name === "hlinkHover") out.push(readLink(c, "mouse over", "shape", shape, null, data, ctx))
    }
    for (const p of kids(shape.txBody, "p")) {
      for (const r of kids(p)) {
        if (r.name !== "r" && r.name !== "fld") continue
        const rPr = child(r, "rPr")
        const text = child(r, "t")?.text ?? ""
        for (const c of kids(rPr)) {
          if (c.name === "hlinkClick") out.push(readLink(c, "click", "text", shape, text, data, ctx))
          if (c.name === "hlinkMouseOver") out.push(readLink(c, "mouse over", "text", shape, text, data, ctx))
        }
      }
    }
  }
  // A link that spans several runs is one link to the reader.
  const merged: Link[] = []
  for (const link of out) {
    const last = merged[merged.length - 1]
    if (
      last && link.on === "text" && last.on === "text" && last.shapeName === link.shapeName &&
      last.event === link.event && last.action === link.action && last.target === link.target
    ) {
      last.text = `${last.text ?? ""}${link.text ?? ""}`
    } else {
      merged.push({ ...link })
    }
  }
  return merged
}

// a:srcRect on a blipFill, in percent; null when there is none.
function readCrop(blipFill: XmlElement | null): CropPercent | null {
  const srcRect = child(blipFill, "srcRect")
  if (!srcRect || Object.keys(srcRect.attrs).length === 0) return null
  const pct = (name: string) => (numAttr(srcRect, name) ?? 0) / 1000
  return { left: pct("l"), top: pct("t"), right: pct("r"), bottom: pct("b") }
}

// Which supplied image a media part (as cropped) is; null when no supplied
// images were given.
function identify(part: string | null, crop: CropPercent | null, ctx: Context): Promise<ImageMatch> | null {
  const known = ctx.known
  if (!known) return null
  const key = `${part}|${JSON.stringify(crop)}`
  let match = ctx.matches.get(key)
  if (!match) {
    match = (async () => {
      const bytes = part ? await ctx.pkg.readMedia(part) : null
      return matchImage(bytes?.data ?? null, bytes?.sha256 ?? null, crop, known)
    })()
    ctx.matches.set(key, match)
  }
  return match
}

async function recordMedia(part: string, usedBy: string, ctx: Context): Promise<MediaInfo | null> {
  let info = ctx.media.get(part)
  if (!info) {
    const bytes = await ctx.pkg.readMedia(part)
    if (!bytes) return null
    const size = readImageSize(bytes.header)
    info = {
      part,
      bytes: bytes.bytes,
      sha256: bytes.sha256,
      format: size?.format ?? (part.split(".").pop()?.toLowerCase() ?? null),
      pixelWidth: size?.width ?? null,
      pixelHeight: size?.height ?? null,
      usedBy: [],
    }
    ctx.media.set(part, info)
  }
  if (usedBy && !info.usedBy.includes(usedBy)) info.usedBy.push(usedBy)
  return info
}

async function readBackground(data: PartData, label: string, ctx: Context): Promise<BackgroundInfo | null> {
  const bg = path(data.root, "cSld", "bg")
  if (!bg) return null
  const colourMap = colourMapFor(data)
  const bgPr = child(bg, "bgPr")
  const empty: BackgroundInfo = { kind: "none", colour: null, mediaPart: null, sha256: null, transparencyPercent: null, tiled: null, match: null }
  const colourOf = (el: XmlElement | null) => {
    const hex = resolveColour(el, ctx.theme, colourMap)
    return hex ? { hex, name: describeColour(hex) } : null
  }
  if (!bgPr) {
    const bgRef = child(bg, "bgRef")
    return { ...empty, kind: "theme style", colour: colourOf(colourElement(bgRef)) }
  }
  const solid = child(bgPr, "solidFill")
  if (solid) {
    return { ...empty, kind: "solid", colour: colourOf(colourElement(solid)) }
  }
  if (child(bgPr, "gradFill")) return { ...empty, kind: "gradient" }
  if (child(bgPr, "pattFill")) return { ...empty, kind: "pattern" }
  const blipFill = child(bgPr, "blipFill")
  if (blipFill) {
    const blip = child(blipFill, "blip")
    const rid = relAttr(blip, "embed")
    const rel = rid ? data.rels.find((r) => r.id === rid) : null
    const media = rel?.part ? await recordMedia(rel.part, `${label} background`, ctx) : null
    const alpha = numAttr(child(blip, "alphaModFix"), "amt")
    return {
      kind: "picture",
      colour: null,
      mediaPart: rel?.part ?? null,
      sha256: media?.sha256 ?? null,
      transparencyPercent: alpha === null ? 0 : Math.round((100 - alpha / 1000) * 100) / 100,
      tiled: child(blipFill, "tile") !== null,
      match: await identify(rel?.part ?? null, readCrop(blipFill), ctx),
    }
  }
  return empty
}

// Picture Format > Transparency is the blip's alphaModFix (amt in 1/1000 %).
function pictureTransparency(el: XmlElement) {
  const alpha = numAttr(child(path(el, "blipFill", "blip"), "alphaModFix"), "amt")
  return alpha === null ? 0 : Math.round((100 - alpha / 1000) * 100) / 100
}

// The share of the slide's area a box covers, 0–100 to 1 dp.
function coverage(rect: Rect, size: { cx: number; cy: number }) {
  const w = Math.min(rect.x + rect.cx, size.cx) - Math.max(rect.x, 0)
  const h = Math.min(rect.y + rect.cy, size.cy) - Math.max(rect.y, 0)
  if (w <= 0 || h <= 0) return 0
  return Math.round(((w * h) / (size.cx * size.cy)) * 1000) / 10
}

// A picture covering this much of the slide is standing in for a background.
const FULL_SLIDE_PERCENT = 90

async function readPicture(shape: PartShape, data: PartData, label: string, ctx: Context): Promise<PictureInfo> {
  const blipFill = child(shape.el, "blipFill")
  const blip = child(blipFill, "blip")
  const embed = relAttr(blip, "embed")
  const link = relAttr(blip, "link")
  const rel = embed ? data.rels.find((r) => r.id === embed) : null
  const linkRel = link ? data.rels.find((r) => r.id === link) : null
  const media = rel?.part ? await recordMedia(rel.part, `${label} picture "${shape.name}"`, ctx) : null
  const { rect, inherited } = resolveRect(shape, data)
  const crop = readCrop(blipFill)
  const displayedAspect = rect && rect.cy > 0 ? rect.cx / rect.cy : null
  let imageAspect: number | null = null
  if (media?.pixelWidth && media.pixelHeight) {
    const w = media.pixelWidth * (1 - ((crop?.left ?? 0) + (crop?.right ?? 0)) / 100)
    const h = media.pixelHeight * (1 - ((crop?.top ?? 0) + (crop?.bottom ?? 0)) / 100)
    imageAspect = h > 0 ? w / h : null
  }
  const tiled = child(blipFill, "tile") !== null
  let distortion: number | null = null
  if (displayedAspect !== null && imageAspect !== null && !tiled) {
    distortion = Math.round(Math.abs(displayedAspect / imageAspect - 1) * 10000) / 100
  }
  const inheritedPh = inheritedPlaceholder(shape, data)
  return {
    transparencyPercent: pictureTransparency(shape.el),
    slideCoveragePercent: rect ? coverage(rect, ctx.size) : null,
    name: shape.name,
    descr: shape.descr,
    hidden: shape.hidden,
    mediaPart: rel?.part ?? null,
    linkedTarget: linkRel?.target ?? null,
    sha256: media?.sha256 ?? null,
    pixelWidth: media?.pixelWidth ?? null,
    pixelHeight: media?.pixelHeight ?? null,
    box: toBox(rect),
    boxInherited: inherited,
    placeholder: shape.ph ? { type: shape.ph.type, idx: shape.ph.idx } : null,
    placeholderName: inheritedPh?.shape.name ?? null,
    cropPercent: crop,
    displayedAspect: displayedAspect === null ? null : Math.round(displayedAspect * 1000) / 1000,
    imageAspect: imageAspect === null ? null : Math.round(imageAspect * 1000) / 1000,
    stretched: distortion === null ? null : distortion > 2,
    distortionPercent: distortion,
    corner: corner(rect, ctx.size),
    match: rel?.part || linkRel ? await identify(rel?.part ?? null, crop, ctx) : null,
  }
}

// A shape filled with a picture rather than a colour.
async function readPictureFill(shape: PartShape, data: PartData, label: string, ctx: Context): Promise<PictureFill | null> {
  const blipFill = child(child(shape.el, "spPr"), "blipFill")
  if (!blipFill) return null
  const rid = relAttr(child(blipFill, "blip"), "embed")
  const part = rid ? data.rels.find((r) => r.id === rid)?.part ?? null : null
  const media = part ? await recordMedia(part, `${label} picture fill in "${shape.name}"`, ctx) : null
  const crop = readCrop(blipFill)
  return { mediaPart: part, sha256: media?.sha256 ?? null, cropPercent: crop, match: await identify(part, crop, ctx) }
}

function tableRows(shape: PartShape): string[][] | null {
  const tbl = path(shape.el, "graphic", "graphicData", "tbl")
  if (!tbl) return null
  return kids(tbl, "tr").map((tr) =>
    kids(tr, "tc")
      .filter((tc) => !boolAttr(tc, "hMerge") && !boolAttr(tc, "vMerge"))
      .map((tc) => kids(child(tc, "txBody"), "p").map(paragraphText).join(" / ").trim()),
  )
}

// Text sizes as shown: PowerPoint's shrink-on-overflow scales every run.
function textSummary(shape: PartShape, sources: StyleSources): TextSummary | null {
  const runs = textRuns(shape.txBody).filter((r) => r.text.trim() !== "")
  if (runs.length === 0) return null
  const fontScale = numAttr(child(child(shape.txBody, "bodyPr"), "normAutofit"), "fontScale")
  return summariseText(runs.map((r) => runStyle(r.rPr, r.pPr, r.level, sources)), fontScale === null ? null : fontScale / 1000)
}

function shapeInfo(shape: PartShape, data: PartData, ctx: Context): ShapeInfo {
  const { rect, inherited } = resolveRect(shape, data)
  const sources = styleSources(shape, data, ctx.presentation, ctx.theme)
  return {
    id: shape.id,
    name: shape.name,
    kind: shape.kind,
    descr: shape.descr,
    hidden: shape.hidden,
    placeholder: shape.ph ? ({ type: shape.ph.type, idx: shape.ph.idx } satisfies PlaceholderRef) : null,
    geometry: shape.geometry,
    box: toBox(rect),
    boxInherited: inherited,
    paragraphs: readParagraphs(shape.txBody, sources),
    textSummary: textSummary(shape, sources),
    tableRows: shape.kind === "table" ? tableRows(shape) : null,
    inGroup: shape.inGroup,
    pictureFill: null,
  }
}

// SmartArt keeps its text in a separate data part, one paragraph per point.
async function diagramParagraphs(shape: PartShape, data: PartData, ctx: Context) {
  const relIds = path(shape.el, "graphic", "graphicData", "relIds")
  const rid = relAttr(relIds, "dm")
  const part = rid ? data.rels.find((r) => r.id === rid)?.part : null
  const root = part ? await ctx.pkg.readXml(part) : null
  if (!root) return []
  const texts: string[] = []
  for (const pt of descendants(child(root, "ptLst"), "pt")) {
    const text = kids(child(pt, "t"), "p").map(paragraphText).join(" / ").trim()
    if (text) texts.push(text)
  }
  return texts.map((text, index) => ({ index, level: 1, text, bulleted: false, bulletChar: null, align: null }))
}

function footerItems(data: PartData, ctx: Context): FooterItem[] {
  const out: FooterItem[] = []
  for (const shape of data.shapes) {
    if (!shape.ph || !FOOTER_TYPES[shape.ph.type]) continue
    const kind = FOOTER_TYPES[shape.ph.type]
    const sources = styleSources(shape, data, ctx.presentation, ctx.theme)
    const firstP = kids(shape.txBody, "p")[0] ?? null
    const fields = readFields(shape.txBody)
    const text = bodyText(shape.txBody)
    out.push({
      kind,
      name: shape.name,
      box: toBox(resolveRect(shape, data).rect),
      align: alignName(paragraphAlign(child(firstP, "pPr"), 0, sources) ?? "l"),
      text,
      fields,
      typedDate: kind === "date" && text !== "" && !fields.some((f) => f.type.startsWith("datetime")),
      typedNumber: kind === "slide number" && text !== "" && !fields.some((f) => f.type === "slidenum"),
    })
  }
  return out
}

function placeholderInfos(data: PartData, ctx: Context): PlaceholderInfo[] {
  return data.shapes
    .filter((s) => s.ph)
    .map((shape) => {
      const sources = styleSources(shape, data, ctx.presentation, ctx.theme)
      const firstP = kids(shape.txBody, "p")[0] ?? null
      return {
        type: shape.ph!.type,
        idx: shape.ph!.idx,
        name: shape.name,
        box: toBox(resolveRect(shape, data).rect),
        align: alignName(paragraphAlign(child(firstP, "pPr"), 0, sources) ?? "l"),
        text: bodyText(shape.txBody),
        fields: readFields(shape.txBody),
      }
    })
}

function sameStyle(a: TextRunStyle, b: TextRunStyle) {
  return a.bold === b.bold && a.italic === b.italic && a.colour?.hex === b.colour?.hex && a.sizePt === b.sizePt && a.font === b.font
}

function titleStyle(shape: PartShape, data: PartData, ctx: Context): TitleStyle | null {
  const sources = styleSources(shape, data, ctx.presentation, ctx.theme)
  const runs = textRuns(shape.txBody).filter((r) => r.text.trim() !== "")
  if (runs.length === 0) return null
  const styles = runs.map((r) => runStyle(r.rPr, r.pPr, r.level, sources))
  const overrides = new Set<string>()
  const slideLevel = [child(shape.txBody, "lstStyle"), ...runs.flatMap((r) => [r.rPr, child(r.pPr, "defRPr")])]
  for (const el of slideLevel) {
    const props = el?.name === "lstStyle" ? kids(el).map((lvl) => child(lvl, "defRPr")) : [el]
    for (const p of props) {
      if (!p) continue
      if (attr(p, "b") !== null) overrides.add("bold")
      if (attr(p, "i") !== null) overrides.add("italic")
      if (attr(p, "u") !== null) overrides.add("underline")
      if (attr(p, "sz") !== null) overrides.add("size")
      if (child(p, "solidFill")) overrides.add("colour")
      if (child(p, "latin")) overrides.add("font")
    }
  }
  if (styles.some((s) => !sameStyle(s, styles[0]))) overrides.add("runs formatted differently")
  return { ...styles[0], overridesOnSlide: [...overrides] }
}

function visibleOnSlide(shape: PartShape) {
  if (shape.hidden) return false
  if (shape.kind === "picture" || shape.kind === "media" || shape.kind === "table" || shape.kind === "chart" || shape.kind === "diagram" || shape.kind === "ole object" || shape.kind === "graphic frame") return true
  // An empty placeholder shows only its prompt text while editing.
  if (shape.ph) return bodyText(shape.txBody) !== "" || readFields(shape.txBody).length > 0
  return true
}

type Drawn = { name: string; rect: Rect; footer: boolean; fullSlide: boolean }

// Items are in drawing order: later ones are in front.
function overlaps(items: Drawn[]): Overlap[] {
  const out: Overlap[] = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      const w = Math.min(a.rect.x + a.rect.cx, b.rect.x + b.rect.cx) - Math.max(a.rect.x, b.rect.x)
      const h = Math.min(a.rect.y + a.rect.cy, b.rect.y + b.rect.cy) - Math.max(a.rect.y, b.rect.y)
      if (w <= 0 || h <= 0) continue
      const smaller = Math.min(a.rect.cx * a.rect.cy, b.rect.cx * b.rect.cy)
      out.push({
        a: a.name,
        b: b.name,
        overlapPercentOfSmaller: Math.round(((w * h) / smaller) * 1000) / 10,
        inFront: b.name,
        footerPlaceholders: a.footer && b.footer,
        fullSlidePicture: b.fullSlide ? b.name : a.fullSlide ? a.name : null,
      })
    }
  }
  return out
}

function offSlide(name: string, rect: Rect, size: { cx: number; cy: number }): OffSlide | null {
  const tolerance = 3600 // 0.01 cm
  const edges: string[] = []
  if (rect.x < -tolerance) edges.push(`left by ${cm(-rect.x)} cm`)
  if (rect.y < -tolerance) edges.push(`top by ${cm(-rect.y)} cm`)
  if (rect.x + rect.cx > size.cx + tolerance) edges.push(`right by ${cm(rect.x + rect.cx - size.cx)} cm`)
  if (rect.y + rect.cy > size.cy + tolerance) edges.push(`bottom by ${cm(rect.y + rect.cy - size.cy)} cm`)
  return edges.length ? { name, edges } : null
}

function readTransition(root: XmlElement): TransitionInfo | null {
  const transition = resolveAlternateContent(root.children).find((c) => c.name === "transition")
  if (!transition) return null
  const effectEl = transition.children.find((c) => c.name !== "sndAc" && c.name !== "extLst") ?? null
  const speed = attr(transition, "spd") ?? (effectEl ? "fast" : null)
  const p14dur = relAttr(transition, "dur") ?? attr(transition, "dur")
  const durationMs = p14dur !== null && Number.isFinite(Number(p14dur))
    ? Number(p14dur)
    : effectEl ? ({ fast: 500, med: 750, slow: 1000 } as Record<string, number>)[speed ?? "fast"] ?? null : null
  const advTm = numAttr(transition, "advTm")
  return {
    effect: effectEl ? transitionName(effectEl.name, effectEl.attrs) : null,
    element: effectEl?.name ?? null,
    options: effectEl ? { ...effectEl.attrs } : {},
    speed: attr(transition, "spd"),
    durationSeconds: durationMs === null ? null : Math.round(durationMs / 10) / 100,
    advanceOnClick: boolAttr(transition, "advClick") ?? true,
    advanceAfterSeconds: advTm === null ? null : Math.round(advTm / 10) / 100,
  }
}

// ---------------------------------------------------------------- parts

async function loadPart(
  ctx: Context,
  kind: PartKind,
  part: string,
  parent: PartData | null,
  master: PartData | null,
): Promise<PartData | null> {
  const root = await ctx.pkg.readXml(part)
  if (!root) {
    ctx.warnings.push(`${part} is listed but missing from the file.`)
    return null
  }
  return {
    kind,
    part,
    root,
    shapes: collectShapes(path(root, "cSld", "spTree")),
    rels: await ctx.pkg.rels(part),
    parent,
    master,
  }
}

function placeholderShows(data: PartData, type: string) {
  return data.shapes.some((s) => s.ph?.type === type)
}

async function graphicsOf(data: PartData, label: string, ctx: Context) {
  const pictures: PictureInfo[] = []
  const shapes: ShapeInfo[] = []
  for (const shape of data.shapes) {
    // A picture in a placeholder on a master or layout is still a picture
    // on every slide that uses it.
    if (shape.kind === "picture") pictures.push(await readPicture(shape, data, label, ctx))
    else if (!shape.ph) {
      const info = shapeInfo(shape, data, ctx)
      info.pictureFill = await readPictureFill(shape, data, label, ctx)
      shapes.push(info)
    }
  }
  return { pictures, shapes }
}

function notesLikeMaster(ctx: Context, data: PartData | null): NotesMasterInfo | null {
  if (!data) return null
  return {
    kind: data.kind === "handout master" ? "handout master" : "notes master",
    part: data.part,
    placeholders: footerItems(data, ctx),
    headerFooter: readHeaderFooter(child(data.root, "hf")),
  }
}

function ratioInfo(cx: number, cy: number) {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(cx, cy) || 1
  const rw = cx / g
  const rh = cy / g
  const ratio = rw <= 100 && rh <= 100 ? `${rw}:${rh}` : `${(cx / cy).toFixed(2)}:1`
  const value = cx / cy
  const named: [string, number][] = [
    ["4:3", 4 / 3],
    ["16:9", 16 / 9],
    ["16:10", 16 / 10],
    ["3:2", 3 / 2],
    ["A4 paper", 297 / 210],
    ["Letter paper", 11 / 8.5],
  ]
  const portrait = value < 1
  const compare = portrait ? 1 / value : value
  let best = named[0]
  for (const n of named) if (Math.abs(n[1] - compare) < Math.abs(best[1] - compare)) best = n
  const exact = Math.abs(best[1] - compare) / best[1] < 0.005
  return { ratio, nearestNamedRatio: portrait ? `${best[0]} (portrait)` : best[0], exactNamedRatio: exact }
}

// ---------------------------------------------------------------- entry point

export async function inspectPptx(buffer: Buffer, options: InspectOptions = {}): Promise<PresentationReport> {
  const pkg = await openPackage(buffer)
  const presentation = await pkg.readXml("ppt/presentation.xml")
  if (!presentation || presentation.name !== "presentation") {
    throw new PptxInspectError("This is not a PowerPoint .pptx file.", "ppt/presentation.xml is not a presentation")
  }
  const presRels = await pkg.rels("ppt/presentation.xml")
  const relPart = (rid: string | null) => (rid ? presRels.find((r) => r.id === rid)?.part ?? null : null)

  const sldSz = child(presentation, "sldSz")
  const size = { cx: numAttr(sldSz, "cx") ?? 9144000, cy: numAttr(sldSz, "cy") ?? 6858000 }
  const warnings: string[] = []
  if (!sldSz) warnings.push("The presentation does not record a slide size; PowerPoint's 4:3 default is assumed.")

  const themePart = presRels.find((r) => r.type === "theme")?.part ?? null
  const ctx: Context = {
    pkg,
    presentation,
    theme: readTheme(themePart ? await pkg.readXml(themePart) : null),
    size,
    slideNumbers: new Map(),
    slideTitles: new Map(),
    media: new Map(),
    warnings,
    known: options.knownImages ?? null,
    matches: new Map(),
  }

  // Slide order comes from sldIdLst, not from part names.
  const slideParts = kids(child(presentation, "sldIdLst"), "sldId")
    .map((s) => relPart(relAttr(s, "id")))
    .filter((p): p is string => p !== null)
  slideParts.forEach((part, i) => ctx.slideNumbers.set(part, i + 1))

  // Masters and their layouts.
  const masters: MasterInfo[] = []
  const layouts: LayoutInfo[] = []
  const layoutData = new Map<string, PartData>()
  const masterParts = kids(child(presentation, "sldMasterIdLst"), "sldMasterId")
    .map((m) => relPart(relAttr(m, "id")))
    .filter((p): p is string => p !== null)

  for (const [index, masterPart] of masterParts.entries()) {
    const number = index + 1
    const data = await loadPart(ctx, "master", masterPart, null, null)
    if (!data) continue
    const masterThemePart = data.rels.find((r) => r.type === "theme")?.part
    if (masterThemePart && masterThemePart !== themePart && index === 0) {
      ctx.theme = readTheme(await pkg.readXml(masterThemePart))
    }
    const label = `slide master ${number}`
    const titleShape = data.shapes.find((s) => s.ph && normalType(s.ph.type) === "title")
    const bodyShape = data.shapes.find((s) => s.ph && s.ph.type === "body")
    const styleOf = (shape: PartShape | undefined, which: "titleStyle" | "bodyStyle") => {
      const sources = shape
        ? styleSources(shape, data, presentation, ctx.theme)
        : { lists: [path(data.root, "txStyles", which), child(presentation, "defaultTextStyle")], fontRefColour: null, theme: ctx.theme, colourMap: colourMapFor(data) }
      return runStyle(null, null, 0, sources)
    }
    const { pictures, shapes } = await graphicsOf(data, label, ctx)
    masters.push({
      number,
      part: masterPart,
      name: attr(path(data.root, "cSld"), "name"),
      background: (await readBackground(data, label, ctx)) ?? { kind: "none", colour: null, mediaPart: null, sha256: null, transparencyPercent: null, tiled: null, match: null },
      titleStyle: styleOf(titleShape, "titleStyle"),
      bodyStyle: styleOf(bodyShape, "bodyStyle"),
      pictures,
      shapes,
      placeholders: placeholderInfos(data, ctx),
      footerItems: footerItems(data, ctx),
      headerFooter: readHeaderFooter(child(data.root, "hf")),
    })

    const layoutParts = kids(child(data.root, "sldLayoutIdLst"), "sldLayoutId")
      .map((l) => {
        const rid = relAttr(l, "id")
        return data.rels.find((r) => r.id === rid)?.part ?? null
      })
      .filter((p): p is string => p !== null)
    for (const layoutPart of layoutParts) {
      const layout = await loadPart(ctx, "layout", layoutPart, data, data)
      if (!layout) continue
      layoutData.set(layoutPart, layout)
      const name = attr(path(layout.root, "cSld"), "name")
      const graphics = await graphicsOf(layout, `layout "${name ?? layoutPart}"`, ctx)
      layouts.push({
        part: layoutPart,
        masterNumber: number,
        name,
        type: attr(layout.root, "type"),
        placeholders: placeholderInfos(layout, ctx),
        pictures: graphics.pictures,
        shapes: graphics.shapes,
        showsDate: placeholderShows(layout, "dt"),
        showsFooter: placeholderShows(layout, "ftr"),
        showsSlideNumber: placeholderShows(layout, "sldNum"),
        hasPicturePlaceholder: placeholderShows(layout, "pic"),
        footerItems: footerItems(layout, ctx),
        background: await readBackground(layout, `layout "${name ?? layoutPart}"`, ctx),
        showMasterShapes: boolAttr(layout.root, "showMasterSp") ?? true,
        headerFooter: readHeaderFooter(child(layout.root, "hf")),
        usedBySlides: [],
      })
    }
  }

  // Slides: load all first so links can name their target slide's title.
  const slideData: { part: string; data: PartData; layout: PartData | null }[] = []
  for (const part of slideParts) {
    const rels = await pkg.rels(part)
    const layoutPart = rels.find((r) => r.type === "slideLayout")?.part ?? null
    const layout = layoutPart ? layoutData.get(layoutPart) ?? null : null
    if (layoutPart && !layout) warnings.push(`${part} uses a layout (${layoutPart}) that is not in any slide master.`)
    const data = await loadPart(ctx, "slide", part, layout, layout?.master ?? null)
    if (!data) continue
    slideData.push({ part, data, layout })
    const title = data.shapes.find((s) => s.ph && normalType(s.ph.type) === "title")
    ctx.slideTitles.set(part, title ? bodyText(title.txBody).replace(/\s+/g, " ") || null : null)
  }

  const notesMasterPart = relPart(relAttr(kids(child(presentation, "notesMasterIdLst"), "notesMasterId")[0] ?? null, "id"))
    ?? presRels.find((r) => r.type === "notesMaster")?.part ?? null
  const handoutMasterPart = relPart(relAttr(kids(child(presentation, "handoutMasterIdLst"), "handoutMasterId")[0] ?? null, "id"))
    ?? presRels.find((r) => r.type === "handoutMaster")?.part ?? null
  const notesMasterData = notesMasterPart ? await loadPart(ctx, "notes master", notesMasterPart, null, null) : null

  const slides: SlideInfo[] = []
  const notesSlideFooters: PresentationReport["notesSlideFooters"] = []
  for (const { part, data, layout } of slideData) {
    const number = ctx.slideNumbers.get(part)!
    const label = `slide ${number}`
    const layoutName = layout ? attr(path(layout.root, "cSld"), "name") : null
    const layoutInfo = layouts.find((l) => l.part === layout?.part)
    layoutInfo?.usedBySlides.push(number)

    const titleShape = data.shapes.find((s) => s.ph && normalType(s.ph.type) === "title")
    const shapes: ShapeInfo[] = []
    const pictures: PictureInfo[] = []
    for (const shape of data.shapes) {
      if (shape.kind === "picture") {
        pictures.push(await readPicture(shape, data, label, ctx))
        continue
      }
      const info = shapeInfo(shape, data, ctx)
      if (shape.kind === "diagram") info.paragraphs = await diagramParagraphs(shape, data, ctx)
      info.pictureFill = await readPictureFill(shape, data, label, ctx)
      shapes.push(info)
    }

    // Graphics drawn from the layout and master (not placeholders), master
    // first: that is the order they are drawn in, behind the slide's own.
    const inherited: { name: string; rect: Rect; shape: PartShape; source: "layout" | "slide master" }[] = []
    const showLayoutShapes = boolAttr(data.root, "showMasterSp") ?? true
    if (showLayoutShapes && layout) {
      const fromLayout = layout.shapes.filter((s) => !s.ph && !s.hidden)
      const fromMaster = (boolAttr(layout.root, "showMasterSp") ?? true) && layout.parent
        ? layout.parent.shapes.filter((s) => !s.ph && !s.hidden)
        : []
      for (const [source, list, owner] of [["slide master", fromMaster, layout.parent], ["layout", fromLayout, layout]] as const) {
        for (const shape of list) {
          const rect = owner ? resolveRect(shape, owner).rect : null
          if (rect) inherited.push({ name: `"${shape.name}" (${source})`, rect, shape, source })
        }
      }
    }

    const isFullSlide = (shape: PartShape, rect: Rect) => shape.kind === "picture" && coverage(rect, size) >= FULL_SLIDE_PERCENT
    const visible: Drawn[] = []
    const fullSlidePictures: SlideInfo["fullSlidePictures"] = []
    for (const item of inherited) {
      if (item.rect.cx <= 0 || item.rect.cy <= 0) continue
      const fullSlide = isFullSlide(item.shape, item.rect)
      visible.push({ name: item.name, rect: item.rect, footer: false, fullSlide })
      if (fullSlide) {
        fullSlidePictures.push({ name: item.shape.name, source: item.source, transparencyPercent: pictureTransparency(item.shape.el), coveragePercent: coverage(item.rect, size) })
      }
    }
    for (const shape of data.shapes) {
      if (!visibleOnSlide(shape)) continue
      const rect = resolveRect(shape, data).rect
      if (!rect || rect.cx <= 0 || rect.cy <= 0) continue
      const fullSlide = isFullSlide(shape, rect)
      visible.push({ name: `"${shape.name}"`, rect, footer: !!shape.ph && ["dt", "ftr", "sldNum"].includes(shape.ph.type), fullSlide })
      if (fullSlide) {
        fullSlidePictures.push({ name: shape.name, source: "slide", transparencyPercent: pictureTransparency(shape.el), coveragePercent: coverage(rect, size) })
      }
    }
    const off = visible.map((v) => offSlide(v.name, v.rect, size)).filter((o): o is OffSlide => o !== null)

    const ownBackground = await readBackground(data, label, ctx)
    const masterInfo = masters.find((m) => m.number === layoutInfo?.masterNumber)
    const effectiveBackground: SlideInfo["effectiveBackground"] = ownBackground
      ? { source: "slide", background: ownBackground }
      : layoutInfo?.background
        ? { source: "layout", background: layoutInfo.background }
        : masterInfo
          ? { source: "slide master", background: masterInfo.background }
          : null

    const idCounts = new Map<string, number>()
    for (const shape of data.shapes) idCounts.set(shape.id, (idCounts.get(shape.id) ?? 0) + 1)
    const duplicateShapeIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id)

    const lookup = (id: string) => {
      const shape = data.shapes.find((s) => s.id === id)
      return shape ? { name: shape.name, paragraphs: kids(shape.txBody, "p").map(paragraphText) } : null
    }

    const links = readLinks(data.shapes, data, ctx)
    const actionButtons: ActionButton[] = data.shapes
      .filter((s) => s.geometry?.startsWith("actionButton"))
      .map((s) => ({
        slide: number,
        name: s.name,
        geometry: s.geometry!,
        box: toBox(resolveRect(s, data).rect),
        links: links.filter((l) => l.on === "shape" && l.shapeName === s.name),
      }))

    let notes: string | null = null
    const notesPart = data.rels.find((r) => r.type === "notesSlide")?.part
    if (notesPart) {
      const notesData = await loadPart(ctx, "notes", notesPart, notesMasterData, notesMasterData)
      if (notesData) {
        const body = notesData.shapes.find((s) => s.ph?.type === "body")
        notes = body ? bodyText(body.txBody) || null : null
        const items = footerItems(notesData, ctx)
        if (items.length) notesSlideFooters.push({ slide: number, items })
      }
    }

    slides.push({
      number,
      part,
      layoutName,
      layoutPart: layout?.part ?? null,
      hidden: boolAttr(data.root, "show") === false,
      title: ctx.slideTitles.get(part) ?? null,
      titleStyle: titleShape ? titleStyle(titleShape, data, ctx) : null,
      shapes,
      pictures,
      footerItems: footerItems(data, ctx),
      inheritedGraphics: inherited.map((i) => i.name),
      overlaps: overlaps(visible),
      offSlide: off,
      duplicateShapeIds,
      background: ownBackground,
      effectiveBackground,
      fullSlidePictures,
      transition: readTransition(data.root),
      animations: readAnimations(data.root, lookup),
      links,
      actionButtons,
      notes,
    })
  }

  // Every media part, used or not.
  for (const name of pkg.entryNames.filter((n) => n.startsWith("ppt/media/")).sort()) {
    await recordMedia(name, "", ctx)
  }

  const app = await pkg.readXml("docProps/app.xml")
  const presProps = presRels.find((r) => r.type === "presProps")?.part
  const showPr = child(presProps ? await pkg.readXml(presProps) : null, "showPr")
  const hasMacros =
    pkg.entryNames.some((n) => /vbaProject\.bin$/i.test(n)) ||
    presRels.some((r) => r.type === "vbaProject")

  return {
    presentation: {
      application: child(app, "Application")?.text ?? null,
      appVersion: child(app, "AppVersion")?.text ?? null,
      slideCount: slides.length,
      slideSize: {
        cx: size.cx,
        cy: size.cy,
        widthCm: cm(size.cx),
        heightCm: cm(size.cy),
        ...ratioInfo(size.cx, size.cy),
        typeLabel: attr(sldSz, "type"),
      },
      hiddenSlides: slides.filter((s) => s.hidden).map((s) => s.number),
      show: {
        mode: child(showPr, "kiosk") ? "kiosk" : child(showPr, "browse") ? "browsed by an individual" : "presented by a speaker",
        loopUntilEsc: boolAttr(showPr, "loop") ?? false,
        useTimings: boolAttr(showPr, "useTimings") ?? true,
        showNarration: boolAttr(showPr, "showNarration") ?? false,
        showAnimation: boolAttr(showPr, "showAnimation") ?? true,
      },
      hasMacros,
    },
    masters,
    layouts,
    slides,
    notesMaster: notesLikeMaster(ctx, notesMasterData),
    handoutMaster: notesLikeMaster(ctx, handoutMasterPart ? await loadPart(ctx, "handout master", handoutMasterPart, null, null) : null),
    notesSlideFooters,
    media: [...ctx.media.values()].sort((a, b) => a.part.localeCompare(b.part, undefined, { numeric: true })),
    ...suppliedImagesSummary(ctx.known, masters, layouts, slides, ctx.media),
    warnings,
  }
}

// Every supplied image and where it is used, and the pictures that match
// none of them, from the matches already made on each picture.
function suppliedImagesSummary(
  known: KnownImage[] | null,
  masters: MasterInfo[],
  layouts: LayoutInfo[],
  slides: SlideInfo[],
  media: Map<string, MediaInfo>,
): Pick<PresentationReport, "suppliedImages" | "unmatchedPictures"> {
  if (!known) return { suppliedImages: null, unmatchedPictures: null }
  const uses: { use: ImageUse; mediaPart: string | null }[] = []
  const add = (where: string, background: BackgroundInfo | null, pictures: PictureInfo[], shapes: ShapeInfo[]) => {
    if (background?.match) uses.push({ use: { where, as: "background", shapeName: null, box: null, match: background.match }, mediaPart: background.mediaPart })
    for (const p of pictures) {
      if (!p.match) continue
      const as = (p.slideCoveragePercent ?? 0) >= FULL_SLIDE_PERCENT ? "full-slide picture" : "picture"
      uses.push({ use: { where, as, shapeName: p.name, box: p.box, match: p.match }, mediaPart: p.mediaPart })
    }
    for (const s of shapes) {
      if (s.pictureFill?.match) uses.push({ use: { where, as: "picture fill", shapeName: s.name, box: s.box, match: s.pictureFill.match }, mediaPart: s.pictureFill.mediaPart })
    }
  }
  for (const m of masters) add(`slide master ${m.number}`, m.background, m.pictures, m.shapes)
  for (const l of layouts) add(`layout "${l.name ?? l.part}"`, l.background, l.pictures, l.shapes)
  for (const s of slides) add(`slide ${s.number}`, s.background, s.pictures, s.shapes)

  const named = (u: ImageUse) => u.match.kind === "exact" || u.match.kind === "similar"
  return {
    suppliedImages: known.map((k) => ({
      name: k.name,
      uses: uses.map((u) => u.use).filter((u) => named(u) && u.match.name === k.name),
    })),
    unmatchedPictures: uses.filter((u) => !named(u.use)).map(({ use, mediaPart }) => {
      const info = mediaPart ? media.get(mediaPart) : undefined
      return { ...use, mediaPart, pixelWidth: info?.pixelWidth ?? null, pixelHeight: info?.pixelHeight ?? null }
    }),
  }
}
