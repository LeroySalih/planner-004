// The inspector's report in plain English, for an AI marker or a teacher to
// read instead of XML. Facts only: it never says whether a mark is earned.

import { describeMatch } from "./known-images"
import { DEFAULT_PRESENTATION_SECTIONS } from "./section-selectors"
import type {
  AnimationInfo,
  BackgroundInfo,
  Box,
  Colour,
  EffectiveTextStyle,
  Field,
  FillInfo,
  FormatSource,
  FooterItem,
  HeaderFooterFlags,
  ImageUse,
  LayoutInfo,
  Link,
  PictureInfo,
  PlaceholderInfo,
  PresentationReport,
  ShapeInfo,
  TextLayout,
  TextRunStyle,
  TextSummary,
  TransitionInfo,
} from "./types"

const FOOTER_PLACEHOLDERS = new Set(["dt", "ftr", "sldNum", "hdr"])

/** What the report says for a value the reader could not resolve. */
export const UNKNOWN_VALUE = "UNKNOWN (reader could not resolve)"

// The part a line describes: its own values are "set on this <part>".
type Here = "slide" | "layout" | "master"

function sourceText(from: FormatSource, here: Here) {
  if (from === here) return `set on this ${here}`
  switch (from) {
    case "slide":
      return "set on the slide"
    case "layout":
      return "from layout"
    case "master":
      return "from master"
    case "presentation":
      return "from the presentation's default text style"
    case "shape style":
      return "from the shape's style"
    default:
      return "default"
  }
}

type Item = { text: string; from: FormatSource }

// Values grouped by source, in order: "44 pt, font "Calibri" [from master];
// not bold, not italic [default]".
function grouped(items: Item[], here: Here) {
  const groups = new Map<FormatSource, string[]>()
  for (const item of items) groups.set(item.from, [...(groups.get(item.from) ?? []), item.text])
  return [...groups].map(([from, texts]) => `${texts.join(", ")} [${sourceText(from, here)}]`).join("; ")
}

function styleItems(s: EffectiveTextStyle): Item[] {
  const font = s.font.value === null
    ? `font ${UNKNOWN_VALUE}`
    : `font "${s.font.value}"${s.font.themeFont ? ` (theme ${s.font.themeFont} font)` : ""}`
  return [
    { text: s.sizePt.value === null ? `size ${UNKNOWN_VALUE}` : `${s.sizePt.value} pt`, from: s.sizePt.from },
    { text: font, from: s.font.from },
    { text: s.colour.value === null ? `colour ${UNKNOWN_VALUE}` : colour(s.colour.value), from: s.colour.from },
    { text: s.bold.value ? "bold" : "not bold", from: s.bold.from },
    { text: s.italic.value ? "italic" : "not italic", from: s.italic.from },
    { text: s.underline.value ? "underlined" : "not underlined", from: s.underline.from },
  ]
}

function fillText(f: FillInfo) {
  const clear = f.transparencyPercent ? `, transparency ${f.transparencyPercent}%` : ""
  switch (f.kind) {
    case "none":
      return "no fill"
    case "solid":
      return `fill solid ${f.colour ? colour(f.colour) : UNKNOWN_VALUE}${clear}`
    case "gradient":
      return `fill gradient (${(f.stops ?? []).map((c) => (c ? colour(c) : UNKNOWN_VALUE)).join(" → ")})`
    case "picture":
      return `fill picture${clear}`
    case "pattern":
      return "fill pattern"
    case "group":
      return "fill from its group"
    default:
      return `fill ${UNKNOWN_VALUE}`
  }
}

function fillItem(f: FillInfo): Item {
  return { text: fillText(f), from: f.viaStyle ? "shape style" : f.from }
}

function layoutItems(t: TextLayout): Item[] {
  return [
    {
      text: t.align.value === "mixed"
        ? "paragraphs aligned differently (see each paragraph)"
        : `text aligned ${t.align.value ?? UNKNOWN_VALUE}`,
      from: t.align.from,
    },
    { text: `anchored ${t.anchor.value ?? UNKNOWN_VALUE}`, from: t.anchor.from },
  ]
}

// PowerPoint's date formats 1..13 (Insert > Date and Time), as ECMA-376 gives
// them in US English; the field's language sets the order and the names.
const DATE_FORMATS: Record<string, string> = {
  datetime: "the default date format",
  datetime1: "short date, MM/DD/YYYY style",
  datetime2: "long date with the weekday, Day, Month DD, YYYY style",
  datetime3: "DD Month YYYY style",
  datetime4: "Month DD, YYYY style",
  datetime5: "DD-Mon-YY style",
  datetime6: "Month YY style",
  datetime7: "Mon-YY style",
  datetime8: "date and time, MM/DD/YYYY hh:mm AM/PM style",
  datetime9: "date and time, MM/DD/YYYY hh:mm:ss AM/PM style",
  datetime10: "time, hh:mm style",
  datetime11: "time, hh:mm:ss style",
  datetime12: "time, hh:mm AM/PM style",
  datetime13: "time, hh:mm:ss AM/PM style",
  datetimeFigureOut: "the template's own date",
}

