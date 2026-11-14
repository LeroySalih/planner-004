import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AssessmentQuestion } from '@/lib/assessment-paper/store'
import { inspectPptx } from '@/lib/pptx/inspect'
import { describePresentation, describePresentationSections, filterPresentationSections } from '@/lib/pptx/describe'
import { PRESENTATION_SECTION_KEYS, validateQuestionEvidence, type QuestionEvidence } from '@/lib/powerpoint-assessment/evidence-spec'
import { answerFor, slidesNotInPresentation, type SlotRead } from '@/lib/powerpoint-assessment/reading'
import { fromDraftSources, toDraftSources } from '@/components/lessons/question-evidence-editor'
import type { PowerPointUploadSlot } from '@/types'

// Pure, no database, no model: why a PowerPoint assessment question is blank
// (the 0's comment the reader hands completeAssessmentRead), the one-slides-
// list rule of validateQuestionEvidence, and the lesson editor's reading of
// stored sections (several slides lists joined; plain "slides" wins).
// Run with:
//   npx tsx tests/powerpoint-assessment/blank-reasons.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'pptx')

const SLOTS: PowerPointUploadSlot[] = [
  { key: 'deck', label: 'KIOSK', kind: 'pptx', required: true },
  { key: 'notes', label: 'NOTES', kind: 'pdf', required: false },
  { key: 'evidence', label: 'EVIDENCE', kind: 'docx', required: true },
]

function file(slot: string, name: string) {
  return {
    file_id: `file-${slot}`, activity_id: 'a', pupil_id: 'p', submission_id: 's', slot_key: slot,
    original_name: name, storage_path: `x/original.${name.split('.').pop()}`, bytes: 1, sha256: 'h',
    uploaded_by: 'p', uploaded_at: '2026-11-14', evidence_status: 'ok' as const, evidence_error: null,
  }
}

function question(label: string, evidence: QuestionEvidence[]): AssessmentQuestion {
  return { questionId: `q-${label}`, label, evidence } as unknown as AssessmentQuestion
}

