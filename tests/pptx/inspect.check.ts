import { readFile } from 'node:fs/promises'
import path from 'node:path'

import JSZip from 'jszip'
import sharp from 'sharp'

import { describePresentation } from '@/lib/pptx/describe'
import { PptxInspectError, inspectPptx } from '@/lib/pptx/inspect'
import { MATCH_THRESHOLD_PERCENT, compareFingerprints, knownImagesFromFiles } from '@/lib/pptx/known-images'
import type { PresentationReport } from '@/lib/pptx/types'

// The PowerPoint inspector on the teacher's model answer for the 6.2
// Presentation Assessment (Pearl Coast Aquarium kiosk), then on copies of
// it changed in memory so that each one should be reported differently.
// No database, no network, no model.
//   npx tsx tests/pptx/inspect.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refused(run: () => Promise<unknown>, pattern: RegExp): Promise<[boolean, string]> {
  try {
    await run()
    return [false, 'not refused']
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [error instanceof PptxInspectError && pattern.test(message), message]
  }
}

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'pptx', 'pearl-kiosk-model-answer.pptx')
// The IMAGES folder the pupils were given (teacher materials).
const IMAGES = path.join(__dirname, '..', 'fixtures', 'pptx', 'pearl-images')
const IMAGE_FILES = ['BACKGROUND.png', 'CAMEL.jpg', 'CORAL.jpg', 'JELLYFISH.jpg', 'LOGO.png', 'MAP.png', 'SHARK.jpg', 'TURTLE.jpg']