function dateField(f: Field, here: Here) {
  // A layout's date is only the template for its slides: type and language.
  if (here === "layout") return `date field ${f.type}${f.lang ? ` (language ${f.lang})` : ""}`
  const format = DATE_FORMATS[f.type]
  const details = [
    ...(format ? [`format ${format} in the field's language`] : []),
    ...(f.lang !== undefined ? [`language ${f.lang ?? "not set"}`] : []),
    "updates automatically",
  ]
  return `date field ${f.type} (${details.join(", ")}; showing ${quote(f.text)})`
}

function n2(value: number) {
  return value.toFixed(2)
}

function box(b: Box | null) {
  if (!b) return "position unknown"
  return `at (${n2(b.xCm)}, ${n2(b.yCm)}) cm, ${n2(b.widthCm)} × ${n2(b.heightCm)} cm`
}

function colour(c: Colour | null) {
  if (!c) return "colour not set"
  return c.name ? `#${c.hex} (${c.name})` : `#${c.hex}`
}

function quote(text: string) {
  return `"${text.replace(/\s*\n\s*/g, " / ")}"`
}

function yesNo(value: boolean) {
  return value ? "on" : "off"
}

function runStyle(s: TextRunStyle) {
  const parts = [
    s.bold ? "bold" : "not bold",
    s.italic ? "italic" : "not italic",
  ]
  if (s.underline) parts.push("underlined")
  parts.push(colour(s.colour))
  if (s.sizePt !== null) parts.push(`${s.sizePt} pt`)
  if (s.font) parts.push(`font "${s.font}"`)
  return parts.join(", ")
}

function textSummary(t: TextSummary) {
  const unknown = new Set(t.unknown ?? [])
  const sizeList = t.sizesPt.length === 0
    ? (t.unknown ? UNKNOWN_VALUE : "size not set")
    : t.sizesPt.length === 1 ? `${t.sizesPt[0]} pt` : `${t.sizesPt[0]}–${t.sizesPt[t.sizesPt.length - 1]} pt`
  const sizes = unknown.has("size") && t.sizesPt.length > 0 ? `${sizeList} and size ${UNKNOWN_VALUE}` : sizeList
  const scaled = t.autofitScalePercent !== null ? ` (shrunk to ${t.autofitScalePercent}% to fit the box)` : ""
  const flag = (value: TextSummary["bold"], on: string) => (value === "yes" ? on : value === "no" ? `not ${on}` : `partly ${on}`)
  const colourList = [...t.colours.map((c) => colour(c)), ...(unknown.has("colour") ? [`colour ${UNKNOWN_VALUE}`] : [])]
  const colours = colourList.length ? colourList.join(" / ") : "colour not set"
  const parts = [`text ${sizes}${scaled}`, flag(t.bold, "bold"), flag(t.italic, "italic")]
  if (t.underline) parts.push(flag(t.underline, "underlined"))
  parts.push(colours)
  // Fonts are printed from powerpoint-reader-2 on (underline marks such a report).
  if (t.underline) {
    const fonts = [...t.fonts.map((f) => `"${f}"`), ...(unknown.has("font") ? [UNKNOWN_VALUE] : [])]
    parts.push(`font ${fonts.join(" / ")}`)
  }
  return parts.join(", ")
}

// The paragraph's own formatting, when the shape's runs are not all alike.
function mixedRuns(t: TextSummary | null) {
  if (!t) return false
  return t.sizesPt.length > 1 || t.colours.length > 1 || t.fonts.length > 1 ||
    t.bold === "mixed" || t.italic === "mixed" || t.underline === "mixed"
}

function background(bg: BackgroundInfo | null) {
  if (!bg) return "inherited"
  switch (bg.kind) {
    case "picture":
      return `picture ${bg.mediaPart ?? "(missing)"}${bg.tiled ? " (tiled)" : ""}, transparency ${bg.transparencyPercent ?? 0}%${bg.match ? `; image: ${describeMatch(bg.match)}` : ""}`
    case "none":
      return "none set"
    case "solid":
      return `solid ${colour(bg.colour)}`
    case "theme style":
      return `theme background style${bg.colour ? ` ${colour(bg.colour)}` : ""}`
    default:
      return bg.kind
  }
}

