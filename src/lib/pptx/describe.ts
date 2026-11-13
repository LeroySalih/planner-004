// The inspector's report in plain English, for an AI marker or a teacher to
// read instead of XML. Facts only: it never says whether a mark is earned.

import { describeMatch } from "./known-images"
import type {
  AnimationInfo,
  BackgroundInfo,
  Box,
  Colour,
  FooterItem,
  HeaderFooterFlags,
  ImageUse,
  Link,
  PictureInfo,
  PresentationReport,
  ShapeInfo,
  TextRunStyle,
  TextSummary,
  TransitionInfo,
} from "./types"

const FOOTER_PLACEHOLDERS = new Set(["dt", "ftr", "sldNum", "hdr"])

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
  const sizes = t.sizesPt.length === 0
    ? "size not set"
    : t.sizesPt.length === 1 ? `${t.sizesPt[0]} pt` : `${t.sizesPt[0]}–${t.sizesPt[t.sizesPt.length - 1]} pt`
  const scaled = t.autofitScalePercent !== null ? ` (shrunk to ${t.autofitScalePercent}% to fit the box)` : ""
  const flag = (value: TextSummary["bold"], on: string) => (value === "yes" ? on : value === "no" ? `not ${on}` : `partly ${on}`)
  const colours = t.colours.length ? t.colours.map((c) => colour(c)).join(" / ") : "colour not set"
  return `text ${sizes}${scaled}, ${flag(t.bold, "bold")}, ${flag(t.italic, "italic")}, ${colours}`
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

function footerItem(item: FooterItem) {
  const content: string[] = []
  for (const f of item.fields) {
    content.push(
      f.type.startsWith("datetime")
        ? `date field ${f.type} (updates automatically; showing ${quote(f.text)})`
        : f.type === "slidenum" ? "slide number field" : `field ${f.type}`,
    )
  }
  if (item.fields.length === 0) content.push(item.text ? `typed text ${quote(item.text)}` : "empty")
  else if (item.text && item.fields.every((f) => f.text !== item.text)) content.push(`text ${quote(item.text)}`)
  const typed = item.typedDate
    ? " — a typed date, NOT a date field, so it does not update"
    : item.typedNumber ? " — a typed number, NOT the slide number field, so it is the same on every slide" : ""
  return `${item.kind} placeholder "${item.name}", aligned ${item.align ?? "left"}, ${box(item.box)}: ${content.join("; ")}${typed}`
}

