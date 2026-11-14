import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import JSZip from 'jszip'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'

import { checkEvidenceTemplate, readDocxParagraphs, readDocxText, readEvidenceDocument, type EvidenceDocument } from '@/lib/docx/evidence'
import { pdfPageCount, pdfText, pdfToPngPages } from '@/lib/pdf/poppler'
import {
  describePresentation,
  describePresentationSections,
  filterPresentationSections,
  isPresentationSectionSelector,
} from '@/lib/pptx/describe'
import { DocxReadError, PptxInspectError } from '@/lib/pptx/errors'
import { inspectPptx } from '@/lib/pptx/inspect'
import { knownImagesFromFiles } from '@/lib/pptx/known-images'
import { checkDocxFileType, checkFileType, openDocxPackage, openPackage } from '@/lib/pptx/package'

// The Office and PDF readers behind a PowerPoint assessment: the evidence
// document reader on .docx files built in memory, the poppler helpers on a
// PDF built with pdfkit, and the presentation description split into
// sections. No database, no network, no model. Needs poppler-utils.
//   npx tsx tests/powerpoint-assessment/evidence-doc.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refusal(run: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    await run()
    return null
  } catch (error) {
    return error
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'pptx')
const IMAGES = path.join(FIXTURES, 'pearl-images')
const IMAGE_FILES = ['BACKGROUND.png', 'CAMEL.jpg', 'CORAL.jpg', 'JELLYFISH.jpg', 'LOGO.png', 'MAP.png', 'SHARK.jpg', 'TURTLE.jpg']

const image = (data: Buffer, type: 'png' | 'jpg' = 'png') =>
  new ImageRun({ type, data, transformation: { width: 120, height: 80 } })
const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 })
const h2 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2 })
const p = (text: string) => new Paragraph({ children: [new TextRun(text)] })
const pic = (data: Buffer, type: 'png' | 'jpg' = 'png') => new Paragraph({ children: [image(data, type)] })

async function build(children: (Paragraph | Table)[]) {
  return Packer.toBuffer(new Document({ sections: [{ children }] }))
}

