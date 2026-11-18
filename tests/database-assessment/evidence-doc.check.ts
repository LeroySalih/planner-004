import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { readDocxParagraphs, readEvidenceDocument } from '@/lib/docx/evidence'

// A database assessment's EVIDENCE document read with the existing evidence
// reader: the Palm Grove Vets model answer under headings 1–9
// (screenshots) and B1–B8 (typed Section B answers), the blank template's
// paragraphs removed. The pictures per heading, the typed text, no template
// wording left in B1, and the "Name" / "Candidate number" lines before the
// first heading unplaced (teacher-only, never sent, not warned about). A
// template heading no question names ends the section before it. No database
// connection.
//   npx tsx tests/database-assessment/evidence-doc.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'database')
const SCREENSHOT_HEADINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const TEXT_HEADINGS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']
const EXPECTED_PICTURES = [3, 1, 1, 1, 2, 2, 2, 2, 1]

async function main() {
  const answer = await readFile(path.join(FIXTURES, 'palm-grove-evidence-model-answer.docx'))
  const template = await readFile(path.join(FIXTURES, 'palm-grove-evidence-template.docx'))
  const templateParagraphs = await readDocxParagraphs(template)
  const read = await readEvidenceDocument(answer, {
    headings: [...SCREENSHOT_HEADINGS, ...TEXT_HEADINGS],
    templateParagraphs,
  })
  const section = (label: string) => read.sections.find((s) => s.label === label)

  check('every heading is found', read.missingHeadings.length === 0, read.missingHeadings.join(','))
  const pictures = SCREENSHOT_HEADINGS.map((label) => section(label)?.images.length ?? -1)
  check('pictures per screenshot heading are 3,1,1,1,2,2,2,2,1', pictures.join(',') === EXPECTED_PICTURES.join(','), pictures.join(','))
  check('no picture DINO cannot show under a heading', read.sections.every((s) => s.notShown.length === 0),
    JSON.stringify(read.sections.filter((s) => s.notShown.length > 0).map((s) => s.label)))

  const typed = TEXT_HEADINGS.map((label) => [label, section(label)?.text.trim() ?? ''] as const)
  check('typed text under every Section B heading', typed.every(([, text]) => text.length > 0),
    typed.filter(([, text]) => !text).map(([label]) => label).join(','))
  const b1 = section('B1')?.text ?? ''
  check('B1 keeps none of the template wording',
    !b1.includes('PET ID is the primary key of the PETS table.') && !/\(a\)\s+State what is meant/.test(b1), JSON.stringify(b1))

  const sectionTexts = read.sections.map((s) => `${s.heading}\n${s.text}`).join('\n')
  check('no section holds the Name or Candidate number lines',
    !/\bName\s*:/i.test(sectionTexts) && !/Candidate number/i.test(sectionTexts), JSON.stringify(sectionTexts.slice(0, 300)))
  check('the Name line is unplaced', /\bName\b/i.test(read.unplaced.text), JSON.stringify(read.unplaced.text.slice(0, 200)))
  check('no warning: the Name lines before the first heading are expected', read.warnings.length === 0, read.warnings.join(' | '))

  // ---- Only headings 1 and 6 asked for: the template's headings 2–5 and 7–9
  // end the section before them, so nothing under them is credited to 1 or 6.
  const some = await readEvidenceDocument(answer, { headings: ['1', '6'], templateParagraphs })
  const own = (label: string) => some.sections.find((s) => s.label === label)
  check('section 1 has exactly its 3 pictures', own('1')?.images.length === 3, String(own('1')?.images.length))
  check('section 6 has exactly its 2 pictures', own('6')?.images.length === 2, String(own('6')?.images.length))
  check('the pictures under 2–5 and 7–9 are unplaced', some.unplaced.images.length === 10, String(some.unplaced.images.length))
  check('the Section B answers are unplaced, not under 6', !/One-to-many/.test(own('6')?.text ?? '') && /One-to-many/.test(some.unplaced.text),
    JSON.stringify(own('6')?.text))
  check('the unplaced content is warned about, plural',
    some.warnings.some((w) => /^\d+ paragraphs and 10 pictures are not under any task heading\.$/.test(w)), some.warnings.join(' | '))

  // ---- B1 asked for: its "(a)" / "(b)" sub-part lines stay under it.
  const b = await readEvidenceDocument(answer, { headings: ['B1'], templateParagraphs })
  check('B1 keeps both typed answers', /OWNER ID/.test(b.sections[0]?.text ?? '') && /uniquely identifies/.test(b.sections[0]?.text ?? ''),
    JSON.stringify(b.sections[0]?.text))
  check('…and ends at B2', !/One-to-many/.test(b.sections[0]?.text ?? ''), JSON.stringify(b.sections[0]?.text))

  // ---- Without a template no template heading is known: today's behaviour.
  const bare = await readEvidenceDocument(answer, { headings: ['1', '6'] })
  check('without a template section 1 runs on to 6', bare.sections.find((s) => s.label === '1')?.images.length === 3 + 1 + 1 + 1 + 2,
    String(bare.sections.find((s) => s.label === '1')?.images.length))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