function headerFooter(hf: HeaderFooterFlags | null) {
  if (!hf) return "no header/footer settings stored (hf element absent)"
  return `header/footer flags: date ${yesNo(hf.date)}, footer ${yesNo(hf.footer)}, slide number ${yesNo(hf.slideNumber)}, header ${yesNo(hf.header)}`
}

function footerItem(item: FooterItem, here: Here) {
  const content: string[] = []
  for (const f of item.fields) {
    content.push(
      f.type.startsWith("datetime")
        ? dateField(f, here)
        : f.type === "slidenum" ? "slide number field" : `field ${f.type}`,
    )
  }
  if (item.fields.length === 0) content.push(item.text ? `typed text ${quote(item.text)}` : "empty")
  else if (item.text && item.fields.every((f) => f.text !== item.text)) content.push(`text ${quote(item.text)}`)
  const typed = item.typedDate
    ? " — a typed date, NOT a date field, so it does not update"
    : item.typedNumber ? " — a typed number, NOT the slide number field, so it is the same on every slide" : ""
  const aligned = item.alignFrom ? `aligned ${item.align ?? UNKNOWN_VALUE} [${sourceText(item.alignFrom, here)}]` : `aligned ${item.align ?? "left"}`
  const style = item.style ? `; text ${grouped(styleItems(item.style), here)}` : ""
  return `${item.kind} placeholder "${item.name}", ${aligned}, ${box(item.box)}: ${content.join("; ")}${typed}${style}`
}

function picture(p: PictureInfo) {
  const parts = [`picture "${p.name}"`]
  if (p.descr) parts.push(`(file name/alt text ${quote(p.descr)})`)
  const px = p.slidePx ? ` (${p.slidePx.width} × ${p.slidePx.height} px on the slide at 96 dpi)` : ""
  parts.push(box(p.box) + px + (p.boxInherited ? " (from the placeholder)" : ""))
  if (p.placeholder) {
    parts.push(`in ${p.placeholder.type} placeholder${p.placeholder.idx !== null ? ` idx ${p.placeholder.idx}` : ""}${p.placeholderName ? ` "${p.placeholderName}"` : ""}`)
  } else {
    parts.push("not in a placeholder")
  }
  if (p.corner) parts.push(`sits ${p.corner}`)
  parts.push(`media ${p.mediaPart ?? p.linkedTarget ?? "missing"}`)
  if (p.pixelWidth && p.pixelHeight) parts.push(`image file ${p.pixelWidth} × ${p.pixelHeight} px`)
  if (p.cropPercent) {
    const c = p.cropPercent
    if (c.left || c.top || c.right || c.bottom) parts.push(`cropped l ${c.left}% t ${c.top}% r ${c.right}% b ${c.bottom}%`)
  }
  if (p.transparencyPercent > 0) parts.push(`transparency ${p.transparencyPercent}%`)
  if (p.slideCoveragePercent !== null && p.slideCoveragePercent >= 50) parts.push(`covers ${p.slideCoveragePercent}% of the slide`)
  if (p.stretched !== null) {
    parts.push(p.stretched ? `STRETCHED: aspect ${p.displayedAspect} shown vs ${p.imageAspect} in the image (${p.distortionPercent}% distortion)` : "aspect ratio kept")
  }
  if (p.hidden) parts.push("hidden")
  return parts.join(", ") + (p.match ? `; image: ${describeMatch(p.match)}` : "")
}