// Rewrites one docx's parts in memory.
async function editDocx(buffer: Buffer, edit: (zip: JSZip) => Promise<void>) {
  const zip = await JSZip.loadAsync(buffer)
  await edit(zip)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// A minimal EMF: EMR_HEADER with the " EMF" signature, then EMR_EOF.
function emfBytes() {
  const header = Buffer.alloc(108)
  header.writeUInt32LE(1, 0)
  header.writeUInt32LE(108, 4)
  header.write(' EMF', 40, 'latin1')
  header.writeUInt32LE(0x10000, 44)
  const eof = Buffer.alloc(20)
  eof.writeUInt32LE(14, 0)
  eof.writeUInt32LE(20, 4)
  return Buffer.concat([header, eof])
}

// A .docx written by hand, for layouts the docx package cannot produce.
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"'
const STYLES = `<?xml version="1.0"?><w:styles ${NS}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="NumberedTask"><w:name w:val="Numbered Task"/><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>`
const NUMBERING = `<?xml version="1.0"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1%2"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%1)"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num><w:num w:numId="4"><w:abstractNumId w:val="3"/></w:num></w:numbering>`
const rt = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`
const rp = (inner: string, style?: string, pPr = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${pPr}</w:pPr>${inner}</w:p>`
const numbered = (numId: number, ilvl: number) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`
const inlinePic = (rid: string) => `<w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
const anchorPic = (rid: string) => `<w:r><w:drawing><wp:anchor behindDoc="0"><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
const rawTable = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${c || '<w:p/>'}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`

async function rawDocx(body: string, options: { mainPart?: string } = {}) {
  const main = options.mainPart ?? 'word/document.xml'
  const file = main.split('/').pop()!
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`)
  const images = Array.from({ length: 6 }, (_, i) => `<Relationship Id="img${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`).join('')
  zip.file(`word/_rels/${file}.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${images}</Relationships>`)
  zip.file('word/styles.xml', STYLES)
  zip.file('word/numbering.xml', NUMBERING)
  for (let i = 1; i <= 6; i += 1) {
    zip.file(`word/media/image${i}.png`, await sharp({ create: { width: 10 + i, height: 10, channels: 3, background: '#336699' } }).png().toBuffer())
  }
  zip.file(main, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

// Picture names per section, and unplaced, e.g. "1a=image1.png;1j=;unplaced=image2.png".
function filed(doc: EvidenceDocument) {
  return [...doc.sections.map((s) => `${s.label}=${s.images.map((i) => i.name).join(',')}`), `unplaced=${doc.unplaced.images.map((i) => i.name).join(',')}`].join(';')
}

const TEXT_BOX = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2000000" cy="800000"/><wp:wrapNone/><wp:docPr id="99" name="Text Box 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr/><wps:txbx><w:txbxContent><w:p><w:r><w:t>4d</w:t></w:r></w:p><w:p><w:r><w:t>Text box answer</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>FALLBACK ONLY</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`

async function main() {
  const images = Object.fromEntries(
    await Promise.all(IMAGE_FILES.map(async (name) => [name, await readFile(path.join(IMAGES, name))] as const)),
  ) as Record<string, Buffer>
  // A small picture, stood in for an EMF after the docx is built.
  const placeholder = await sharp({ create: { width: 7, height: 5, channels: 3, background: '#123456' } }).png().toBuffer()
  // Noise, so its PNG at 1600 px is past 1.5 MB and it comes back as JPEG.
  const noisy = await sharp(Buffer.from(Array.from({ length: 3000 * 2000 * 3 }, () => Math.floor(Math.random() * 256))), {
    raw: { width: 3000, height: 2000, channels: 3 },
  }).png().toBuffer()
  // A 200 × 100 JPEG whose EXIF says "rotate 90°".
  const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer()

  const pptx0 = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))

  // ---- The blank template: headings and instructions only.
  const template = await build([
    p('Name and class:'),
    h1('Task 1a'),
    h1('1 (j)'),
    p('Paste your screenshot below:'),
    h2('3(e)'),
    p('S2: Explain your choice.'),
  ])
  const templateParagraphs = await readDocxParagraphs(template)
  check('readDocxParagraphs reads the template', templateParagraphs.join('|') === 'Name and class:|Task 1a|1 (j)|Paste your screenshot below:|3(e)|S2: Explain your choice.', templateParagraphs.join('|'))

  // ---- A pupil's evidence document.
  const pupilDoc = await build([
    p('Name and class:'),
    p('Name and class: Test Pupil 10X'),
    pic(images['CAMEL.jpg'], 'jpg'),
    h1('Task 1a'),
    p('Answer for 1a'),
    h1('1aa'),
    p('Answer for 1aa'),
    new Table({
      rows: [
        new TableRow({ children: [new TableCell({ children: [p('1b')] }), new TableCell({ children: [p('Table answer for 1b')] })] }),
        new TableRow({ children: [new TableCell({ children: [p('1c')] }), new TableCell({ children: [pic(images['JELLYFISH.jpg'], 'jpg')] })] }),
      ],
    }),
    h1('1 (j)'),
    p('Paste your screenshot below:'),
    pic(images['MAP.png']),
    pic(images['LOGO.png']),
    p('1a again, written by the pupil'),
    h2('3(e)'),
    pic(images['TURTLE.jpg'], 'jpg'),
    h1('Appendix'),
    p('Stray paragraph'),
    pic(images['SHARK.jpg'], 'jpg'),
    p('Question S1: The audience is tourists'),
    p('More S1 text'),
    p('S10 - ten answer'),
    p('S2: Explain your choice. Because it is bright'),
    p('2a'),
    pic(noisy),
    p('2b'),
    pic(rotated, 'jpg'),
    p('4e'),
    pic(placeholder),
  ])
  const pupil = await editDocx(pupilDoc, async (zip) => {
    // The placeholder picture becomes an EMF drawing.
    let mediaName: string | null = null
    for (const name of Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !zip.files[n].dir)) {
      if (Buffer.compare(await zip.file(name)!.async('nodebuffer'), placeholder) === 0) mediaName = name
    }
    if (!mediaName) throw new Error('placeholder media not found')
    const emfName = mediaName.replace(/\.png$/, '.emf')
    zip.remove(mediaName)
    zip.file(emfName, emfBytes())
    const relsPart = 'word/_rels/document.xml.rels'
    const rels = await zip.file(relsPart)!.async('string')
    zip.file(relsPart, rels.replace(mediaName.replace('word/', ''), emfName.replace('word/', '')))
    const types = await zip.file('[Content_Types].xml')!.async('string')
    zip.file('[Content_Types].xml', types.replace('<Default ', '<Default ContentType="image/x-emf" Extension="emf"/><Default '))
    // A text box (DrawingML choice, VML fallback) at the end of the body.
    const docPart = 'word/document.xml'
    const xml = await zip.file(docPart)!.async('string')
    zip.file(docPart, xml.replace('<w:sectPr', `${TEXT_BOX}<w:sectPr`))
  })

  const headings = ['1a', '1aa', '1b', '1c', '1d', '1j', '3e', 'S1', 'S10', 'S2', '2a', '2b', '4d', '4e']
  const read = await readEvidenceDocument(pupil, { headings, templateParagraphs })
  const section = (doc: EvidenceDocument, label: string) => doc.sections.find((s) => s.label === label)
  const textOf = (label: string) => section(read, label)?.text

  check('sections come in the order the labels were given', read.sections.map((s) => s.label).join(',') === headings.filter((h) => h !== '1d').join(','), read.sections.map((s) => s.label).join(','))
  check('a label with no heading is missing', read.missingHeadings.join(',') === '1d', read.missingHeadings.join(','))
  check('"Task 1a" Heading 1 is 1a, with its answer', textOf('1a') === 'Answer for 1a', JSON.stringify(textOf('1a')))
  check('1aa is not confused with 1a', textOf('1aa') === 'Answer for 1aa', JSON.stringify(textOf('1aa')))
  check('section keeps the heading as written', section(read, '1a')?.heading === 'Task 1a', section(read, '1a')?.heading)
  check('a table cell label is a heading, the next cell its answer', textOf('1b') === 'Table answer for 1b', JSON.stringify(textOf('1b')))
  check('a picture in a table cell is under its row label', section(read, '1c')?.images.length === 1)
  const j = section(read, '1j')
  check('"1 (j)" is 1j with its two screenshots', j?.images.length === 2, String(j?.images.length))
  check('template instruction is removed from 1j', !j?.text.includes('Paste your screenshot'), JSON.stringify(j?.text))
  check('a later "1a ..." line is ordinary text under the current section', j?.text === '1a again, written by the pupil', JSON.stringify(j?.text))
  check('a repeated heading is warned about', read.warnings.some((w) => /1a appears more than once/.test(w)), read.warnings.join(' | '))
  check('"3(e)" is 3e with its screenshot', section(read, '3e')?.images.length === 1)
  check('a pupil Heading 1 ends the Heading 2 3e section', section(read, '3e')?.text === '' && section(read, '3e')?.images.length === 1, JSON.stringify(section(read, '3e')?.text))
  check('"Question S1: …" gives S1 the text on its line and after', textOf('S1') === 'The audience is tourists\nMore S1 text', JSON.stringify(textOf('S1')))
  check('S10 is not confused with S1', textOf('S10') === 'ten answer', JSON.stringify(textOf('S10')))
  check('template text at the start of the heading line is subtracted', textOf('S2') === 'Because it is bright', JSON.stringify(textOf('S2')))
  check('a text box is read (choice branch), its label a heading', textOf('4d') === 'Text box answer', JSON.stringify(textOf('4d')))
  check('the VML fallback of a text box is not read', !JSON.stringify(read).includes('FALLBACK ONLY'))

  const two = section(read, '2a')?.images[0]
  check('a large noisy screenshot is shrunk to 1600 px on its long side', two?.width === 1600 && two?.height === 1067, `${two?.width}×${two?.height}`)
  check('…and comes back as JPEG because its PNG passes 1.5 MB', two?.mimeType === 'image/jpeg' && two.data[0] === 0xff, two?.mimeType)
  const turned = section(read, '2b')?.images[0]
  check('an EXIF-rotated photo is auto-rotated', turned?.width === 100 && turned?.height === 200, `${turned?.width}×${turned?.height}`)
  const logo = j?.images.find((i) => i.mimeType === 'image/png')
  check('a small screenshot stays PNG with its size', !!logo && logo.data.subarray(1, 4).toString('latin1') === 'PNG' && logo.bytes === logo.data.length && logo.width > 0)
  const emf = section(read, '4e')
  check('an EMF drawing is listed as not shown, by name', emf?.images.length === 0 && emf?.notShown.length === 1 && /\.emf$/.test(emf.notShown[0].name) && /EMF/.test(emf.notShown[0].reason), JSON.stringify(emf?.notShown))
  check('…with a warning', read.warnings.some((w) => /\.emf under 4e is an EMF drawing/.test(w)), read.warnings.join(' | '))

  check('text before the first heading is unplaced (template line removed)', read.unplaced.text.startsWith('Test Pupil 10X'), JSON.stringify(read.unplaced.text))
  check('content under an unknown heading is unplaced', read.unplaced.text.includes('Appendix') && read.unplaced.text.includes('Stray paragraph'), JSON.stringify(read.unplaced.text))
  check('pictures before the first heading and under an unknown heading are unplaced', read.unplaced.images.length === 2, String(read.unplaced.images.length))
  check('unplaced content is warned about', read.warnings.some((w) => /not under any task heading/.test(w)))
  check('no picture is filed twice', read.sections.reduce((n, s) => n + s.images.length, 0) + read.unplaced.images.length === 8)

  // ---- Without a template, the template's own lines come through.
  const raw = await readEvidenceDocument(pupil, { headings: ['1j', 'S2'] })
  check('without a template the instruction stays in 1j', section(raw, '1j')?.text.startsWith('Paste your screenshot below:') === true, JSON.stringify(section(raw, '1j')?.text))
  check('without a template S2 keeps its whole line', section(raw, 'S2')?.text.split('\n')[0] === 'Explain your choice. Because it is bright', JSON.stringify(section(raw, 'S2')?.text))
  check('lines for labels not asked for are ordinary text in the current section', section(raw, 'S2')?.text.includes('\n2a\n2b\n') === true)
  check('labels not asked for are not headings (their content is not filed)', raw.sections.length === 2)

  // ---- Plain-paragraph heading variants, one document each.
  const variants: [string, string][] = [
    ['1a', '1a'], ['Task 1a', '1a'], ['1 (a)', '1a'], ['1(a)', '1a'], ['Question 1a:', '1a'], ['1a.', '1a'], ['Q1a', '1a'], ['(1a)', '1a'],
    ['S1', 'S1'], ['S1:', 'S1'], ['Question S1', 'S1'], ['s1 -', 'S1'], ['Task S1', 'S1'], ['S 1', 'S1'],
  ]
  for (const [written, label] of variants) {
    const doc = await readEvidenceDocument(await build([p(written), p('answer')]), { headings: [label] })
    check(`"${written}" is the heading for ${label}`, doc.sections[0]?.text === 'answer' && doc.missingHeadings.length === 0, JSON.stringify(doc))
  }
  const negatives: [string, string][] = [['1aa', '1a'], ['S10', 'S1'], ['1ai', '1a'], ['11a', '1a'], ['1 and 2', '1a'], ['QS1x', 'S1']]
  for (const [written, label] of negatives) {
    const doc = await readEvidenceDocument(await build([p(written), p('answer')]), { headings: [label] })
    check(`"${written}" is not the heading for ${label}`, doc.sections.length === 0 && doc.missingHeadings[0] === label, JSON.stringify(doc.sections))
  }
  const longLine = `1a ${'this is a long paragraph that only happens to start with the label '.repeat(3)}`
  const long = await readEvidenceDocument(await build([p(longLine)]), { headings: ['1a'] })
  check('a long plain paragraph without a separator is not a heading', long.sections.length === 0)
  const longSeparated = await readEvidenceDocument(await build([p(`1a: ${longLine.slice(3)}`)]), { headings: ['1a'] })
  check('a long plain paragraph with "1a:" is the heading, the rest its answer', longSeparated.sections[0]?.text === longLine.slice(3).trim())
  const longStyled = await readEvidenceDocument(await build([h1(longLine)]), { headings: ['1a'] })
  check('a long Heading-styled paragraph is a heading', longStyled.sections.length === 1)
  const both = await readEvidenceDocument(await build([p('S10'), p('ten'), p('S1'), p('one')]), { headings: ['S1', 'S10'] })
  check('S1 and S10 are each found under their own heading', both.sections.map((s) => `${s.label}=${s.text}`).join(',') === 'S1=one,S10=ten', JSON.stringify(both.sections))
  const plainSection = await readEvidenceDocument(await build([p('1a'), h1('My screenshot'), p('still 1a')]), { headings: ['1a'] })
  check('a Heading under a plain-paragraph label stays in that section', plainSection.sections[0]?.text === 'My screenshot\nstill 1a' && plainSection.unplaced.text === '', JSON.stringify(plainSection))
  const empty = await readEvidenceDocument(await build([p('nothing here')]), { headings: [] })
  check('no headings asked for: everything is unplaced', empty.sections.length === 0 && empty.unplaced.text === 'nothing here')

  // ---- Layouts from review (each would have cost a pupil a mark).
  // A template heading line over 120 characters with no separator.
  const longHeading = '1a Take a screenshot of the Slide Size dialogue box showing that you have set the slide size to 16 by 10 and the orientation to landscape'
  const longTemplateDoc = await rawDocx(rp(rt('Intro')) + rp(rt(longHeading)) + rp(inlinePic('img1')) + rp(rt('1j Slide master')) + rp(inlinePic('img2')))
  const longTemplate = await readEvidenceDocument(longTemplateDoc, { headings: ['1a', '1j'], templateParagraphs: ['Intro', longHeading] })
  check('a long template line starting with a label is a heading', filed(longTemplate) === '1a=image1.png;1j=image2.png;unplaced=', filed(longTemplate))
  check('…and without the template it is not', filed(await readEvidenceDocument(longTemplateDoc, { headings: ['1a', '1j'] })) === '1j=image2.png;unplaced=image1.png')
  const longTemplateFile = await rawDocx(rp(rt('Intro')) + rp(rt(longHeading)) + rp(rt('1j Slide master')))
  const templateMissing = await checkEvidenceTemplate(longTemplateFile, ['1a', '1j', '9z'])
  check('checkEvidenceTemplate names the headings a template lacks', templateMissing.join(',') === '9z', templateMissing.join(','))
  check('checkEvidenceTemplate finds every heading of the built template', (await checkEvidenceTemplate(template, ['1a', '1j', '3e'])).length === 0)

  // A pupil's own heading under a Heading 2 label.
  const ownHeading = await readEvidenceDocument(
    await rawDocx(rp(rt('1a Slide size'), 'Heading2') + rp(rt('My screenshot'), 'Heading2') + rp(inlinePic('img1')) + rp(rt('Extra'), 'Heading1') + rp(inlinePic('img2'))),
    { headings: ['1a'] },
  )
  check('a pupil heading at the same level stays in the section', filed(ownHeading) === '1a=image1.png;unplaced=image2.png', filed(ownHeading))
  check('…with a warning', ownHeading.warnings.some((w) => /"My screenshot" under 1a is not a task heading/.test(w)), ownHeading.warnings.join(' | '))
  check('a pupil heading at a higher level ends it', ownHeading.unplaced.text === 'Extra')
  const templateHeading = await readEvidenceDocument(
    await rawDocx(rp(rt('1a'), 'Heading2') + rp(inlinePic('img1')) + rp(rt('Section B'), 'Heading2') + rp(inlinePic('img2'))),
    { headings: ['1a'], templateParagraphs: ['1a', 'Section B'] },
  )
  check('a template heading at the same level ends the section', filed(templateHeading) === '1a=image1.png;unplaced=image2.png', filed(templateHeading))

  // Auto-numbered labels.
  const autoNumbered = await readEvidenceDocument(
    await rawDocx(
      rp(rt('Slides'), 'Heading1', numbered(1, 0)) + rp(rt('Slide size'), 'Heading2', numbered(1, 1)) + rp(inlinePic('img1')) +
      rp(rt('Master'), 'Heading2', numbered(1, 1)) + rp(inlinePic('img2')) +
      rp(rt('Images'), 'Heading1', numbered(1, 0)) + rp(rt('Logo'), 'NumberedTask') + rp(inlinePic('img3')),
    ),
    { headings: ['1a', '1b', '2a'] },
  )
  check('list numbering makes "1a", "1b", "2a" headings', filed(autoNumbered) === '1a=image1.png;1b=image2.png;2a=image3.png;unplaced=', filed(autoNumbered))
  check('…with the heading text after the number', autoNumbered.sections.map((s) => `${s.heading}/${s.text}`).join('|') === '1a Slide size/Slide size|1b Master/Master|2a Logo/Logo', autoNumbered.sections.map((s) => `${s.heading}/${s.text}`).join('|'))
  const formats = await readDocxText(await rawDocx(
    rp(rt('one'), undefined, numbered(2, 0)) + rp(rt('two'), undefined, numbered(2, 0)) + rp(rt('three'), undefined, numbered(2, 0)) + rp(rt('four'), undefined, numbered(2, 0)) +
    rp(rt('C'), undefined, numbered(3, 0)) + rp(rt('D'), undefined, numbered(3, 0)) + rp(rt('dot'), undefined, numbered(4, 0)),
  ))
  check('lower roman, upper letter with a start override, bullets', formats === '(i) one\n(ii) two\n(iii) three\n(iv) four\nC) C\nD) D\ndot', JSON.stringify(formats))

  // Labels as column headers.
  const columns = await readEvidenceDocument(
    await rawDocx(rawTable([[rp(rt('1a')), rp(rt('1j'))], [rp(inlinePic('img1')), rp(inlinePic('img2'))], [rp(rt('more 1a')), '']]) + rp(rt('after')) + rp(inlinePic('img3'))),
    { headings: ['1a', '1j'] },
  )
  check('a row of labels files the rows below by column', filed(columns) === '1a=image1.png;1j=image2.png,image3.png;unplaced=', filed(columns))
  check('…text too', columns.sections[0]?.text === 'more 1a', JSON.stringify(columns.sections[0]?.text))
  const labelPerRow = await readEvidenceDocument(
    await rawDocx(rawTable([[rp(rt('1a')), rp(inlinePic('img1'))], [rp(rt('1j')), rp(inlinePic('img2'))]])),
    { headings: ['1a', '1j'] },
  )
  check('label | screenshot rows are unchanged', filed(labelPerRow) === '1a=image1.png;1j=image2.png;unplaced=', filed(labelPerRow))

  // A picture at the start of the next heading's line.
  const leading = await readEvidenceDocument(
    await rawDocx(rp(rt('1a Slide size'), 'Heading2') + rp(inlinePic('img1') + rt('1j Master'), 'Heading2') + rp(anchorPic('img2') + rt('3e'), 'Heading2') + rp(rt('4d ') + inlinePic('img3'), 'Heading2')),
    { headings: ['1a', '1j', '3e', '4d'] },
  )
  check('an inline picture before the label goes to the section before; anchored or after stays', filed(leading) === '1a=image1.png;1j=;3e=image2.png;4d=image3.png;unplaced=', filed(leading))

  // "1. A …" is not 1a.
  const sentence = await readEvidenceDocument(
    await rawDocx(rp(rt('1. A screenshot must be cropped.')) + rp(inlinePic('img1')) + rp(rt('1a Slide size'), 'Heading2') + rp(inlinePic('img2'))),
    { headings: ['1a'] },
  )
  check('"1. A screenshot must be cropped." is not the 1a heading', filed(sentence) === '1a=image2.png;unplaced=image1.png', filed(sentence))
  for (const [written, style] of [['1. a', undefined], ['1 a:', undefined], ['1 a)', undefined], ['1. A Slide size', 'Heading2']] as const) {
    const doc = await readEvidenceDocument(await rawDocx(rp(rt(written), style) + rp(rt('answer'))), { headings: ['1a'] })
    check(`"${written}"${style ? ' (Heading 2)' : ''} is still 1a`, doc.sections[0]?.text.endsWith('answer') === true, JSON.stringify(doc.sections))
  }
  const looseTemplate = await readEvidenceDocument(await rawDocx(rp(rt('1. A Slide size')) + rp(rt('answer'))), { headings: ['1a'], templateParagraphs: ['1. A Slide size'] })
  check('"1. A Slide size" is 1a when it is template text', looseTemplate.sections[0]?.text === 'answer')

  // VML o:relid, placeholder text, full-width digits.
  const relid = await readEvidenceDocument(await rawDocx(rp(rt('1a')) + rp('<w:r><w:pict><v:shape><v:imagedata o:relid="img1" o:title=""/></v:shape></w:pict></w:r>')), { headings: ['1a'] })
  check('a VML picture with o:relid is read', filed(relid) === '1a=image1.png;unplaced=', filed(relid))
  const placeholderText = await readEvidenceDocument(
    await rawDocx(rp(rt('S1')) + rp(`<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${rt('Click or tap here to enter text.')}</w:sdtContent></w:sdt>`) + rp(rt('S2')) + `<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${rp(rt('Click or tap here to enter text.'))}</w:sdtContent></w:sdt>` + rp(rt('S3')) + rp(`<w:sdt><w:sdtPr/><w:sdtContent>${rt('Real answer')}</w:sdtContent></w:sdt>`)),
    { headings: ['S1', 'S2', 'S3'] },
  )
  check('content-control placeholder text is not an answer', placeholderText.sections.map((s) => `${s.label}=${s.text}`).join('|') === 'S1=|S2=|S3=Real answer', placeholderText.sections.map((s) => `${s.label}=${s.text}`).join('|'))
  const fullWidth = await readEvidenceDocument(await rawDocx(rp(rt('１ａ')) + rp(inlinePic('img1'))), { headings: ['1a'] })
  check('full-width "１ａ" is 1a', filed(fullWidth) === '1a=image1.png;unplaced=', filed(fullWidth))

  // The template's own repeated sub-part headings are not warned about.
  const subParts = await readEvidenceDocument(
    await rawDocx(rp(rt('3e (i) Animation'), 'Heading2') + rp(inlinePic('img1')) + rp(rt('3e (ii) Transitions'), 'Heading2') + rp(inlinePic('img2'))),
    { headings: ['3e'], templateParagraphs: ['3e (i) Animation', '3e (ii) Transitions'] },
  )
  check('template sub-part headings file under the label, no warning', filed(subParts) === '3e=image1.png,image2.png;unplaced=' && !subParts.warnings.some((w) => /more than once/.test(w)), `${filed(subParts)} ${subParts.warnings.join(' | ')}`)

  // The main part is wherever _rels/.rels says.
  const elsewhere = await readEvidenceDocument(await rawDocx(rp(rt('1a')) + rp(inlinePic('img1')), { mainPart: 'word/main.xml' }), { headings: ['1a'] })
  check('a main part other than word/document.xml is found through _rels/.rels', filed(elsewhere) === '1a=image1.png;unplaced=', filed(elsewhere))
  check('openDocxPackage reports the main part', (await openDocxPackage(await rawDocx(rp(rt('x')), { mainPart: 'word/main.xml' }))).mainPart === 'word/main.xml')
  check('openPackage keeps ppt/presentation.xml', (await openPackage(pptx0)).mainPart === 'ppt/presentation.xml')

  // ---- A linked picture and a missing one.
  const linked = await editDocx(await build([p('1a'), pic(images['LOGO.png'])]), async (zip) => {
    const relsPart = 'word/_rels/document.xml.rels'
    const rels = await zip.file(relsPart)!.async('string')
    zip.file(relsPart, rels.replace(/Target="media\/[^"]+"/, 'Target="file:///C:/shot.png" TargetMode="External"'))
  })
  const linkedRead = await readEvidenceDocument(linked, { headings: ['1a'] })
  check('a linked picture is not shown', linkedRead.sections[0]?.images.length === 0 && /linked/.test(linkedRead.sections[0]?.notShown[0]?.reason ?? ''), JSON.stringify(linkedRead.sections[0]?.notShown))
  const missing = await editDocx(await build([p('1a'), pic(images['LOGO.png'])]), async (zip) => {
    for (const name of Object.keys(zip.files)) if (name.startsWith('word/media/') && !zip.files[name].dir) zip.remove(name)
  })
  const missingRead = await readEvidenceDocument(missing, { headings: ['1a'] })
  check('a picture missing from the file is not shown', /missing/.test(missingRead.sections[0]?.notShown[0]?.reason ?? ''))

  // ---- readDocxText (a reference document).
  const reference = await build([h1('PEARL COAST'), p('Line one'), new Table({ rows: [new TableRow({ children: [new TableCell({ children: [p('cell A')] }), new TableCell({ children: [p('cell B')] })] })] }), p('')])
  const text = await readDocxText(reference)
  check('readDocxText gives the paragraphs, tables included, one per line', text === 'PEARL COAST\nLine one\ncell A\ncell B', JSON.stringify(text))
  const textBoxDoc = await editDocx(reference, async (zip) => {
    const xml = await zip.file('word/document.xml')!.async('string')
    zip.file('word/document.xml', xml.replace('<w:sectPr', `${TEXT_BOX}<w:sectPr`))
  })
  check('readDocxText reads text boxes', (await readDocxText(textBoxDoc)).endsWith('4d\nText box answer'))

  // ---- Refusals.
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(2048)])
  const encrypted = Buffer.concat([ole, Buffer.from('EncryptedPackage', 'utf16le'), Buffer.alloc(64)])
  const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256))
  const pptx = await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx'))
  const doctype = await editDocx(reference, async (zip) => {
    const xml = await zip.file('word/document.xml')!.async('string')
    zip.file('word/document.xml', xml.replace('?>', '?><!DOCTYPE w:document [<!ENTITY x "boom">]>'))
  })
  const cases: [string, Buffer, RegExp][] = [
    ['an old .doc (OLE) file', ole, /^This is an old \.doc file\. Open it in Word and save it as a \.docx\.$/],
    ['a password-protected .docx', encrypted, /^This Word file is password-protected\. Remove the password in Word and save it again\.$/],
    ['random bytes', random, /^This is not a Word \.docx file\.$/],
    ['a .pptx (a zip without word/document.xml)', pptx, /^This is not a Word \.docx file\.$/],
    ['a document with a DOCTYPE', doctype, /^This is not a Word \.docx file\.$/],
  ]
  for (const [name, bytes, pattern] of cases) {
    const error = await refusal(() => readEvidenceDocument(bytes, { headings: ['1a'] }))
    check(`refuses ${name}`, error instanceof DocxReadError && !(error instanceof PptxInspectError) && pattern.test(messageOf(error)), messageOf(error))
  }
  check('readDocxText refuses an old .doc too', messageOf(await refusal(() => readDocxText(ole))).startsWith('This is an old .doc file'))
  check('checkDocxFileType names the .doc', messageOf(await refusal(() => checkDocxFileType(ole))).startsWith('This is an old .doc file'))
  check('openDocxPackage opens a .docx', (await openDocxPackage(reference)).hasPart('word/document.xml'))

  // PowerPoint's refusals are unchanged.
  const pptxCases: [string, () => unknown, string][] = [
    ['checkFileType on a .ppt', () => checkFileType(ole), 'This is an old .ppt file. Open it in PowerPoint and save it as a .pptx.'],
    ['checkFileType on a protected file', () => checkFileType(encrypted), 'This PowerPoint file is password-protected. Remove the password in PowerPoint and save it again.'],
    ['openPackage on random bytes', () => openPackage(random), 'This is not a PowerPoint .pptx file.'],
    ['openPackage on a .docx', () => openPackage(reference), 'This is not a PowerPoint .pptx file.'],
  ]
  for (const [name, run, message] of pptxCases) {
    const error = await refusal(run)
    check(`${name} still refuses with PowerPoint wording`, error instanceof PptxInspectError && messageOf(error) === message, messageOf(error))
  }

  // ---- Poppler helpers on a pdfkit PDF.
  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.fontSize(20).text('HANDOUTS page one')
    doc.addPage().text('Second page NOTES')
    doc.addPage().text('Third page END')
    doc.end()
  })
  check('pdfPageCount counts the pages', (await pdfPageCount(pdf)) === 3)
  const full = await pdfText(pdf, { maxChars: 20_000 })
  check('pdfText reads every page', full.text.includes('HANDOUTS page one') && full.text.includes('Second page NOTES') && full.text.includes('Third page END') && !full.truncated, JSON.stringify(full.text.slice(0, 200)))
  check('pdfText separates pages with form feeds', (full.text.match(/\f/g) ?? []).length >= 2)
  const capped = await pdfText(pdf, { maxChars: 10 })
  check('pdfText caps at maxChars and says so', capped.text.length === 10 && capped.truncated && capped.chars === full.chars)
  const pngs = await pdfToPngPages(pdf, { dpi: 30 })
  const firstMeta = await sharp(pngs[0]).metadata()
  check('pdfToPngPages renders every page as PNG, in order', pngs.length === 3 && firstMeta.format === 'png' && Math.abs((firstMeta.width ?? 0) - (595.28 / 72) * 30) <= 1.5, `${pngs.length} ${firstMeta.format} ${firstMeta.width}`)
  const middle = await pdfToPngPages(pdf, { dpi: 30, firstPage: 2, lastPage: 3 })
  check('pdfToPngPages renders a page range', middle.length === 2 && Buffer.compare(middle[0], pngs[1]) === 0)
  check('pdfPageCount refuses a file that is not a PDF', messageOf(await refusal(() => pdfPageCount(random))) === 'Could not read the PDF. Is it a valid PDF file?')
  check('pdfText refuses a file that is not a PDF', messageOf(await refusal(() => pdfText(random, { maxChars: 100 }))) === 'Could not read the PDF. Is it a valid PDF file?')
  check('pdfToPngPages refuses a file that is not a PDF', messageOf(await refusal(() => pdfToPngPages(random, { dpi: 30 }))) === 'Failed to convert the PDF to images.')

  // ---- The presentation description by section.
  const known = await knownImagesFromFiles(IMAGE_FILES.map((name) => ({ name, bytes: images[name] })))
  for (const [label, report] of [
    ['without known images', await inspectPptx(pptx)],
    ['with known images', await inspectPptx(pptx, { knownImages: known })],
  ] as const) {
    const sections = describePresentationSections(report)
    check(`describePresentation is its sections joined (${label})`, describePresentation(report) === sections.map((s) => s.text).join('\n\n'))
    check(`every section starts with its title (${label})`, sections.every((s) => s.text.split('\n')[0] === s.title))
    check(`section keys are unique (${label})`, new Set(sections.map((s) => s.key)).size === sections.length)
  }
  const report = await inspectPptx(pptx, { knownImages: known })
  const sections = describePresentationSections(report)
  const keys = sections.map((s) => s.key).join(' ')
  check('section keys in description order', keys === 'presentation master:1 layouts slide:1 slide:2 slide:3 slide:4 slide:5 slide:6 action-buttons notes-master handout-master supplied-images media', keys)
  check('slide sections carry their title line', sections.find((s) => s.key === 'slide:3')?.title.startsWith('SLIDE 3 ') === true)
  const pick = (selectors?: string[]) => filterPresentationSections(sections, selectors).map((s) => s.key).join(' ')
  check('no selectors: everything but MEDIA', pick() === keys.replace(' media', ''), pick())
  check('an empty list is the default too', pick([]) === pick())
  check('"slides:3,6" picks those slides', pick(['slides:3,6']) === 'slide:3 slide:6', pick(['slides:3,6']))
  check('"slides" picks every slide', pick(['slides']) === 'slide:1 slide:2 slide:3 slide:4 slide:5 slide:6')
  check('"master" picks the slide masters', pick(['master']) === 'master:1')
  check('"notes" picks the notes and handout masters', pick(['notes']) === 'notes-master handout-master')
  check('selectors keep description order and never repeat', pick(['supplied-images', 'slides:2', 'slides', 'presentation']) === 'presentation slide:1 slide:2 slide:3 slide:4 slide:5 slide:6 supplied-images', pick(['supplied-images', 'slides:2', 'slides', 'presentation']))
  check('"media" can be asked for', pick(['media']) === 'media')
  check('an unknown selector or slide selects nothing', pick(['bogus', 'slides:9']) === '')
  check('selectors are validated', ['presentation', 'master', 'layouts', 'slides', 'slides:3,6', 'action-buttons', 'notes', 'supplied-images', 'media', 'warnings'].every(isPresentationSectionSelector) && !['slides:', 'slides:a', 'slide:3', 'bogus'].some(isPresentationSectionSelector))

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