// A copy of the fixture with one part's XML changed.
async function mutated(original: Buffer, part: string, edit: (xml: string) => string) {
  const zip = await JSZip.loadAsync(original)
  const before = await zip.file(part)!.async('string')
  const after = edit(before)
  if (after === before) throw new Error(`mutation of ${part} changed nothing`)
  zip.file(part, after)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// A copy of the fixture with some media files' bytes replaced.
async function withMedia(original: Buffer, media: Record<string, Buffer>) {
  const zip = await JSZip.loadAsync(original)
  for (const [part, bytes] of Object.entries(media)) {
    if (!zip.file(part)) throw new Error(`no ${part} in the fixture`)
    zip.file(part, bytes)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// An image unlike any supplied one: seeded random circles and stripes.
async function unrelatedImage() {
  let seed = 20261114
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const shapes: string[] = []
  for (let i = 0; i < 40; i += 1) {
    const colour = `rgb(${Math.floor(rand() * 255)},${Math.floor(rand() * 255)},${Math.floor(rand() * 255)})`
    shapes.push(rand() < 0.5
      ? `<circle cx="${rand() * 1200}" cy="${rand() * 900}" r="${20 + rand() * 120}" fill="${colour}"/>`
      : `<rect x="${rand() * 1200}" y="0" width="${10 + rand() * 60}" height="900" fill="${colour}"/>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#f4e9d0"/>${shapes.join('')}</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer()
}

function slide(report: PresentationReport, n: number) {
  return report.slides.find((s) => s.number === n)!
}

function sameBox(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function main() {
  const original = await readFile(FIXTURE)
  const report = await inspectPptx(original)
  const text = describePresentation(report)

  // ---- Task 1: master slide
  const size = report.presentation.slideSize
  check('slide size is 16:10 (by cx/cy, not the type label)', size.ratio === '8:5' && size.nearestNamedRatio === '16:10' && size.exactNamedRatio, JSON.stringify(size))
  check('slide size type label is recorded as written (screen4x3)', size.typeLabel === 'screen4x3')

  const master = report.masters[0]
  check('one slide master', report.masters.length === 1)
  check('master background is a picture at 60% transparency', master.background.kind === 'picture' && master.background.transparencyPercent === 60, JSON.stringify(master.background))
  check('master background picture is hashed', /^[0-9a-f]{64}$/.test(master.background.sha256 ?? ''))
  check('master title style is bold and italic', master.titleStyle.bold && master.titleStyle.italic, JSON.stringify(master.titleStyle))
  check('master title colour is dark blue #073F5C', master.titleStyle.colour?.hex === '073F5C' && master.titleStyle.colour?.name === 'dark blue', JSON.stringify(master.titleStyle.colour))

  const logo = master.pictures.find((p) => p.name === 'Logo')
  check('logo picture is on the master', !!logo)
  check('logo sits top right', logo?.corner === 'top right', String(logo?.corner))
  check('logo is not stretched', logo?.stretched === false)

  // Where the footer text lives in this file: typed into each slide's footer
  // placeholder; the master's and layouts' footer placeholders are empty.
  const FOOTER = 'Pearl Coast Aquarium – Visitor Information'
  const masterFooter = master.footerItems.find((f) => f.kind === 'footer')
  check('master footer placeholder is centred and empty', masterFooter?.align === 'centre' && masterFooter.text === '', JSON.stringify(masterFooter))
  for (const n of [2, 3, 4, 5, 6]) {
    const footer = slide(report, n).footerItems.find((f) => f.kind === 'footer')
    check(`slide ${n} footer text is "${FOOTER}", centred`, footer?.text === FOOTER && footer.align === 'centre', JSON.stringify(footer))
  }
  const masterDate = master.footerItems.find((f) => f.kind === 'date')
  check('master date is an automatic date field', !!masterDate?.fields.some((f) => f.updatesAutomatically) && !masterDate.typedDate)
  for (const n of [2, 4, 5]) {
    const date = slide(report, n).footerItems.find((f) => f.kind === 'date')
    check(`slide ${n} shows an automatic date field`, !!date && date.fields.some((f) => f.type === 'datetime1' && f.updatesAutomatically) && !date.typedDate, JSON.stringify(date))
  }
  const masterNumber = master.footerItems.find((f) => f.kind === 'slide number')
  check('slide-number placeholder is right-aligned on the master', masterNumber?.align === 'right', JSON.stringify(masterNumber))
  for (const n of [2, 3, 4, 5, 6]) {
    const num = slide(report, n).footerItems.find((f) => f.kind === 'slide number')
    check(`slide ${n} shows a right-aligned slide number field`, num?.align === 'right' && num.fields.some((f) => f.type === 'slidenum'))
  }
  check('slide 1 shows no footer, date or slide number', slide(report, 1).footerItems.length === 0)

  const twoContent = report.layouts.find((l) => l.name === 'Two Content')!
  check('Two Content layout has no date placeholder', !!twoContent && !twoContent.showsDate && twoContent.showsFooter && twoContent.showsSlideNumber)
  check('slides 3 and 6 (Two Content) show no date', [3, 6].every((n) => !slide(report, n).footerItems.some((f) => f.kind === 'date')))
  const titleOnly = report.layouts.find((l) => l.name === 'Title Only')!
  check('Title Only layout has a picture placeholder', !!titleOnly && titleOnly.hasPicturePlaceholder)
  const coral = slide(report, 2).pictures[0]
  check(
    "slide 2's picture sits in the Title Only picture placeholder",
    coral?.placeholder?.type === 'pic' && coral.placeholder.idx === 13 && coral.placeholderName === 'Picture Placeholder' && coral.boxInherited,
    JSON.stringify(coral?.placeholder),
  )

  // ---- Task 2: slides
  const layoutsWanted = ['Title Slide', 'Title Only', 'Two Content', 'Title and Content', 'Title and Content', 'Two Content']
  check('six slides', report.slides.length === 6)
  check('slide layouts follow the assessment table', report.slides.map((s) => s.layoutName).join('|') === layoutsWanted.join('|'), report.slides.map((s) => s.layoutName).join('|'))
  check('slide titles', report.slides.map((s) => s.title).join('|') === 'Welcome to Pearl Coast Aquarium|Menu|Our Exhibits|Opening Times and Tickets|Getting Here|Contact Us')
  check('every slide title is bold, italic, dark blue with nothing set on the slide', report.slides.every((s) => s.titleStyle?.bold && s.titleStyle.italic && s.titleStyle.colour?.hex === '073F5C' && s.titleStyle.overridesOnSlide.length === 0))
  for (const [n, file] of [[3, 'TURTLE.jpg'], [6, 'JELLYFISH.jpg']] as const) {
    const pic = slide(report, n).pictures.find((p) => p.descr === file)
    check(`${file} on slide ${n} is 10.00 × 7.50 cm`, pic?.box?.widthCm === 10 && pic.box.heightCm === 7.5, JSON.stringify(pic?.box))
    check(`${file} on slide ${n} is not stretched`, pic?.stretched === false && pic.pixelWidth === 1200 && pic.pixelHeight === 900)
  }
  check('slide 5 shows the MAP picture', slide(report, 5).pictures.some((p) => p.descr === 'MAP.png'))
  check('no picture anywhere is stretched', report.slides.every((s) => s.pictures.every((p) => p.stretched === false)))
  check('slide 3 exhibit names are bullet points', slide(report, 3).shapes.find((s) => s.name === 'Content Placeholder 2')?.paragraphs.every((p) => p.bulleted) === true)

  // ---- Task 3: animations and transitions
  const t1 = slide(report, 1).transition
  check('slide 1 transition: advance on click off', t1?.advanceOnClick === false, JSON.stringify(t1))
  check('slide 1 transition: advance after 5.0 s', t1?.advanceAfterSeconds === 5)
  check('slide 1 transition is Fade, medium', t1?.effect === 'Fade' && t1.speed === 'med')
  check('slides 2–6 have no transition', [2, 3, 4, 5, 6].every((n) => slide(report, n).transition === null))

  const anims = slide(report, 3).animations
  check('slide 3 has exactly three animations', anims.length === 3, String(anims.length))
  check('all three are entrance effects', anims.every((a) => a.class === 'entrance'))
  check('all three are the same effect (Fade)', anims.every((a) => a.presetId === anims[0].presetId && a.effectName === 'Fade'))
  check('each starts After Previous', anims.every((a) => a.start === 'After Previous'))
  check('each lasts 2.0 s with no delay', anims.every((a) => a.durationSeconds === 2 && a.delaySeconds === 0), JSON.stringify(anims.map((a) => [a.durationSeconds, a.delaySeconds])))
  check(
    'they target only the exhibit-name paragraphs',
    anims.map((a) => `${a.target?.shapeName}#${a.target?.paragraphStart}-${a.target?.paragraphEnd}:${a.target?.paragraphText}`).join('|') ===
      'Content Placeholder 2#1-1:Turtle Cove|Content Placeholder 2#2-2:Shark Tunnel|Content Placeholder 2#3-3:Jellyfish Gallery',
  )
  check('no other slide is animated', report.slides.filter((s) => s.number !== 3).every((s) => s.animations.length === 0))

  // ---- Task 4: links and action buttons
  const menuLinks = slide(report, 2).links
  check('slide 2 menu items link to slides 3, 4, 5, 6', menuLinks.map((l) => `${l.kind}:${l.targetSlide?.number}`).join(',') === 'slide:3,slide:4,slide:5,slide:6', JSON.stringify(menuLinks.map((l) => l.description)))
  check('the "Our Exhibits" item links to slide 3', menuLinks[0]?.shapeName === 'Rounded Rectangle 3' && menuLinks[0].targetSlide?.title === 'Our Exhibits')
  const buttons = [3, 4, 5, 6].map((n) => slide(report, n).actionButtons)
  check('one Home action button on each of slides 3–6', buttons.every((b) => b.length === 1 && b[0].geometry === 'actionButtonHome'))
  check('every Home button links to slide 2 "Menu"', buttons.every((b) => b[0]?.links.length === 1 && b[0].links[0].targetSlide?.number === 2 && b[0].links[0].targetSlide.title === 'Menu'))
  check('Home buttons are in the identical position', buttons.every((b) => sameBox(b[0]?.box, buttons[0][0]?.box)), JSON.stringify(buttons.map((b) => b[0]?.box)))
  check('no action buttons on slides 1 and 2', slide(report, 1).actionButtons.length === 0 && slide(report, 2).actionButtons.length === 0)
  const s6 = slide(report, 6).links
  check('slide 6 links to the website', s6.some((l) => l.kind === 'web' && l.target === 'http://www.pearlcoast.service'))
  check('slide 6 links to the email address', s6.some((l) => l.kind === 'email' && l.target === 'mailto:visit@pearlcoast.service'))
  const fileLink = slide(report, 4).links.find((l) => l.on === 'text')
  check('slide 4 "See all ticket prices" links to the TICKET PRICES file', fileLink?.kind === 'file' && fileLink.text === 'See all ticket prices' && fileLink.target === 'TICKET PRICES.xlsx', JSON.stringify(fileLink))

  // ---- Task 5: notes
  check('slide 4 has speaker notes', (slide(report, 4).notes ?? '').startsWith('Remind visitors that the aquarium opens late on Fridays.'))
  check('no other slide has notes', report.slides.filter((s) => s.number !== 4).every((s) => s.notes === null))
  const notesFooter = report.notesMaster?.placeholders.find((p) => p.kind === 'footer')
  check('notes master footer holds the name/class text', notesFooter?.text === 'Model Answer – 10X', JSON.stringify(notesFooter))

  // ---- Other facts
  check('no macros', report.presentation.hasMacros === false)
  check('six media files, all hashed and sized', report.media.length === 6 && report.media.every((m) => m.sha256 && m.pixelWidth && m.usedBy.length === 1))
  check('slide 5 MAP and Home button overlap is reported', slide(report, 5).overlaps.some((o) => !o.footerPlaceholders && [o.a, o.b].includes('"Picture 2"') && [o.a, o.b].includes('"Action Button: Home 3"')))
  check('text report has the slide 1 transition line', text.includes('Transition: Fade (') || text.includes('Transition: Fade;'))
  check('text report states duration and delay apart', text.includes('After Previous, duration 2.0 s, delay 0.0 s'))

  // ---- Mutations
  const slide1 = 'ppt/slides/slide1.xml'
  const slide2 = 'ppt/slides/slide2.xml'
  const slide3 = 'ppt/slides/slide3.xml'

  let m = await inspectPptx(await mutated(original, slide1, (x) => x.replace('advClick="0"', 'advClick="1"')))
  check('mutation: advance on mouse click turned on is reported', slide(m, 1).transition?.advanceOnClick === true)

  m = await inspectPptx(await mutated(original, slide3, (x) => x
    .replace('<p:cTn id="9" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/>', '<p:cTn id="9" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="2000"/>')
    .replace('<p:cTn id="11" dur="2000"/>', '<p:cTn id="11" dur="500"/>')))
  const second = slide(m, 3).animations[1]
  check('mutation: a 2 s delay with 0.5 s duration is reported as such', second?.delaySeconds === 2 && second.durationSeconds === 0.5, JSON.stringify(second))
  check('mutation: the other animations still last 2.0 s', slide(m, 3).animations[0].durationSeconds === 2 && slide(m, 3).animations[2].durationSeconds === 2)

  m = await inspectPptx(await mutated(original, slide3, (x) => x.replace('<p:cTn id="13" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="afterEffect">', '<p:cTn id="13" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">')))
  check('mutation: an On Click animation is reported', slide(m, 3).animations[2]?.start === 'On Click' && slide(m, 3).animations[0].start === 'After Previous')

  const DATE_PH = '<p:sp><p:nvSpPr><p:cNvPr id="5" name="Date Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt" sz="half" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{5BCAD085-E8A6-8845-BD4E-CB4CCA059FC4}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>1/27/13</a:t></a:fld></a:p></p:txBody></p:sp>'
  m = await inspectPptx(await mutated(original, 'ppt/slideLayouts/slideLayout4.xml', (x) => x.replace('<p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer Placeholder 5"/>', `${DATE_PH}<p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer Placeholder 5"/>`)))
  check('mutation: date placeholder put back on the Two Content layout is reported', m.layouts.find((l) => l.name === 'Two Content')?.showsDate === true)

  m = await inspectPptx(await mutated(original, slide2, (x) => x.replace(
    '<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="datetime1"><a:rPr lang="en-GB"/><a:t>10/10/2026</a:t></a:fld>',
    '<a:r><a:rPr lang="en-GB"/><a:t>10/10/2026</a:t></a:r>',
  )))
  const typed = slide(m, 2).footerItems.find((f) => f.kind === 'date')
  check('mutation: a typed date instead of a date field is reported', typed?.typedDate === true && typed.fields.length === 0 && typed.text === '10/10/2026', JSON.stringify(typed))
  check('mutation: the typed date is called out in the text report', describePresentation(m).includes('a typed date, NOT a date field'))

  m = await inspectPptx(await mutated(original, slide3, (x) => x.replace('<a:off x="4648200" y="1333500"/><a:ext cx="3600000" cy="2700000"/>', '<a:off x="4648200" y="1333500"/><a:ext cx="4320000" cy="2700000"/>')))
  const turtle = slide(m, 3).pictures.find((p) => p.descr === 'TURTLE.jpg')
  check('mutation: a stretched picture is reported', turtle?.stretched === true && (turtle.distortionPercent ?? 0) > 2, JSON.stringify(turtle))

  m = await inspectPptx(await mutated(original, slide1, (x) => x.replace('<p:transition spd="med" advClick="0" advTm="5000"><p:fade/></p:transition>', '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition spd="slow" p14:dur="2000" advClick="0" advTm="5000" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow" advClick="0" advTm="5000"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>')))
  check('mutation: a Morph transition inside mc:AlternateContent is read from the Choice branch', slide(m, 1).transition?.effect === 'Morph' && slide(m, 1).transition?.durationSeconds === 2, JSON.stringify(slide(m, 1).transition))

  {
    const zip = await JSZip.loadAsync(original)
    zip.file('ppt/vbaProject.bin', Buffer.from('not really a macro'))
    m = await inspectPptx(await zip.generateAsync({ type: 'nodebuffer' }))
    check('mutation: a macro project is reported, not run', m.presentation.hasMacros === true)
  }

  // ---- Found on pupils' files (each rebuilt here from the model answer)

  // The background inserted as a picture on the master, made 60%
  // transparent with Picture Format > Transparency, not as a background fill.
  const masterPart = 'ppt/slideMasters/slideMaster1.xml'
  const BG_PIC = '<p:pic><p:nvPicPr><p:cNvPr id="95" name="Background Picture"/><p:cNvPicPr/><p:nvPr userDrawn="1"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId13"><a:alphaModFix amt="40000"/></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5715000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
  m = await inspectPptx(await mutated(original, masterPart, (x) => x
    .replace(/<p:bg>.*?<\/p:bg>/, '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>')
    .replace('</p:grpSpPr>', `</p:grpSpPr>${BG_PIC}`)))
  const bgPic = m.masters[0].pictures.find((p) => p.name === 'Background Picture')
  check('regression: a picture\'s own transparency (alphaModFix) is reported', bgPic?.transparencyPercent === 60, JSON.stringify(bgPic))
  check('regression: a picture covering the slide is measured', bgPic?.slideCoveragePercent === 100, String(bgPic?.slideCoveragePercent))
  const full = slide(m, 3).fullSlidePictures
  check('regression: each slide lists the master\'s full-slide picture with its transparency', full.length === 1 && full[0].name === 'Background Picture' && full[0].source === 'slide master' && full[0].transparencyPercent === 60, JSON.stringify(full))
  check('regression: the effective background comes from the master', slide(m, 3).effectiveBackground?.source === 'slide master' && slide(m, 3).effectiveBackground?.background.kind === 'theme style', JSON.stringify(slide(m, 3).effectiveBackground))
  let mText = describePresentation(m)
  check('regression: shapes in front of a full-slide picture are not listed as overlaps', !/"Background Picture" \(slide master\) and .* overlap/.test(mText))
  check('regression: the text report states the master picture\'s transparency', mText.includes('Full-slide picture "Background Picture" (from the slide master) covers 100% of the slide, transparency 60%'))

  // A full-slide picture on the slide itself, put in front of the content.
  const turtleRid = /r:embed="(rId\d+)"/.exec((await (await JSZip.loadAsync(original)).file(slide3)!.async('string')))![1]
  m = await inspectPptx(await mutated(original, slide3, (x) => x.replace('</p:spTree>', BG_PIC.replace('rId13', turtleRid).replace('id="95"', 'id="96"') + '</p:spTree>')))
  const covering = slide(m, 3).overlaps.filter((o) => o.fullSlidePicture === '"Background Picture"' && o.inFront === '"Background Picture"')
  check('regression: a full-slide picture in front of the content is called out', covering.length > 0 && describePresentation(m).includes('is IN FRONT, covering the other'), JSON.stringify(covering.slice(0, 2)))

  check('regression: overlaps say which shape is in front (later in the drawing order)', report.slides.some((s) => s.overlaps.some((o) => o.a === '"Picture 2"' && o.b.startsWith('"Action Button') && o.inFront === o.b)))
  check('regression: every slide states its effective background', report.slides.every((s) => s.effectiveBackground?.background.kind === 'picture' && s.effectiveBackground.background.transparencyPercent === 60))

  m = await inspectPptx(await mutated(original, slide1, (x) => x.replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBg"><a:alphaModFix amt="52000"/></a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')))
  check('regression: a background set on one slide is reported as that slide\'s', slide(m, 1).effectiveBackground?.source === 'slide' && slide(m, 1).effectiveBackground?.background.transparencyPercent === 48 && slide(m, 2).effectiveBackground?.source === 'slide master')

  // A table's cells.
  const TABLE = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="40" name="Prices Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="3200000"/><a:ext cx="4000000" cy="800000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Ticket</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Price</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Adult</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>SAR 60</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
  const slide4 = 'ppt/slides/slide4.xml'
  m = await inspectPptx(await mutated(original, slide4, (x) => x.replace('</p:spTree>', `${TABLE}</p:spTree>`)))
  const table = slide(m, 4).shapes.find((s) => s.name === 'Prices Table')
  check('regression: a table\'s cell text is read', table?.kind === 'table' && JSON.stringify(table.tableRows) === JSON.stringify([['Ticket', 'Price'], ['Adult', 'SAR 60']]), JSON.stringify(table))
  check('regression: table rows appear in the text report', describePresentation(m).includes('row 2: "Adult" | "SAR 60"'))

  // SmartArt keeps its text in a diagram data part.
  {
    const zip = await JSZip.loadAsync(original)
    const slide5 = 'ppt/slides/slide5.xml'
    const rels5 = 'ppt/slides/_rels/slide5.xml.rels'
    const DIAGRAM = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="41" name="Diagram 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="1300000"/><a:ext cx="3000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId90" r:lo="rId91" r:qs="rId92" r:cs="rId93"/></a:graphicData></a:graphic></p:graphicFrame>'
    zip.file(slide5, (await zip.file(slide5)!.async('string')).replace('</p:spTree>', `${DIAGRAM}</p:spTree>`))
    zip.file(rels5, (await zip.file(rels5)!.async('string')).replace('</Relationships>', '<Relationship Id="rId90" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/></Relationships>'))
    zip.file('ppt/diagrams/data1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="0" type="doc"><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt><dgm:pt modelId="1"><dgm:t><a:bodyPr/><a:p><a:r><a:t>By bus: Route 12</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt modelId="2"><dgm:t><a:bodyPr/><a:p><a:r><a:t>By car: free car park</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>')
    m = await inspectPptx(await zip.generateAsync({ type: 'nodebuffer' }))
    const diagram = slide(m, 5).shapes.find((s) => s.name === 'Diagram 1')
    check('regression: SmartArt text is read from its data part', diagram?.kind === 'diagram' && diagram.paragraphs.map((p) => p.text).join('|') === 'By bus: Route 12|By car: free car park', JSON.stringify(diagram?.paragraphs))
  }

  // Text formatting per shape, including shrink-on-overflow.
  const body4 = slide(report, 4).shapes.find((s) => s.name === 'Content Placeholder 2')
  check('regression: a shape\'s text formatting is summarised', body4?.textSummary !== null && (body4?.textSummary?.sizesPt.length ?? 0) > 0 && body4?.textSummary?.bold === 'no', JSON.stringify(body4?.textSummary))
  m = await inspectPptx(await mutated(original, slide4, (x) => x.replace('<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Open daily', '<p:spPr/><p:txBody><a:bodyPr><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr><a:lstStyle/><a:p><a:r><a:t>Open daily')))
  const shrunk = slide(m, 4).shapes.find((s) => s.name === 'Content Placeholder 2')?.textSummary
  check('regression: shrink-on-overflow scales the reported text size', shrunk?.autofitScalePercent === 62.5 && shrunk.sizesPt[0] === Math.round(body4!.textSummary!.sizesPt[0] * 0.625 * 10) / 10, JSON.stringify(shrunk))
  check('regression: the text report names the font as a font', text.includes('font "Calibri"'))

  // A slide number typed in rather than inserted as the field.
  m = await inspectPptx(await mutated(original, slide2, (x) => x.replace(
    '<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2C}" type="slidenum"><a:rPr lang="en-GB"/><a:t>‹#›</a:t></a:fld>',
    '<a:r><a:rPr lang="en-GB"/><a:t>2</a:t></a:r>',
  )))
  const typedNumber = slide(m, 2).footerItems.find((f) => f.kind === 'slide number')
  check('regression: a typed slide number is reported', typedNumber?.typedNumber === true && slide(report, 2).footerItems.find((f) => f.kind === 'slide number')?.typedNumber === false, JSON.stringify(typedNumber))
  check('regression: the typed slide number is called out in the text report', describePresentation(m).includes('a typed number, NOT the slide number field'))

  // A file link holding a full Windows path: named by its file, the path kept
  // out of the text report.
  const ticket = slide(report, 4).links.find((l) => l.kind === 'file')
  check('regression: a relative file link is named and marked relative', ticket?.fileName === 'TICKET PRICES.xlsx' && ticket.absolutePath === false, JSON.stringify(ticket))
  m = await inspectPptx(await mutated(original, 'ppt/slides/_rels/slide4.xml.rels', (x) => x.replace('Target="TICKET PRICES.xlsx"', 'Target="file:///C:\\Users\\someone\\Documents\\TICKET%20PRICES.xlsx"')))
  const absolute = slide(m, 4).links.find((l) => l.kind === 'file')
  mText = describePresentation(m)
  check('regression: a file link with a full path is named by its file', absolute?.fileName === 'TICKET PRICES.xlsx' && absolute.absolutePath === true, JSON.stringify(absolute))
  check('regression: the full path is kept out of the text report', mText.includes('file "TICKET PRICES.xlsx" (a full path') && !mText.includes('someone'))
  m = await inspectPptx(await mutated(original, slide4, (x) => x.replace('<a:hlinkClick r:id="rId2"/>', '<a:hlinkClick r:id="rId2" action="ppaction://hlinkfile"/>')))
  check('regression: a hlinkfile action link is named by its file too', slide(m, 4).links.find((l) => l.kind === 'file')?.fileName === 'TICKET PRICES.xlsx')

  // The date switched off in Header & Footer for the layout, but its
  // placeholder left on the layout: the layout still shows it.
  m = await inspectPptx(await mutated(original, 'ppt/slideLayouts/slideLayout4.xml', (x) => x
    .replace('<p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer Placeholder 5"/>', `${DATE_PH}<p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer Placeholder 5"/>`)
    .replace('</p:clrMapOvr></p:sldLayout>', '</p:clrMapOvr><p:hf hdr="0" dt="0"/></p:sldLayout>')))
  mText = describePresentation(m)
  check('regression: a date placeholder left on a layout whose date flag is off is called out', m.layouts.find((l) => l.name === 'Two Content')?.headerFooter?.date === false && mText.includes('The date placeholder is still on this layout although its header/footer flag is off'))
  check('regression: the layout line says which placeholders the layout has', text.includes('Placeholders on this layout: date NO;'))

  // A layout PowerPoint turned into a custom one (no type attribute).
  m = await inspectPptx(await mutated(original, 'ppt/slideLayouts/slideLayout6.xml', (x) => x.replace(' type="titleOnly"', '')))
  check('regression: a layout without a type is described as custom', describePresentation(m).includes('Layout "Title Only" (type custom;'))

  // ---- Supplied images: each picture named after the image it is
  {
    const images = await Promise.all(IMAGE_FILES.map(async (name) => ({ name, bytes: await readFile(path.join(IMAGES, name)) })))
    const known = await knownImagesFromFiles(images)
    check('the eight supplied images load, named without their extension', known.map((k) => k.name).join(',') === 'BACKGROUND,CAMEL,CORAL,JELLYFISH,LOGO,MAP,SHARK,TURTLE')

    check('without supplied images nothing is named (behaviour unchanged)', report.suppliedImages === null && report.unmatchedPictures === null && report.slides.every((s) => s.pictures.every((p) => p.match === null)) && report.masters[0].background.match === null)
    check('without supplied images the text report has no SUPPLIED IMAGES section', !text.includes('SUPPLIED IMAGES'))

    // Margin: no supplied image may pass for another, even as a window of it.
    let worst = { pair: '', similarity: 0 }
    let selfLowest = 100
    for (const a of known) {
      for (const b of known) {
        const c = compareFingerprints(a.fingerprint!, b.fingerprint!)!
        if (a === b) selfLowest = Math.min(selfLowest, c.similarityPercent)
        else if (c.similarityPercent > worst.similarity) worst = { pair: `${a.name} vs ${b.name}`, similarity: c.similarityPercent }
      }
    }
    console.log(`     supplied images: nearest pair ${worst.pair} ${worst.similarity}%, threshold ${MATCH_THRESHOLD_PERCENT}%, each against itself ≥ ${selfLowest}%`)
    check('the supplied images are pairwise below the match threshold', worst.similarity < MATCH_THRESHOLD_PERCENT, JSON.stringify(worst))
    check('each supplied image matches itself', selfLowest >= 99, String(selfLowest))

    const r = await inspectPptx(original, { knownImages: known })
    const named = (p: { match: { kind: string; name: string | null } | null } | undefined) => (p?.match ? `${p.match.kind}:${p.match.name}` : 'none')
    check('master background is BACKGROUND (exact copy)', named(r.masters[0].background) === 'exact:BACKGROUND', named(r.masters[0].background))
    check('master logo is LOGO (exact copy)', named(r.masters[0].pictures.find((p) => p.name === 'Logo')) === 'exact:LOGO')
    for (const [n, name] of [[2, 'CORAL'], [3, 'TURTLE'], [5, 'MAP'], [6, 'JELLYFISH']] as const) {
      const pics = slide(r, n).pictures
      check(`slide ${n} picture is ${name} (exact copy)`, pics.length === 1 && named(pics[0]) === `exact:${name}`, pics.map(named).join(','))
    }
    const uses = (report: PresentationReport, name: string) => report.suppliedImages!.find((i) => i.name === name)!.uses
    const where = (report: PresentationReport, name: string) => uses(report, name).map((u) => `${u.where} ${u.as}`).join('; ')
    check('BACKGROUND is used as the slide master background', where(r, 'BACKGROUND') === 'slide master 1 background', where(r, 'BACKGROUND'))
    check('LOGO is used as a picture on the slide master', where(r, 'LOGO') === 'slide master 1 picture', where(r, 'LOGO'))
    check('CORAL on slide 2, TURTLE on slide 3, MAP on slide 5, JELLYFISH on slide 6', ['CORAL:slide 2 picture', 'TURTLE:slide 3 picture', 'MAP:slide 5 picture', 'JELLYFISH:slide 6 picture'].every((s) => where(r, s.split(':')[0]) === s.split(':')[1]))
    check('CAMEL and SHARK are not used', uses(r, 'CAMEL').length === 0 && uses(r, 'SHARK').length === 0)
    check('no picture is left unmatched', r.unmatchedPictures?.length === 0, JSON.stringify(r.unmatchedPictures))
    const rText = describePresentation(r)
    check('text report: SUPPLIED IMAGES section with CAMEL not used', rText.includes('SUPPLIED IMAGES') && rText.includes('  CAMEL: not used') && rText.includes('  SHARK: not used'))
    check('text report: TURTLE on slide 3 with its size', rText.includes('  TURTLE: slide 3 picture "Picture 3", 10.00 × 7.50 cm (exact copy)'))
    check('text report: the picture line names its image', rText.includes('media ppt/media/image3.jpg, 1200 × 900 px, aspect ratio kept; image: TURTLE (exact copy)'))

    // What pupils' copies look like: recompressed, resized, png ↔ jpg, a
    // transparent PNG flattened onto a dark screenshot window, and a picture
    // that is none of the supplied ones.
    const file = (name: string) => images.find((i) => i.name === name)!.bytes
    const camel = await sharp(file('CAMEL.jpg')).resize(480).jpeg({ quality: 35 }).toBuffer()
    const mapJpeg = await sharp(file('MAP.png')).resize(600).jpeg({ quality: 50 }).toBuffer()
    const logoShot = await sharp(file('LOGO.png')).flatten({ background: '#1e1e1e' }).extend({ top: 40, bottom: 40, left: 20, right: 20, background: '#1e1e1e' }).jpeg({ quality: 70 }).toBuffer()
    const coralPng = await sharp(file('CORAL.jpg')).resize(700).png().toBuffer()
    const swapped = await withMedia(original, {
      'ppt/media/image3.jpg': camel,
      'ppt/media/image4.png': mapJpeg,
      'ppt/media/image2.png': logoShot,
      'ppt/media/image6.jpg': coralPng,
      'ppt/media/image5.jpg': await unrelatedImage(),
    })
    m = await inspectPptx(swapped, { knownImages: known })
    const s3 = slide(m, 3).pictures[0]?.match
    check('mutation: TURTLE swapped for a recompressed, resized CAMEL "looks like CAMEL"', s3?.kind === 'similar' && s3.name === 'CAMEL', JSON.stringify(s3))
    check('mutation: CAMEL is then reported used on slide 3, TURTLE not used', where(m, 'CAMEL') === 'slide 3 picture' && uses(m, 'TURTLE').length === 0, where(m, 'CAMEL'))
    const s5 = slide(m, 5).pictures[0]?.match
    check('mutation: MAP re-saved as a smaller JPEG still looks like MAP', s5?.kind === 'similar' && s5.name === 'MAP', JSON.stringify(s5))
    const logo = m.masters[0].pictures.find((p) => p.name === 'Logo')?.match
    check('mutation: LOGO flattened onto a dark screenshot window still looks like LOGO', logo?.kind === 'similar' && logo.name === 'LOGO', JSON.stringify(logo))
    const s2 = slide(m, 2).pictures[0]?.match
    check('mutation: CORAL as a smaller PNG still looks like CORAL', s2?.kind === 'similar' && s2.name === 'CORAL', JSON.stringify(s2))
    const s6 = slide(m, 6).pictures[0]?.match
    check('mutation: an unrelated picture matches none of the supplied images', s6?.kind === 'none' && s6.name === null && uses(m, 'JELLYFISH').length === 0, JSON.stringify(s6))
    check('mutation: the unrelated picture is listed with its slide and size', m.unmatchedPictures?.length === 1 && m.unmatchedPictures[0].where === 'slide 6' && m.unmatchedPictures[0].box?.widthCm === 10, JSON.stringify(m.unmatchedPictures))
    mText = describePresentation(m)
    check('mutation: the text report says "looks like CAMEL (similarity N%)"', /image: looks like CAMEL \(similarity \d+(\.\d)?%\)/.test(mText))
    check('mutation: the text report says "not one of the supplied images"', mText.includes('image: not one of the supplied images (nearest '))
    console.log(`     copies: CAMEL ${s3?.similarityPercent}%, MAP ${s5?.similarityPercent}%, LOGO ${logo?.similarityPercent}%, CORAL ${s2?.similarityPercent}%; unrelated: nearest ${s6?.nearest?.name} ${s6?.nearest?.similarityPercent}%`)

    // A cropped picture (Picture Format > Crop keeps the whole image and
    // records a:srcRect): still an exact copy by its bytes, and a similar copy
    // is compared on the region shown.
    const cropXml = (x: string) => x.replace(/(<a:blip r:embed="rId\d+"(?:\/>|>.*?<\/a:blip>))/, '$1<a:srcRect l="12000" t="5000" r="20000" b="10000"/>')
    m = await inspectPptx(await mutated(original, slide3, cropXml), { knownImages: known })
    const cropped = slide(m, 3).pictures[0]?.match
    check('mutation: a cropped TURTLE is still TURTLE (exact copy), noted as cropped', cropped?.kind === 'exact' && cropped.name === 'TURTLE' && cropped.cropped, JSON.stringify(cropped))
    check('mutation: the text report notes the crop', describePresentation(m).includes('image: TURTLE (exact copy) (cropped on the slide)'))
    const croppedSwap = await JSZip.loadAsync(swapped)
    croppedSwap.file(slide3, cropXml(await croppedSwap.file(slide3)!.async('string')))
    m = await inspectPptx(await croppedSwap.generateAsync({ type: 'nodebuffer' }), { knownImages: known })
    const croppedCamel = slide(m, 3).pictures[0]?.match
    check('mutation: a cropped CAMEL copy looks like CAMEL, compared on the region shown', croppedCamel?.kind === 'similar' && croppedCamel.name === 'CAMEL' && croppedCamel.comparedOn === 'cropped region', JSON.stringify(croppedCamel))
  }

  // ---- Refusals
  const oldPpt = Buffer.concat([Buffer.from('D0CF11E0A1B11AE1', 'hex'), Buffer.alloc(504)])
  let [ok, message] = await refused(() => inspectPptx(oldPpt), /old \.ppt file\. Open it in PowerPoint and save it as a \.pptx/)
  check('an old .ppt is rejected with the .ppt message', ok, message)

  const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256))
  ;[ok, message] = await refused(() => inspectPptx(random), /^This is not a PowerPoint \.pptx file\.$/)
  check('random bytes are rejected', ok, message)

  {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document/>')
    ;[ok, message] = await refused(async () => inspectPptx(await zip.generateAsync({ type: 'nodebuffer' })), /^This is not a PowerPoint \.pptx file\.$/)
    check('a zip without ppt/presentation.xml is rejected', ok, message)
  }

  {
    const zip = await JSZip.loadAsync(original)
    for (let i = 0; i < 2001; i += 1) zip.file(`junk/${i}.txt`, '')
    ;[ok, message] = await refused(async () => inspectPptx(await zip.generateAsync({ type: 'nodebuffer' })), /damaged/)
    check('a zip with too many entries is rejected', ok, message)
  }

  {
    const bomb = await mutated(original, slide1, (x) => x.replace('<p:cSld>', `<p:cSld><!--${'A'.repeat(51 * 1024 * 1024)}-->`))
    ;[ok, message] = await refused(() => inspectPptx(bomb), /damaged/)
    check('XML that decompresses past the size cap is rejected', ok, message)
  }

  ;[ok, message] = await refused(
    async () => inspectPptx(await mutated(original, slide1, (x) => x.replace("<?xml version='1.0' encoding='UTF-8' standalone='yes'?>", "<?xml version='1.0'?><!DOCTYPE p:sld [<!ENTITY a \"aaaa\">]>"))),
    /not a PowerPoint/,
  )
  check('XML with a DOCTYPE/entity declaration is refused', ok, message)

  console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