function shape(s: ShapeInfo, here: Here) {
  const ph = s.placeholder
    ? `${s.placeholder.type} placeholder${s.placeholder.idx !== null ? ` idx ${s.placeholder.idx}` : ""}`
    : "not a placeholder"
  const empty = s.box && (s.box.widthCm === 0 || s.box.heightCm === 0) ? " — ZERO-SIZE BOX" : ""
  const sits = s.corner ? `, sits ${s.corner}` : ""
  const head = `${s.kind} "${s.name}" (${ph}${s.geometry && s.geometry !== "rect" ? `, ${s.geometry}` : ""}${s.inGroup ? `, in group "${s.inGroup}"` : ""}${s.hidden ? ", hidden" : ""}), ${box(s.box)}${s.boxInherited ? " (from the layout/master)" : ""}${sits}${empty}`
  const lines = [head]
  // The slide's title placeholder has its own Title formatting line.
  const titleOnSlide = here === "slide" && (s.placeholder?.type === "title" || s.placeholder?.type === "ctrTitle")
  const format: Item[] = []
  if (s.textLayout && !titleOnSlide && (s.paragraphs.some((p) => p.text.trim() !== "") || s.placeholder)) format.push(...layoutItems(s.textLayout))
  if (s.fill && !titleOnSlide) format.push(fillItem(s.fill))
  if (format.length) lines.push(`  ${grouped(format, here)}`)
  if (s.pictureFill) {
    const fill = s.pictureFill
    lines.push(`  filled with picture ${fill.mediaPart ?? "(missing)"}${fill.match ? `; image: ${describeMatch(fill.match)}` : ""}`)
  }
  if (s.textSummary) lines.push(`  ${textSummary(s.textSummary)}`)
  const perParagraph = mixedRuns(s.textSummary)
  const alignEach = s.textLayout?.align.value === "mixed"
  for (const p of s.paragraphs) {
    if (p.text.trim() === "") continue
    const extra: string[] = []
    if (alignEach && p.alignFrom) extra.push(`aligned ${p.align ?? UNKNOWN_VALUE} [${sourceText(p.alignFrom, here)}]`)
    if (perParagraph && p.textSummary) extra.push(textSummary(p.textSummary))
    lines.push(`  paragraph ${p.index + 1} (level ${p.level}${p.bulleted ? `, bullet ${p.bulletChar}` : ", no bullet"}${extra.length ? `; ${extra.join("; ")}` : ""}): ${quote(p.text)}`)
  }
  for (const [i, row] of (s.tableRows ?? []).entries()) {
    lines.push(`  row ${i + 1}: ${row.map((cell) => quote(cell)).join(" | ")}`)
  }
  return lines
}

function transition(t: TransitionInfo | null) {
  if (!t || (!t.effect && t.advanceAfterSeconds === null && t.advanceOnClick)) return "no transition"
  const parts = [t.effect ? `${t.effect}` : "no effect"]
  if (t.effect) {
    const opts = Object.entries(t.options).map(([k, v]) => `${k}=${v}`).join(" ")
    if (opts) parts[0] += ` (${opts})`
    parts.push(`speed ${t.speed ?? "default"}${t.durationSeconds !== null ? `, duration ${t.durationSeconds.toFixed(2)} s` : ""}`)
  }
  parts.push(`advance on mouse click: ${yesNo(t.advanceOnClick)}`)
  parts.push(`advance after: ${t.advanceAfterSeconds === null ? "off" : `${t.advanceAfterSeconds.toFixed(1)} s`}`)
  return parts.join("; ")
}

function animation(a: AnimationInfo) {
  let target = "no target"
  if (a.target) {
    target = `"${a.target.shapeName ?? `shape id ${a.target.shapeId}`}"`
    if (a.target.paragraphStart !== null) {
      const range = a.target.paragraphStart === a.target.paragraphEnd
        ? `paragraph ${a.target.paragraphStart}`
        : `paragraphs ${a.target.paragraphStart}–${a.target.paragraphEnd}`
      target += ` ${range}${a.target.paragraphText !== null ? ` ${quote(a.target.paragraphText)}` : ""}`
    } else if (a.target.background) {
      target += " background"
    } else {
      target += " (whole shape)"
    }
  }
  const duration = a.durationSeconds === null ? "duration not set" : `duration ${a.durationSeconds.toFixed(1)} s`
  const repeat = a.repeat ? `, repeat ${a.repeat}` : ""
  return `${a.order}. ${a.effectName} (${a.class}) on ${target} — ${a.start}, ${duration}, delay ${a.delaySeconds.toFixed(1)} s${repeat}`
}

function link(l: Link) {
  const event = l.event === "mouse over" ? " (on mouse over)" : ""
  const source = l.on === "text"
    ? `text ${quote(l.text ?? "")} in "${l.shapeName}"`
    : `${l.shapeGeometry?.startsWith("actionButton") ? `action button ${l.shapeGeometry}` : `shape "${l.shapeName}"${l.shapeGeometry ? ` (${l.shapeGeometry})` : ""}`}`
  return `${source}${event} → ${l.kind}: ${l.description}`
}

function useKind(u: ImageUse) {
  return u.as === "background" ? "background" : `${u.as} "${u.shapeName}"`
}

// "slide 3 picture "Picture 4" (exact copy)", with the size for pictures.
function imageUse(u: ImageUse) {
  const how = u.match.kind === "exact"
    ? "exact copy"
    : `looks like it, similarity ${u.match.similarityPercent}%${u.match.shownPercent !== null && u.match.shownPercent < 80 ? `, about ${u.match.shownPercent}% of it shown` : ""}`
  const size = u.box ? `, ${n2(u.box.widthCm)} × ${n2(u.box.heightCm)} cm` : ""
  const crop = u.match.cropped ? ", cropped" : ""
  return `${u.where} ${useKind(u)}${size} (${how}${crop})`
}

