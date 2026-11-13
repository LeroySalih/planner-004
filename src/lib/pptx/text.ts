// Effective text formatting. A run's properties come from the first place
// that sets them: the run itself, its paragraph, the shape's list style, the
// matching layout and master placeholders, the master's text styles, then the
// presentation's default text style.

import { colourElement, describeColour, resolveColour, type ColourMap, type Theme } from "./colour"
import type { Colour, Paragraph, TextRunStyle, TextSummary } from "./types"
import { attr, child, kids, numAttr, type XmlElement } from "./xml"

export type StyleSources = {
  // Elements holding lvl1pPr..lvl9pPr, most specific first.
  lists: (XmlElement | null)[]
  // The shape's own style colour (p:style/a:fontRef), used before the
  // master's text styles for shapes that are not placeholders.
  fontRefColour: XmlElement | null
  theme: Theme
  colourMap: ColourMap
}

function levelProps(list: XmlElement | null, level: number) {
  return child(list, `lvl${Math.min(9, Math.max(1, level + 1))}pPr`)
}

function resolveFont(typeface: string | null, theme: Theme) {
  if (!typeface) return null
  if (typeface.startsWith("+mj")) return theme.majorFont ?? typeface
  if (typeface.startsWith("+mn")) return theme.minorFont ?? typeface
  return typeface
}

export function runStyle(
  rPr: XmlElement | null,
  pPr: XmlElement | null,
  level: number,
  sources: StyleSources,
): TextRunStyle {
  const candidates = [
    rPr,
    child(pPr, "defRPr"),
    ...sources.lists.map((list) => child(levelProps(list, level), "defRPr")),
  ].filter((c): c is XmlElement => c !== null)

  const first = (name: string) => {
    for (const c of candidates) {
      const value = attr(c, name)
      if (value !== null) return value
    }
    return null
  }

  let colourHex: string | null = null
  for (const c of candidates) {
    const fill = child(c, "solidFill")
    if (fill) {
      colourHex = resolveColour(colourElement(fill), sources.theme, sources.colourMap)
      break
    }
  }
  if (!colourHex && sources.fontRefColour) {
    colourHex = resolveColour(sources.fontRefColour, sources.theme, sources.colourMap)
  }

  let font: string | null = null
  for (const c of candidates) {
    const latin = attr(child(c, "latin"), "typeface")
    if (latin) {
      font = resolveFont(latin, sources.theme)
      break
    }
  }

  const bold = first("b")
  const italic = first("i")
  const underline = first("u")
  const size = first("sz")
  return {
    bold: bold === "1" || bold === "true",
    italic: italic === "1" || italic === "true",
    underline: underline !== null && underline !== "none",
    sizePt: size !== null && Number.isFinite(Number(size)) ? Number(size) / 100 : null,
    font,
    colour: colourHex ? { hex: colourHex, name: describeColour(colourHex) } : null,
  }
}

export function paragraphLevel(p: XmlElement) {
  return numAttr(child(p, "pPr"), "lvl") ?? 0
}

export function paragraphText(p: XmlElement) {
  let text = ""
  for (const c of p.children) {
    if (c.name === "r" || c.name === "fld") text += child(c, "t")?.text ?? ""
    else if (c.name === "br") text += "\n"
  }
  return text
}

function paragraphProp(pPr: XmlElement | null, level: number, sources: StyleSources, pick: (el: XmlElement) => string | null) {
  for (const el of [pPr, ...sources.lists.map((list) => levelProps(list, level))]) {
    if (!el) continue
    const value = pick(el)
    if (value !== null) return value
  }
  return null
}

export function paragraphAlign(pPr: XmlElement | null, level: number, sources: StyleSources) {
  return paragraphProp(pPr, level, sources, (el) => attr(el, "algn"))
}

// "none", the bullet character, "auto-number" or "picture bullet".
function paragraphBullet(pPr: XmlElement | null, level: number, sources: StyleSources) {
  return paragraphProp(pPr, level, sources, (el) => {
    if (child(el, "buNone")) return "none"
    const char = child(el, "buChar")
    if (char) return attr(char, "char") ?? "•"
    if (child(el, "buAutoNum")) return `auto-number (${attr(child(el, "buAutoNum"), "type") ?? ""})`
    if (child(el, "buBlip")) return "picture bullet"
    return null
  })
}

const ALIGN_NAMES: Record<string, string> = {
  l: "left",
  ctr: "centre",
  r: "right",
  just: "justified",
  dist: "distributed",
  justLow: "justified",
  thaiDist: "distributed",
}

export function alignName(algn: string | null) {
  return algn ? ALIGN_NAMES[algn] ?? algn : null
}

export function readParagraphs(txBody: XmlElement | null, sources: StyleSources): Paragraph[] {
  return kids(txBody, "p").map((p, index) => {
    const pPr = child(p, "pPr")
    const level = paragraphLevel(p)
    const text = paragraphText(p)
    const bullet = paragraphBullet(pPr, level, sources)
    const bulleted = text.trim() !== "" && bullet !== null && bullet !== "none"
    return {
      index,
      level: level + 1,
      text,
      bulleted,
      bulletChar: bulleted ? bullet : null,
      align: alignName(paragraphAlign(pPr, level, sources) ?? "l"),
    }
  })
}

// Every run in a text body with its paragraph's pPr and level.
export function textRuns(txBody: XmlElement | null) {
  const runs: { rPr: XmlElement | null; pPr: XmlElement | null; level: number; text: string }[] = []
  for (const p of kids(txBody, "p")) {
    const pPr = child(p, "pPr")
    const level = paragraphLevel(p)
    for (const r of p.children) {
      if (r.name !== "r" && r.name !== "fld") continue
      runs.push({ rPr: child(r, "rPr"), pPr, level, text: child(r, "t")?.text ?? "" })
    }
  }
  return runs
}

// One summary of many runs: every distinct size (scaled by shrink-on-overflow
// when it applies), colour and font, and whether bold/italic hold for all.
export function summariseText(styles: TextRunStyle[], fontScalePercent: number | null): TextSummary {
  const all = (pick: (s: TextRunStyle) => boolean) => {
    const on = styles.filter(pick).length
    return on === styles.length ? "yes" : on === 0 ? "no" : "mixed"
  }
  const scale = fontScalePercent === null ? 1 : fontScalePercent / 100
  const sizes = new Set<number>()
  const colours = new Map<string, Colour>()
  const fonts = new Set<string>()
  for (const s of styles) {
    if (s.sizePt !== null) sizes.add(Math.round(s.sizePt * scale * 10) / 10)
    if (s.colour) colours.set(s.colour.hex, s.colour)
    if (s.font) fonts.add(s.font)
  }
  return {
    sizesPt: [...sizes].sort((a, b) => a - b),
    bold: all((s) => s.bold),
    italic: all((s) => s.italic),
    colours: [...colours.values()],
    fonts: [...fonts],
    autofitScalePercent: fontScalePercent,
  }
}
