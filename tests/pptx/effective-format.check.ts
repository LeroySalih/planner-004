import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describePresentation, describePresentationSections } from '@/lib/pptx/describe'
import { inspectPptx } from '@/lib/pptx/inspect'
import type { PresentationReport } from '@/lib/pptx/types'

// Effective formatting (powerpoint-reader-2): each value the reader reports
// resolved through slide → layout → master → master text styles →
// presentation defaults → theme → PowerPoint's default, with its source, on
// the presentations tests/fixtures/pptx/generate-reader-fixtures.py makes.
// No database, no network, no model.
//   npx tsx tests/pptx/effective-format.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const DIR = path.join(__dirname, '..', 'fixtures', 'pptx', 'reader-2')
const UNKNOWN = 'UNKNOWN (reader could not resolve)'

async function load(name: string): Promise<{ report: PresentationReport; text: string; slide: (n: number) => string }> {
  const report = await inspectPptx(await readFile(path.join(DIR, name)))
  const sections = describePresentationSections(report)
  return {
    report,
    text: describePresentation(report),
    slide: (n) => sections.find((s) => s.key === `slide:${n}`)?.text ?? '',
  }
}

const line = (text: string, start: string) => text.split('\n').map((l) => l.trim()).find((l) => l.startsWith(start)) ?? ''