// The footer items of a part, one line each; when their text styles are all
// the same, the style is given once, naming the items it applies to.
function footerBlock(items: FooterItem[], here: Here): string[] {
  const styles = items.map((item) => (item.style ? grouped(styleItems(item.style), here) : null))
  const shared = items.length > 1 && styles[0] !== null && styles.every((style) => style === styles[0])
  if (!shared) return items.map((item) => footerItem(item, here))
  const names = items.map((item) => item.kind)
  const which = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return [
    ...items.map((item) => footerItem({ ...item, style: undefined }, here)),
    `text in the ${which} placeholders: ${styles[0]}`,
  ]
}

// Whether a layout sets any text formatting, alignment, anchor or fill of
// its placeholders itself (otherwise all of it is the slide master's).
function setsFormatting(l: LayoutInfo) {
  const own = (from: FormatSource | undefined) => from === "layout"
  return (
    l.placeholders.some((ph) =>
      own(ph.textLayout?.align.from) || own(ph.textLayout?.anchor.from) || own(ph.fill?.from) ||
      (ph.style ? Object.values(ph.style).some((v) => own(v.from)) : false)) ||
    l.footerItems.some((item) => own(item.alignFrom) || (item.style ? Object.values(item.style).some((v) => own(v.from)) : false))
  )
}

// A master or layout placeholder: its box, then how text in it is aligned,
// anchored and filled (and, on the master, its level-1 text style).
function placeholderLine(ph: PlaceholderInfo, here: Here) {
  const head = `${ph.type}${ph.idx !== null ? ` idx ${ph.idx}` : ""} placeholder "${ph.name}" ${box(ph.box)}`
  const items: Item[] = []
  if (ph.textLayout) items.push(...layoutItems(ph.textLayout))
  if (ph.fill) items.push(fillItem(ph.fill))
  return items.length ? `${head}: ${grouped(items, here)}` : head
}

// One section of the description: PRESENTATION, SLIDE MASTER n, LAYOUT
// MASTERS, SLIDE n, ACTION BUTTONS, NOTES MASTER, HANDOUT MASTER, SUPPLIED
// IMAGES, MEDIA or WARNINGS. `text` starts with the title line.
export type PresentationSection = {
  key: string
  title: string
  text: string
}

/** The whole description. Its sections joined by a blank line. */
export function describePresentation(report: PresentationReport): string {
  return describePresentationSections(report).map((section) => section.text).join("\n\n")
}

/**
 * The description section by section, in the order describePresentation
 * writes them. Keys: "presentation", "master:<n>", "layouts", "slide:<n>",
 * "action-buttons" (only when there are any), "notes-master",
 * "handout-master", "supplied-images" (only when images were supplied),
 * "media", "warnings" (only when there are any).
 */
