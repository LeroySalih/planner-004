// Effective text formatting. A run's properties come from the first place
// that sets them: the run itself, its paragraph, the shape's list style, the
// matching layout and master placeholders, the master's text styles, then the
// presentation's default text style.

import { colourElement, describeColour, resolveColour, type ColourMap, type Theme } from "./colour"
import type { Colour, EffectiveTextStyle, FormatSource, Paragraph, Sourced, TextRunStyle, TextSummary } from "./types"
import { attr, child, kids, numAttr, type XmlElement } from "./xml"

export type StyleList = { el: XmlElement | null; from: FormatSource }

export type StyleSources = {
  // Elements holding lvl1pPr..lvl9pPr, most specific first, each with the
  // source it stands for.
  lists: StyleList[]
  // The part the shape is on: what its own run/paragraph properties count as.
  own: FormatSource
  // The shape's own style colour (p:style/a:fontRef), used before the
  // master's text styles for shapes that are not placeholders.
  fontRefColour: XmlElement | null
  theme: Theme
  colourMap: ColourMap
}

function levelProps(list: XmlElement | null, level: number) {
  return child(list, `lvl${Math.min(9, Math.max(1, level + 1))}pPr`)
}

// A theme font reference (+mj-lt, +mn-lt) as the theme's font; null when the
// theme does not name it.
function resolveFont(typeface: string, theme: Theme): { name: string | null; themeFont: "heading" | "body" | null } {
  if (typeface.startsWith("+mj")) return { name: theme.majorFont, themeFont: "heading" }
  if (typeface.startsWith("+mn")) return { name: theme.minorFont, themeFont: "body" }
  return { name: typeface, themeFont: null }
}

/**
 * A run's effective style, each value with its source: the run, its
 * paragraph, the list styles (shape, layout and master placeholders, master
 * text styles, presentation defaults), the shape's style (colour), then
 * PowerPoint's built-in defaults: 18 pt, not bold/italic/underlined, the
 * theme's body font and text colour (tx1 through the colour map).
 */
export function effectiveRunStyle(
  rPr: XmlElement | null,
  pPr: XmlElement | null,
  level: number,
  sources: StyleSources,
): EffectiveTextStyle {
  const candidates: { el: XmlElement; from: FormatSource }[] = []
  if (rPr) candidates.push({ el: rPr, from: sources.own })
  const defRPr = child(pPr, "defRPr")
  if (defRPr) candidates.push({ el: defRPr, from: sources.own })
  for (const list of sources.lists) {
    const el = child(levelProps(list.el, level), "defRPr")
    if (el) candidates.push({ el, from: list.from })
  }

  const firstAttr = (name: string) => {
    for (const c of candidates) {
      const value = attr(c.el, name)
      if (value !== null) return { value, from: c.from }
    }
    return null
  }
  const flag = (name: string, on: (v: string) => boolean): Sourced<boolean> => {
    const found = firstAttr(name)
    return found ? { value: on(found.value), from: found.from } : { value: false, from: "default" }
  }

  let colour: Sourced<Colour> | null = null
  for (const c of candidates) {
    const fill = child(c.el, "solidFill")
    if (fill) {
      colour = { value: colourOf(resolveColour(colourElement(fill), sources.theme, sources.colourMap)), from: c.from }
      break
    }
  }
  if (!colour && sources.fontRefColour) {
    colour = { value: colourOf(resolveColour(sources.fontRefColour, sources.theme, sources.colourMap)), from: "shape style" }
  }
  if (!colour) {
    const tx1 = sources.colourMap.tx1 ?? "dk1"
    const hex = sources.theme.colours[tx1] ?? null
    colour = { value: colourOf(hex), from: "default" }
  }

  let font: EffectiveTextStyle["font"] | null = null
  for (const c of candidates) {
    const latin = attr(child(c.el, "latin"), "typeface")
    if (latin) {
      const resolved = resolveFont(latin, sources.theme)
      font = { value: resolved.name, from: c.from, themeFont: resolved.themeFont }
      break
    }
  }
  if (!font) font = { value: sources.theme.minorFont, from: "default", themeFont: "body" }

  const size = firstAttr("sz")
  const sizeValue = size !== null && Number.isFinite(Number(size.value)) ? Number(size.value) / 100 : null
  return {
    sizePt: size ? { value: sizeValue, from: size.from } : { value: 18, from: "default" },
    font,
    colour,
    bold: flag("b", (v) => v === "1" || v === "true"),
    italic: flag("i", (v) => v === "1" || v === "true"),
    underline: flag("u", (v) => v !== "none"),
  }
}