async function main() {
  // --- Title alignment and anchor --------------------------------------------
  {
    const { report, text, slide } = await load('title-master-only.pptx')
    const masterTitle = report.masters[0].placeholders.find((p) => p.type === 'title')
    check('master title: centre, set on the master', masterTitle?.textLayout?.align.value === 'centre' && masterTitle.textLayout.align.from === 'master', JSON.stringify(masterTitle?.textLayout))
    check('master title: anchored middle, set on the master', masterTitle?.textLayout?.anchor.value === 'middle' && masterTitle.textLayout.anchor.from === 'master')
    const titleOnly = report.layouts.find((l) => l.name === 'Title Only')!.placeholders.find((p) => p.type === 'title')
    check('layout title: centre/middle from the master', titleOnly?.textLayout?.align.from === 'master' && titleOnly.textLayout.anchor.value === 'middle' && titleOnly.textLayout.anchor.from === 'master', JSON.stringify(titleOnly?.textLayout))
    for (const n of [1, 2]) {
      const t = report.slides[n - 1].titleStyle
      check(`slide ${n} title: centre and middle, from the master`,
        t?.textLayout?.align.value === 'centre' && t.textLayout.align.from === 'master' && t.textLayout.anchor.value === 'middle' && t.textLayout.anchor.from === 'master',
        JSON.stringify(t?.textLayout))
      check(`slide ${n} text: the title line states both with the source`,
        /Title formatting: text aligned centre, anchored middle, .*\[from master\]/.test(slide(n)), line(slide(n), 'Title formatting'))
    }
    check('text: the master placeholder line', text.includes('title placeholder "Title Placeholder 1" at (1.27, 0.76) cm, 22.86 × 3.18 cm: text aligned centre, anchored middle [set on this master]'))
    check('text: a layout that sets nothing says all is the master\'s', /Layout "Title Only"[^\n]*\n(?:    [^\n]*\n)*?    Text formatting, alignment, anchors and fills: all as the slide master's \(nothing set on this layout\)/.test(text))
  }
  {
    const { report, slide } = await load('title-default.pptx')
    const t = report.slides[0].titleStyle
    check('nothing set: title left, from the default', t?.textLayout?.align.value === 'left' && t.textLayout.align.from === 'default', JSON.stringify(t?.textLayout))
    check('nothing set: title anchored top, from the default', t?.textLayout?.anchor.value === 'top' && t.textLayout.anchor.from === 'default')
    check('nothing set: the text says [default]', /text aligned left, anchored top, .*\[default\]/.test(line(slide(1), 'Title formatting')), line(slide(1), 'Title formatting'))
    const master = report.masters[0].placeholders.find((p) => p.type === 'title')
    check('nothing set: master title left/top, default', master?.textLayout?.align.from === 'default' && master.textLayout.anchor.from === 'default')
  }
  {
    const { report, slide } = await load('title-slide-override.pptx')
    const [one, two] = report.slides.map((s) => s.titleStyle?.textLayout)
    check('override: slide 1 inherits centre/middle', one?.align.value === 'centre' && one.anchor.value === 'middle' && one.align.from === 'master')
    check('override: slide 2 right/bottom set on the slide', two?.align.value === 'right' && two.align.from === 'slide' && two.anchor.value === 'bottom' && two.anchor.from === 'slide', JSON.stringify(two))
    check('override: slide 2 text', line(slide(2), 'Title formatting').startsWith('Title formatting: text aligned right, anchored bottom [set on this slide]'), line(slide(2), 'Title formatting'))
  }
  {
    // Set in the master title placeholder's own list style, not txStyles.
    const { report, slide } = await load('title-master-lststyle.pptx')
    const m = report.masters[0]
    check('master lstStyle: master title style 40 pt bold, set on the master',
      m.titleStyle.effective?.sizePt.value === 40 && m.titleStyle.effective.sizePt.from === 'master' && m.titleStyle.effective.bold.value === true, JSON.stringify(m.titleStyle.effective))
    const t = report.slides[0].titleStyle
    check('master lstStyle: the slide title is centre, 40 pt, bold, from the master',
      t?.textLayout?.align.value === 'centre' && t.textLayout.align.from === 'master' && t.sizePt === 40 && t.bold && t.effective?.bold.from === 'master',
      JSON.stringify({ layout: t?.textLayout, size: t?.sizePt, bold: t?.effective?.bold }))
    check('master lstStyle: text', /text aligned centre, 40 pt, .*bold \[from master\]/.test(line(slide(1), 'Title formatting')), line(slide(1), 'Title formatting'))
  }

  // --- Footer, date and slide number text ------------------------------------
  {
    const { report, text, slide } = await load('footer-master-20.pptx')
    const masterItems = report.masters[0].footerItems
    check('master footers: 20 pt set on the master', masterItems.length === 3 && masterItems.every((i) => i.style?.sizePt.value === 20 && i.style.sizePt.from === 'master'), JSON.stringify(masterItems.map((i) => i.style?.sizePt)))
    const layout = report.layouts.find((l) => l.name === 'Title Only')!
    check('layout footers: 20 pt from the master', layout.footerItems.every((i) => i.style?.sizePt.value === 20 && i.style.sizePt.from === 'master'))
    check('layout footers are printed even when empty', /Layout "Title Only"[\s\S]*?footer placeholder "Footer Placeholder 3", aligned centre, /.test(text))
    // The template's Section Header layout sets its title's anchor and alignment itself.
    check('a layout that sets its own: its lines say [set on this layout]', /Layout "Section Header"[\s\S]*?title placeholder "Title 1" [^\n]*: text aligned left, anchored top \[set on this layout\]/.test(text))
    for (const n of [1, 2]) {
      const items = report.slides[n - 1].footerItems
      check(`slide ${n} date and footer: 20 pt from the master`,
        ['date', 'footer'].every((k) => { const i = items.find((x) => x.kind === k); return i?.style?.sizePt.value === 20 && i.style.sizePt.from === 'master' }),
        JSON.stringify(items.map((i) => [i.kind, i.style?.sizePt])))
      const f = items.find((i) => i.kind === 'footer')!
      check(`slide ${n} footer font, colour and flags resolved`,
        f.style?.font.value === 'Calibri' && f.style.font.themeFont === 'body' && f.style.colour.value !== null && f.style.bold.value === false && f.style.bold.from === 'default')
      check(`slide ${n} text: one style line for the three`,
        slide(n).includes('text in the date, footer and slide number placeholders: 20 pt, font "Calibri" (theme body font), #404040 (dark grey) [from master]; not bold, not italic, not underlined [default]'),
        line(slide(n), 'text in the'))
    }
  }
  {
    const { report, slide } = await load('footer-slide-20.pptx')
    const one = report.slides[0].footerItems
    const two = report.slides[1].footerItems
    check('slide 1 footers: the master\'s 12 pt', one.every((i) => i.style?.sizePt.value === 12 && i.style.sizePt.from === 'master'))
    check('slide 2 date and footer: 20 pt set on the slide',
      ['date', 'footer'].every((k) => { const i = two.find((x) => x.kind === k); return i?.style?.sizePt.value === 20 && i.style.sizePt.from === 'slide' }))
    check('slide 2 slide number: still 12 pt from the master', two.find((i) => i.kind === 'slide number')?.style?.sizePt.value === 12)
    check('slide 2 text: 20 pt [set on this slide]', /footer placeholder "Footer Placeholder 3".*typed text "info@example.org"; text 20 pt \[set on this slide\]; font "Calibri" \(theme body font\), #404040 \(dark grey\) \[from master\]/.test(slide(2)), line(slide(2), 'footer placeholder'))
  }

  // --- Date field format and language ----------------------------------------
  {
    const { report, slide } = await load('date-field.pptx')
    const date = report.slides[0].footerItems.find((i) => i.kind === 'date')
    const field = date?.fields[0]
    check('date field: datetime4 in en-GB', field?.type === 'datetime4' && field.lang === 'en-GB', JSON.stringify(field))
    check('date field text: type, format, language and what it shows',
      slide(1).includes('date field datetime4 (format Month DD, YYYY style in the field\'s language, language en-GB, updates automatically; showing "14 November 2026")'),
      line(slide(1), 'date placeholder'))
  }

  // --- Fills ------------------------------------------------------------------
  {
    const { report, slide } = await load('shape-fills.pptx')
    const shape = (name: string) => report.slides[0].shapes.find((s) => s.name === name)!
    const yellow = shape('Yellow note')
    check('text box: solid #FFF2CC pale yellow, set on the slide', yellow.fill?.kind === 'solid' && yellow.fill.colour?.hex === 'FFF2CC' && yellow.fill.colour.name === 'pale yellow' && yellow.fill.from === 'slide', JSON.stringify(yellow.fill))
    check('text box: centre/middle set on the slide', yellow.textLayout?.align.value === 'centre' && yellow.textLayout.align.from === 'slide' && yellow.textLayout.anchor.value === 'middle')
    check('text box text', slide(1).includes('text aligned centre, anchored middle, fill solid #FFF2CC (pale yellow) [set on this slide]'), line(slide(1), 'text aligned centre'))
    const plain = shape('Plain note')
    check('text box without fill: no fill', plain.fill?.kind === 'none', JSON.stringify(plain.fill))
    check('text box: anchored top by default', plain.textLayout?.anchor.value === 'top' && plain.textLayout.anchor.from === 'default')
    const styled = shape('Theme rectangle')
    check('autoshape: its style\'s theme fill', styled.fill?.viaStyle === true && styled.fill.kind !== 'none' && !styled.fill.unresolved, JSON.stringify(styled.fill))
    check('autoshape text: [from the shape\'s style]', /"Theme rectangle"[\s\S]*?fill \w+ .*\[from the shape's style\]/.test(slide(1)))
    const half = shape('Half see-through')
    check('transparency 50%', half.fill?.kind === 'solid' && half.fill.transparencyPercent === 50 && half.fill.colour?.hex === '00B050', JSON.stringify(half.fill))
    check('noFill', shape('Outline only').fill?.kind === 'none' && shape('Outline only').fill?.from === 'slide')
    check('gradient', shape('Gradient box').fill?.kind === 'gradient' && (shape('Gradient box').fill?.stops?.length ?? 0) >= 2)
    check('shapes say where they sit', yellow.corner === 'top left' && /"Yellow note".*sits top left/.test(slide(1)))
    check('text box fonts are printed', /"Yellow note"[\s\S]*?text 18 pt, .*font "Calibri"/.test(slide(1)))
  }
  {
    const { report, text, slide } = await load('title-fill-master.pptx')
    const master = report.masters[0].placeholders.find((p) => p.type === 'title')
    check('master title fill: #7030A0 set on the master', master?.fill?.kind === 'solid' && master.fill.colour?.hex === '7030A0' && master.fill.from === 'master', JSON.stringify(master?.fill))
    check('every layout title: the fill from the master', report.layouts.every((l) => l.placeholders.filter((p) => p.type === 'title').every((p) => p.fill?.colour?.hex === '7030A0' && p.fill.from === 'master')))
    check('slides: the title fill from the master', report.slides.every((s) => s.titleStyle?.fill?.colour?.hex === '7030A0' && s.titleStyle.fill.from === 'master'))
    check('text: the slide title line', /fill solid #7030A0 \(purple\) \[from master\]/.test(line(slide(1), 'Title formatting')), line(slide(1), 'Title formatting'))
    check('text: the master placeholder line', /title placeholder "Title Placeholder 1" .*fill solid #7030A0 \(purple\) \[set on this master\]/.test(text))
  }

  // --- A value the reader cannot resolve ---------------------------------------
  {
    const { report, slide } = await load('unknown-colour.pptx')
    const box = report.slides[0].shapes.find((s) => s.name === 'Accent six box')!
    check('unresolvable fill: unresolved, no colour', box.fill?.kind === 'solid' && box.fill.colour === null && box.fill.unresolved, JSON.stringify(box.fill))
    check('unresolvable text colour: none', box.textSummary?.colours.length === 0 && box.textSummary.unknown?.includes('colour') === true, JSON.stringify(box.textSummary))
    check('text: fill UNKNOWN', slide(1).includes(`fill solid ${UNKNOWN} [set on this slide]`), slide(1))
    check('text: colour UNKNOWN', slide(1).includes(`colour ${UNKNOWN}`))
  }

  // --- A report from the previous reader version --------------------------------
  {
    const { report } = await load('title-master-only.pptx')
    const old = JSON.parse(JSON.stringify(report), (key, value) =>
      ['effective', 'textLayout', 'fill', 'style', 'alignFrom', 'lang', 'slidePx', 'corner', 'underline', 'unknown'].includes(key) ? undefined : value)
    let ok = true
    let text = ''
    try {
      text = describePresentation(old as PresentationReport)
    } catch (error) {
      ok = false
      text = String(error)
    }
    check('a powerpoint-reader-1 report still describes, without UNKNOWN', ok && !text.includes('UNKNOWN') && text.includes('Title formatting:'), text.slice(0, 200))
  }

  console.log(failed === 0 ? 'All checks passed' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