async function main() {
  const report = await inspectPptx(await readFile(path.join(FIXTURES, 'pearl-kiosk-model-answer.pptx')))
  const slideCount = report.presentation.slideCount
  check('(fixture) the presentation has 6 slides', slideCount === 6, String(slideCount))

  const evidenceReport = {
    sections: [
      { label: 'E1', heading: 'E1', text: 'Only words here.', images: [], notShown: [] },
      { label: 'E2', heading: 'E2', text: '', images: [], notShown: [] },
    ],
    unplaced: { text: '', images: [], notShown: [] },
    missingHeadings: ['E9'],
    warnings: [],
    template: null,
  }
  const slots = (opts: { notes?: boolean } = {}): SlotRead[] => [
    {
      slot: SLOTS[0], file: file('deck', 'Pupil Secret Name.pptx'), cached: false, durationMs: 0,
      evidence: { kind: 'presentation', status: 'ok', report, description: describePresentation(report), slideImages: null },
    },
    opts.notes
      ? { slot: SLOTS[1], file: file('notes', 'n.pdf'), cached: false, durationMs: 0,
          evidence: { kind: 'pdf', status: 'ok', report: { pageCount: 1, text: 'x', chars: 1, truncated: false } } }
      : { slot: SLOTS[1], file: null, evidence: null, cached: false, durationMs: 0 },
    {
      slot: SLOTS[2], file: file('evidence', 'Pupil Secret Evidence.docx'), cached: false, durationMs: 0,
      evidence: { kind: 'evidence_doc', status: 'ok', report: evidenceReport },
    },
  ]

  const blankReason = (evidence: QuestionEvidence[], label = 'Q') => {
    const answer = answerFor(question(label, evidence), slots())
    return { status: answer.status, reason: answer.blankReason }
  }

  // --- Slides past the last one ---------------------------------------------------
  let r = blankReason([{ source: 'presentation', slot: 'deck', sections: ['slides:8'] }])
  check('one missing slide', r.status === 'blank' && r.reason === 'Slide 8 is not in your presentation.', JSON.stringify(r))
  r = blankReason([{ source: 'presentation', slot: 'deck', sections: ['slides:9,7'], required: true }])
  check('two missing slides, in order', r.reason === 'Slides 7 and 9 are not in your presentation.', JSON.stringify(r))
  r = blankReason([{ source: 'presentation', slot: 'deck', sections: ['slides:3,8'] }])
  check('a slide that is there: answered, no reason', r.status === 'answered' && r.reason === undefined, JSON.stringify(r))
  check('slidesNotInPresentation: none past the end', slidesNotInPresentation([{ key: 'slides', slides: [2, 6] }], 6) === undefined)
  check('slidesNotInPresentation: three', slidesNotInPresentation([{ key: 'slides', slides: [7, 8, 10] }], 6) === 'Slides 7, 8 and 10 are not in your presentation.')

  // --- A slot with no file --------------------------------------------------------
  r = blankReason([{ source: 'file', slot: 'notes', required: true }])
  check('a required slot not handed in', r.status === 'blank' && r.reason === 'You did not hand in NOTES.', JSON.stringify(r))

  // --- Evidence headings ------------------------------------------------------------
  r = blankReason([{ source: 'evidence_section', slot: 'evidence', heading: 'E9', want: 'screenshots', required: true }])
  check('a required heading not in the document', r.reason === 'There is no E9 section in your EVIDENCE.', JSON.stringify(r))
  r = blankReason([{ source: 'evidence_section', slot: 'evidence', heading: 'E1', want: 'screenshots', required: true }])
  check('a heading with no screenshot', r.reason === 'There is no screenshot under E1 in your EVIDENCE.', JSON.stringify(r))
  r = blankReason([{ source: 'evidence_section', slot: 'evidence', heading: 'E2', want: 'text', required: true }])
  check('a heading with no typed answer', r.reason === 'You did not write an answer under E2 in your EVIDENCE.', JSON.stringify(r))
  r = blankReason([{ source: 'evidence_section', slot: 'evidence', want: 'both' }], 'E2')
  check('a heading with nothing (want both, the label as heading)', r.reason === 'There is nothing under E2 in your EVIDENCE.', JSON.stringify(r))

  // --- Only the sources that made it blank are named ----------------------------------
  r = blankReason([
    { source: 'presentation', slot: 'deck', sections: ['slides:2'] },
    { source: 'evidence_section', slot: 'evidence', heading: 'E9', want: 'screenshots', required: true },
  ])
  check('a required source missing beside one that is there: only it is named', r.reason === 'There is no E9 section in your EVIDENCE.', JSON.stringify(r))
  r = blankReason([
    { source: 'presentation', slot: 'deck', sections: ['slides:7'] },
    { source: 'file', slot: 'notes' },
  ])
  check('nothing there at all: every source is named', r.reason === 'Slide 7 is not in your presentation. You did not hand in NOTES.', JSON.stringify(r))
  // A section the fixture does not have (not a slide number): nothing more to say.
  const sections = describePresentationSections(report)
  const absent = PRESENTATION_SECTION_KEYS.find((key) => key !== 'slides' && filterPresentationSections(sections, [key]).length === 0)
  check('(fixture) some section is not in the presentation', Boolean(absent))
  r = blankReason([{ source: 'presentation', slot: 'deck', sections: [absent ?? 'media'] }])
  check('no more to say: no reason (the store says "No answer submitted")', r.status === 'blank' && r.reason === undefined, JSON.stringify({ absent, r }))

  const all = [
    blankReason([{ source: 'presentation', slot: 'deck', sections: ['slides:8'] }]),
    blankReason([{ source: 'evidence_section', slot: 'evidence', heading: 'E9', want: 'screenshots', required: true }]),
  ]
  check('no pupil file name in any reason', all.every((x) => !/Secret|\.pptx|\.docx/.test(x.reason ?? '')), JSON.stringify(all))
  const answered = answerFor(question('A', [{ source: 'presentation', slot: 'deck', sections: ['slides:2'] }]), slots({ notes: true }))
  check('an answered question carries no blank reason', answered.status === 'answered' && !('blankReason' in answered))

  // --- One slides list per presentation source -------------------------------------
  const body = { uploadSlots: SLOTS }
  const validate = (sections: string[]) =>
    validateQuestionEvidence([{ label: 'Q', evidence: [{ source: 'presentation', slot: 'deck', sections }] }], body)
  let v = validate(['slides:3', 'slides:6'])
  check('two slides lists are refused', v.errors.length === 1 && v.errors[0].includes('use one slides list, e.g. slides:3,6'), v.errors.join(' | '))
  v = validate(['slides', 'slides:6'])
  check('"slides" with a slides list is refused', v.errors.length === 1 && v.errors[0].includes('one slides list'), v.errors.join(' | '))
  v = validate(['master', 'slides:3,6', 'supplied-images'])
  check('one slides list with other sections is fine', v.errors.length === 0, v.errors.join(' | '))
  v = validateQuestionEvidence([{ label: 'Q', evidence: [
    { source: 'presentation', slot: 'deck', sections: ['slides:3'] },
    { source: 'presentation', slot: 'deck', sections: ['slides:6'] },
  ] }], body)
  check('one slides list per source: two sources may each have one', v.errors.length === 0, v.errors.join(' | '))

  // --- The editor reads stored sections without losing slides -------------------------
  const roundTrip = (sections: string[]) =>
    (fromDraftSources(toDraftSources([{ source: 'presentation', slot: 'deck', sections }]), 'Q')[0] as { sections?: string[] }).sections
  const joined = toDraftSources([{ source: 'presentation', slot: 'deck', sections: ['slides:6', 'master', 'slides:3,6'] }])[0]
  check('several slides lists are joined in the editor', joined.onlySlides === '3, 6' && joined.sections.includes('slides') && joined.sections.includes('master'), JSON.stringify(joined))
  check('…and saved as one list', JSON.stringify(roundTrip(['slides:6', 'master', 'slides:3,6'])) === JSON.stringify(['master', 'slides:3,6']), JSON.stringify(roundTrip(['slides:6', 'master', 'slides:3,6'])))
  const every = toDraftSources([{ source: 'presentation', slot: 'deck', sections: ['slides:3', 'slides'] }])[0]
  check('plain "slides" means every slide', every.onlySlides === '' && every.sections.includes('slides'), JSON.stringify(every))
  check('…and is saved as "slides"', JSON.stringify(roundTrip(['slides:3', 'slides'])) === JSON.stringify(['slides']), JSON.stringify(roundTrip(['slides:3', 'slides'])))
  const saved = roundTrip(['slides:6', 'master', 'slides:3,6'])
  check('what the editor saves passes the check', validate(saved ?? []).errors.length === 0)

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