function colourOf(hex: string | null): Colour | null {
  return hex ? { hex, name: describeColour(hex) } : null
}

export function runStyle(
  rPr: XmlElement | null,
  pPr: XmlElement | null,
  level: number,
  sources: StyleSources,
): TextRunStyle {
  const effective = effectiveRunStyle(rPr, pPr, level, sources)
  return {
    bold: effective.bold.value === true,
    italic: effective.italic.value === true,
    underline: effective.underline.value === true,
    sizePt: effective.sizePt.value,
    font: effective.font.value,
    colour: effective.colour.value,
    effective,
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

function sourcedParagraphProp(pPr: XmlElement | null, level: number, sources: StyleSources, pick: (el: XmlElement) => string | null) {
  const chain = [{ el: pPr, from: sources.own }, ...sources.lists.map((list) => ({ el: levelProps(list.el, level), from: list.from }))]
  for (const { el, from } of chain) {
    if (!el) continue
    const value = pick(el)
    if (value !== null) return { value, from }
  }
  return null
}

function paragraphProp(pPr: XmlElement | null, level: number, sources: StyleSources, pick: (el: XmlElement) => string | null) {
  return sourcedParagraphProp(pPr, level, sources, pick)?.value ?? null
}

export function paragraphAlign(pPr: XmlElement | null, level: number, sources: StyleSources) {
  return paragraphProp(pPr, level, sources, (el) => attr(el, "algn"))
}

/** A paragraph's effective alignment as a name, with its source; left by default. */
export function effectiveAlign(pPr: XmlElement | null, level: number, sources: StyleSources): Sourced<string> {
  const found = sourcedParagraphProp(pPr, level, sources, (el) => attr(el, "algn"))
  return found ? { value: alignName(found.value), from: found.from } : { value: "left", from: "default" }
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

export function readParagraphs(txBody: XmlElement | null, sources: StyleSources, fontScale: number | null = null): Paragraph[] {
  return kids(txBody, "p").map((p, index) => {
    const pPr = child(p, "pPr")
    const level = paragraphLevel(p)
    const text = paragraphText(p)
    const bullet = paragraphBullet(pPr, level, sources)
    const bulleted = text.trim() !== "" && bullet !== null && bullet !== "none"
    const align = effectiveAlign(pPr, level, sources)
    const runs = p.children
      .filter((r) => (r.name === "r" || r.name === "fld") && (child(r, "t")?.text ?? "").trim() !== "")
      .map((r) => runStyle(child(r, "rPr"), pPr, level, sources))
    return {
      index,
      level: level + 1,
      text,
      bulleted,
      bulletChar: bulleted ? bullet : null,
      align: align.value,
      alignFrom: align.from,
      textSummary: runs.length > 0 ? summariseText(runs, fontScale) : null,
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
  let unknownSize = false
  let unknownColour = false
  let unknownFont = false
  for (const s of styles) {
    if (s.sizePt !== null) sizes.add(Math.round(s.sizePt * scale * 10) / 10)
    else unknownSize = true
    if (s.colour) colours.set(s.colour.hex, s.colour)
    else unknownColour = true
    if (s.font) fonts.add(s.font)
    else unknownFont = true
  }
  return {
    sizesPt: [...sizes].sort((a, b) => a - b),
    bold: all((s) => s.bold),
    italic: all((s) => s.italic),
    colours: [...colours.values()],
    fonts: [...fonts],
    autofitScalePercent: fontScalePercent,
    underline: all((s) => s.underline),
    // Some run's value could not be resolved (reported as UNKNOWN).
    unknown: [...(unknownSize ? ["size"] : []), ...(unknownColour ? ["colour"] : []), ...(unknownFont ? ["font"] : [])],
  }
}