function picture(p: PictureInfo) {
  const parts = [`picture "${p.name}"`]
  if (p.descr) parts.push(`(file name/alt text ${quote(p.descr)})`)
  parts.push(box(p.box) + (p.boxInherited ? " (from the placeholder)" : ""))
  if (p.placeholder) {
    parts.push(`in ${p.placeholder.type} placeholder${p.placeholder.idx !== null ? ` idx ${p.placeholder.idx}` : ""}${p.placeholderName ? ` "${p.placeholderName}"` : ""}`)
  } else {
    parts.push("not in a placeholder")
  }
  if (p.corner) parts.push(`sits ${p.corner}`)
  parts.push(`media ${p.mediaPart ?? p.linkedTarget ?? "missing"}`)
  if (p.pixelWidth && p.pixelHeight) parts.push(`${p.pixelWidth} × ${p.pixelHeight} px`)
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

function shape(s: ShapeInfo) {
  const ph = s.placeholder
    ? `${s.placeholder.type} placeholder${s.placeholder.idx !== null ? ` idx ${s.placeholder.idx}` : ""}`
    : "not a placeholder"
  const empty = s.box && (s.box.widthCm === 0 || s.box.heightCm === 0) ? " — ZERO-SIZE BOX" : ""
  const head = `${s.kind} "${s.name}" (${ph}${s.geometry && s.geometry !== "rect" ? `, ${s.geometry}` : ""}${s.inGroup ? `, in group "${s.inGroup}"` : ""}${s.hidden ? ", hidden" : ""}), ${box(s.box)}${s.boxInherited ? " (from the layout/master)" : ""}${empty}`
  const lines = [head]
  if (s.pictureFill) {
    const fill = s.pictureFill
    lines.push(`  filled with picture ${fill.mediaPart ?? "(missing)"}${fill.match ? `; image: ${describeMatch(fill.match)}` : ""}`)
  }
  if (s.textSummary) lines.push(`  ${textSummary(s.textSummary)}`)
  for (const p of s.paragraphs) {
    if (p.text.trim() === "") continue
    lines.push(`  paragraph ${p.index + 1} (level ${p.level}${p.bulleted ? `, bullet ${p.bulletChar}` : ", no bullet"}): ${quote(p.text)}`)
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

export function describePresentation(report: PresentationReport): string {
  const out: string[] = []
  const p = report.presentation
  const size = p.slideSize

  out.push("PRESENTATION")
  out.push(`  Saved by: ${p.application ?? "unknown"}${p.appVersion ? ` ${p.appVersion}` : ""}`)
  out.push(`  Slides: ${p.slideCount}; hidden slides: ${p.hiddenSlides.length ? p.hiddenSlides.join(", ") : "none"}`)
  out.push(`  Slide size: ${n2(size.widthCm)} × ${n2(size.heightCm)} cm, ratio ${size.ratio} (${size.exactNamedRatio ? "" : "nearest "}${size.nearestNamedRatio})`)
  out.push(`  Slide show: ${p.show.mode}; loop until Esc: ${yesNo(p.show.loopUntilEsc)}; use timings: ${yesNo(p.show.useTimings)}`)
  out.push(`  Macros: ${p.hasMacros ? "YES (not run)" : "none"}`)

  for (const m of report.masters) {
    out.push("")
    out.push(`SLIDE MASTER ${m.number}${m.name ? ` "${m.name}"` : ""}`)
    out.push(`  Background: ${background(m.background)}`)
    out.push(`  Title style: ${runStyle(m.titleStyle)}`)
    out.push(`  Body text style (level 1): ${runStyle(m.bodyStyle)}`)
    for (const pic of m.pictures) out.push(`  ${picture(pic)}`)
    for (const s of m.shapes) out.push(...shape(s).map((line) => `  ${line}`))
    out.push(`  Placeholders: ${m.placeholders.map((ph) => `${ph.type}${ph.idx !== null ? ` idx ${ph.idx}` : ""} "${ph.name}"`).join(", ") || "none"}`)
    for (const item of m.footerItems) out.push(`  ${footerItem(item)}`)
    out.push(`  ${headerFooter(m.headerFooter)}`)
  }

  out.push("")
  out.push("LAYOUT MASTERS")
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
    out.push(`    Placeholders: ${l.placeholders.map((ph) => `${ph.type}${ph.idx !== null ? ` idx ${ph.idx}` : ""} "${ph.name}" ${box(ph.box)}`).join("; ") || "none"}`)
    for (const item of l.footerItems) {
      if (item.text || item.typedDate) out.push(`    ${footerItem(item)}`)
    }
    for (const pic of l.pictures) out.push(`    ${picture(pic)}`)
    for (const s of l.shapes) out.push(...shape(s).map((line) => `    ${line}`))
    if (l.background) out.push(`    Background override: ${background(l.background)}`)
    if (!l.showMasterShapes) out.push("    Hides the slide master's graphics")
    if (l.headerFooter) out.push(`    ${headerFooter(l.headerFooter)}`)
  }

  for (const s of report.slides) {
    out.push("")
    out.push(`SLIDE ${s.number} (layout: ${s.layoutName ?? "none"})${s.title ? ` ${quote(s.title)}` : " (no title)"}${s.hidden ? " — HIDDEN" : ""}`)
    if (s.titleStyle) {
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
      out.push(...shape(sh).map((line) => `    ${line}`))
    }
    if (s.pictures.length) {
      out.push("  Pictures:")
      for (const pic of s.pictures) out.push(`    ${picture(pic)}`)
    }
    if (s.inheritedGraphics.length) out.push(`  From the master/layout: ${s.inheritedGraphics.join(", ")}`)
    out.push(`  Footer items on this slide: ${s.footerItems.length ? "" : "none (no date, footer or slide number shown)"}`)
    for (const item of s.footerItems) out.push(`    ${footerItem(item)}`)
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
    out.push("")
    out.push("ACTION BUTTONS")
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
    out.push("")
    out.push(nm.kind.toUpperCase())
    for (const item of nm.placeholders) out.push(`  ${footerItem(item)}`)
    out.push(`  ${headerFooter(nm.headerFooter)}`)
    if (nm.kind === "notes master") {
      for (const n of report.notesSlideFooters) {
        out.push(`  Notes page for slide ${n.slide}: ${n.items.map((i) => `${i.kind} ${i.text ? quote(i.text) : i.fields.length ? `field ${i.fields.map((f) => f.type).join(", ")}` : "empty"}`).join("; ")}`)
      }
    }
  }
  if (!report.notesMaster) {
    out.push("")
    out.push("NOTES MASTER: none in the file")
  }
  if (!report.handoutMaster) {
    out.push("")
    out.push("HANDOUT MASTER: none in the file")
  }

  if (report.suppliedImages) {
    out.push("")
    out.push(`SUPPLIED IMAGES (each picture compared with the ${report.suppliedImages.length} images supplied)`)
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

  out.push("")
  out.push("MEDIA")
  for (const m of report.media) {
    const px = m.pixelWidth && m.pixelHeight ? `${m.pixelWidth} × ${m.pixelHeight} px` : "size unknown"
    out.push(`  ${m.part}: ${m.format ?? "?"}, ${px}, ${m.bytes} bytes, sha256 ${m.sha256 ?? "not hashed"}; used by ${m.usedBy.length ? m.usedBy.join("; ") : "nothing"}`)
  }

  if (report.warnings.length) {
    out.push("")
    out.push("WARNINGS")
    for (const w of report.warnings) out.push(`  ${w}`)
  }
  return out.join("\n")
}