export function describePresentationSections(report: PresentationReport): PresentationSection[] {
  const sections: { key: string; title: string; lines: string[] }[] = []
  let out: string[] = []
  const start = (key: string, title: string) => {
    out = [title]
    sections.push({ key, title, lines: out })
  }
  const p = report.presentation
  const size = p.slideSize

  start("presentation", "PRESENTATION")
  out.push(`  Saved by: ${p.application ?? "unknown"}${p.appVersion ? ` ${p.appVersion}` : ""}`)
  out.push(`  Slides: ${p.slideCount}; hidden slides: ${p.hiddenSlides.length ? p.hiddenSlides.join(", ") : "none"}`)
  out.push(`  Slide size: ${n2(size.widthCm)} × ${n2(size.heightCm)} cm, ratio ${size.ratio} (${size.exactNamedRatio ? "" : "nearest "}${size.nearestNamedRatio})`)
  out.push(`  Slide show: ${p.show.mode}; loop until Esc: ${yesNo(p.show.loopUntilEsc)}; use timings: ${yesNo(p.show.useTimings)}`)
  out.push(`  Macros: ${p.hasMacros ? "YES (not run)" : "none"}`)

  for (const m of report.masters) {
    start(`master:${m.number}`, `SLIDE MASTER ${m.number}${m.name ? ` "${m.name}"` : ""}`)
    out.push(`  Background: ${background(m.background)}`)
    out.push(`  Title style: ${m.titleStyle.effective ? grouped(styleItems(m.titleStyle.effective), "master") : runStyle(m.titleStyle)}`)
    out.push(`  Body text style (level 1): ${m.bodyStyle.effective ? grouped(styleItems(m.bodyStyle.effective), "master") : runStyle(m.bodyStyle)}`)
    for (const pic of m.pictures) out.push(`  ${picture(pic)}`)
    for (const s of m.shapes) out.push(...shape(s, "master").map((line) => `  ${line}`))
    if (m.placeholders.some((ph) => ph.textLayout !== undefined)) {
      out.push("  Placeholders:")
      // Footer placeholders are given in full below.
      for (const ph of m.placeholders.filter((p) => !FOOTER_PLACEHOLDERS.has(p.type))) out.push(`    ${placeholderLine(ph, "master")}`)
    } else {
      out.push(`  Placeholders: ${m.placeholders.map((ph) => `${ph.type}${ph.idx !== null ? ` idx ${ph.idx}` : ""} "${ph.name}"`).join(", ") || "none"}`)
    }
    for (const line of footerBlock(m.footerItems, "master")) out.push(`  ${line}`)
    out.push(`  ${headerFooter(m.headerFooter)}`)
  }

  start("layouts", "LAYOUT MASTERS")
  for (const l of report.layouts) {
    const used = l.usedBySlides.length ? `used by slide${l.usedBySlides.length > 1 ? "s" : ""} ${l.usedBySlides.join(", ")}` : "not used"
    out.push(`  Layout "${l.name ?? l.part}" (type ${l.type ?? "custom"}; ${used})`)
    out.push(`    Placeholders on this layout: date ${l.showsDate ? "yes" : "NO"}; footer ${l.showsFooter ? "yes" : "NO"}; slide number ${l.showsSlideNumber ? "yes" : "NO"}; picture ${l.hasPicturePlaceholder ? "yes" : "no"}`)
    // The Header & Footer dialog's flags on a layout only decide whether new
    // slides get the placeholder; they do not remove it from the layout.
    const flaggedOff = l.headerFooter
      ? ([["date", l.showsDate && !l.headerFooter.date], ["footer", l.showsFooter && !l.headerFooter.footer], ["slide number", l.showsSlideNumber && !l.headerFooter.slideNumber]] as const).filter(([, off]) => off).map(([name]) => name)
      : []
    if (flaggedOff.length) {
      const many = flaggedOff.length > 1
      out.push(`    The ${flaggedOff.join(" and ")} placeholder${many ? "s are" : " is"} still on this layout although ${many ? "their header/footer flags are" : "its header/footer flag is"} off`)
    }
    if (l.placeholders.some((ph) => ph.textLayout !== undefined) && setsFormatting(l)) {
      // Footer placeholders are given in full below.
      for (const ph of l.placeholders.filter((p) => !FOOTER_PLACEHOLDERS.has(p.type))) out.push(`    ${placeholderLine(ph, "layout")}`)
      for (const line of footerBlock(l.footerItems, "layout")) out.push(`    ${line}`)
    } else if (l.placeholders.some((ph) => ph.textLayout !== undefined)) {
      // Nothing set on the layout: every value is the slide master's.
      out.push(`    Placeholders: ${l.placeholders.map((ph) => `${ph.type}${ph.idx !== null ? ` idx ${ph.idx}` : ""} "${ph.name}" ${box(ph.box)}`).join("; ") || "none"}`)
      for (const item of l.footerItems) out.push(`    ${footerItem({ ...item, style: undefined, alignFrom: undefined }, "layout")}`)
      out.push("    Text formatting, alignment, anchors and fills: all as the slide master's (nothing set on this layout)")
    } else {
      out.push(`    Placeholders: ${l.placeholders.map((ph) => `${ph.type}${ph.idx !== null ? ` idx ${ph.idx}` : ""} "${ph.name}" ${box(ph.box)}`).join("; ") || "none"}`)
      for (const item of l.footerItems) {
        if (item.text || item.typedDate) out.push(`    ${footerItem(item, "layout")}`)
      }
    }
    for (const pic of l.pictures) out.push(`    ${picture(pic)}`)
    for (const s of l.shapes) out.push(...shape(s, "layout").map((line) => `    ${line}`))
    if (l.background) out.push(`    Background override: ${background(l.background)}`)
    if (!l.showMasterShapes) out.push("    Hides the slide master's graphics")
    if (l.headerFooter) out.push(`    ${headerFooter(l.headerFooter)}`)
  }

  for (const s of report.slides) {
    start(`slide:${s.number}`, `SLIDE ${s.number} (layout: ${s.layoutName ?? "none"})${s.title ? ` ${quote(s.title)}` : " (no title)"}${s.hidden ? " — HIDDEN" : ""}`)
    if (s.titleStyle?.effective) {
      const t = s.titleStyle
      const items = [...(t.textLayout ? layoutItems(t.textLayout) : []), ...styleItems(t.effective!), ...(t.fill ? [fillItem(t.fill)] : [])]
      const mixed = t.overridesOnSlide.includes("runs formatted differently") ? " (its first run; the runs are formatted differently)" : ""
      out.push(`  Title formatting${mixed}: ${grouped(items, "slide")}`)
    } else if (s.titleStyle) {
      const overrides = s.titleStyle.overridesOnSlide.length ? `; set on this slide: ${s.titleStyle.overridesOnSlide.join(", ")}` : "; no formatting set on the slide"
      out.push(`  Title formatting: ${runStyle(s.titleStyle)}${overrides}`)
    }
    if (s.effectiveBackground) {
      out.push(`  Background: ${background(s.effectiveBackground.background)} (${s.effectiveBackground.source === "slide" ? "set on this slide" : `from the ${s.effectiveBackground.source}`})`)
    }
    for (const f of s.fullSlidePictures) {
      out.push(`  Full-slide picture "${f.name}" (${f.source === "slide" ? "on this slide" : `from the ${f.source}`}) covers ${f.coveragePercent}% of the slide, transparency ${f.transparencyPercent}%`)
    }
    out.push("  Shapes (footer placeholders are listed under footer items):")
    for (const sh of s.shapes) {
      if (sh.placeholder && FOOTER_PLACEHOLDERS.has(sh.placeholder.type)) continue
      out.push(...shape(sh, "slide").map((line) => `    ${line}`))
    }
    if (s.pictures.length) {
      out.push("  Pictures:")
      for (const pic of s.pictures) out.push(`    ${picture(pic)}`)
    }
    if (s.inheritedGraphics.length) out.push(`  From the master/layout: ${s.inheritedGraphics.join(", ")}`)
    out.push(`  Footer items on this slide: ${s.footerItems.length ? "" : "none (no date, footer or slide number shown)"}`)
    for (const line of footerBlock(s.footerItems, "slide")) out.push(`    ${line}`)
    // A full-slide picture behind everything is a background, not an overlap.
    const behindBackground = s.overlaps.filter((o) => o.fullSlidePicture !== null && o.inFront !== o.fullSlidePicture)
    const real = s.overlaps.filter((o) => !o.footerPlaceholders && !behindBackground.includes(o))
    const footerOnly = s.overlaps.filter((o) => o.footerPlaceholders)
    out.push(`  Overlaps: ${real.length ? "" : "none"}`)
    for (const o of real) {
      const covering = o.fullSlidePicture !== null ? ` — the full-slide picture ${o.fullSlidePicture} is IN FRONT, covering the other` : ""
      out.push(`    ${o.a} and ${o.b} overlap (${o.overlapPercentOfSmaller}% of the smaller; ${o.inFront} in front)${covering}`)
    }
    if (footerOnly.length) {
      out.push(`  Footer placeholder boxes touching (text aligned apart): ${footerOnly.map((o) => `${o.a}/${o.b} ${o.overlapPercentOfSmaller}%`).join("; ")}`)
    }
    const fullSlideNames = new Set(s.overlaps.map((o) => o.fullSlidePicture).filter((n): n is string => n !== null))
    for (const f of s.fullSlidePictures) fullSlideNames.add(f.source === "slide" ? `"${f.name}"` : `"${f.name}" (${f.source})`)
    for (const o of s.offSlide) {
      const note = fullSlideNames.has(o.name) ? " (a full-slide picture: only its edge is cut off)" : ""
      out.push(`  OFF THE SLIDE: ${o.name} past the ${o.edges.join(", ")}${note}`)
    }
    if (s.duplicateShapeIds.length) out.push(`  Duplicate shape ids on this slide: ${s.duplicateShapeIds.join(", ")}`)
    out.push(`  Transition: ${transition(s.transition)}`)
    if (s.animations.length === 0) {
      out.push("  Animations: none")
    } else {
      const groups = new Map<string, AnimationInfo[]>()
      for (const a of s.animations) {
        const key = a.sequence === "main" ? "main sequence" : `triggered by clicking "${a.trigger ?? "?"}"`
        groups.set(key, [...(groups.get(key) ?? []), a])
      }
      for (const [key, list] of groups) {
        out.push(`  Animations (${key}):`)
        for (const a of list) out.push(`    ${animation(a)}`)
      }
    }
    if (s.links.length === 0) out.push("  Links: none")
    else {
      out.push("  Links:")
      for (const l of s.links) out.push(`    ${link(l)}`)
    }
    for (const b of s.actionButtons) out.push(`  Action button ${b.geometry} "${b.name}" ${box(b.box)}${b.links.length ? "" : " — NO LINK"}`)
    out.push(`  Speaker notes: ${s.notes ? quote(s.notes) : "none"}`)
  }

  // Action buttons compared across slides.
  const buttons = report.slides.flatMap((s) => s.actionButtons)
  if (buttons.length) {
    start("action-buttons", "ACTION BUTTONS")
    const byKind = new Map<string, typeof buttons>()
    for (const b of buttons) byKind.set(b.geometry, [...(byKind.get(b.geometry) ?? []), b])
    for (const [geometry, list] of byKind) {
      const positions = new Set(list.map((b) => box(b.box)))
      const targets = new Set(list.map((b) => b.links.map((l) => l.description).join(", ") || "no link"))
      out.push(`  ${geometry} on slides ${list.map((b) => b.slide).join(", ")}: ${positions.size === 1 ? `same position on every slide (${[...positions][0]})` : `DIFFERENT positions: ${list.map((b) => `slide ${b.slide} ${box(b.box)}`).join("; ")}`}; ${targets.size === 1 ? `all link to ${[...targets][0]}` : `links differ: ${list.map((b) => `slide ${b.slide} → ${b.links.map((l) => l.description).join(", ") || "no link"}`).join("; ")}`}`)
    }
  }

  for (const nm of [report.notesMaster, report.handoutMaster]) {
    if (!nm) continue
    start(nm.kind === "notes master" ? "notes-master" : "handout-master", nm.kind.toUpperCase())
    for (const item of nm.placeholders) out.push(`  ${footerItem({ ...item, style: undefined, alignFrom: undefined }, "master")}`)
    out.push(`  ${headerFooter(nm.headerFooter)}`)
    if (nm.kind === "notes master") {
      for (const n of report.notesSlideFooters) {
        out.push(`  Notes page for slide ${n.slide}: ${n.items.map((i) => `${i.kind} ${i.text ? quote(i.text) : i.fields.length ? `field ${i.fields.map((f) => f.type).join(", ")}` : "empty"}`).join("; ")}`)
      }
    }
  }
  if (!report.notesMaster) {
    start("notes-master", "NOTES MASTER: none in the file")
  }
  if (!report.handoutMaster) {
    start("handout-master", "HANDOUT MASTER: none in the file")
  }

  if (report.suppliedImages) {
    start("supplied-images", `SUPPLIED IMAGES (each picture compared with the ${report.suppliedImages.length} images supplied)`)
    for (const image of report.suppliedImages) {
      out.push(`  ${image.name}: ${image.uses.length ? image.uses.map(imageUse).join("; ") : "not used"}`)
    }
    const unmatched = report.unmatchedPictures ?? []
    out.push(`  Pictures that are none of the supplied images: ${unmatched.length ? "" : "none"}`)
    for (const u of unmatched) {
      const px = u.pixelWidth && u.pixelHeight ? `, ${u.pixelWidth} × ${u.pixelHeight} px` : ""
      out.push(`    ${u.where} ${useKind(u)}${u.box ? `, ${n2(u.box.widthCm)} × ${n2(u.box.heightCm)} cm` : ""}${px}, media ${u.mediaPart ?? "missing"}: ${describeMatch(u.match)}`)
    }
  }

  start("media", "MEDIA")
  for (const m of report.media) {
    const px = m.pixelWidth && m.pixelHeight ? `${m.pixelWidth} × ${m.pixelHeight} px` : "size unknown"
    out.push(`  ${m.part}: ${m.format ?? "?"}, ${px}, ${m.bytes} bytes, sha256 ${m.sha256 ?? "not hashed"}; used by ${m.usedBy.length ? m.usedBy.join("; ") : "nothing"}`)
  }

  if (report.warnings.length) {
    start("warnings", "WARNINGS")
    for (const w of report.warnings) out.push(`  ${w}`)
  }
  return sections.map((section) => ({ key: section.key, title: section.title, text: section.lines.join("\n") }))
}

export { isPresentationSectionSelector } from "./section-selectors"

function selects(selector: string, key: string): boolean {
  if (selector === "master") return key.startsWith("master:")
  if (selector === "slides") return key.startsWith("slide:")
  if (selector === "notes") return key === "notes-master" || key === "handout-master"
  const slides = selector.match(/^slides:(\d+(?:,\d+)*)$/)
  if (slides) return slides[1].split(",").some((n) => key === `slide:${Number.parseInt(n, 10)}`)
  return selector === key
}

/**
 * The sections the selectors name, in description order (never repeated).
 * An unknown selector, or a slide the file does not have, selects nothing.
 */
export function filterPresentationSections(
  sections: PresentationSection[],
  selectors?: readonly string[] | null,
): PresentationSection[] {
  const chosen = selectors && selectors.length > 0 ? selectors : DEFAULT_PRESENTATION_SECTIONS
  return sections.filter((section) => chosen.some((selector) => selects(selector.trim(), section.key)))
}
