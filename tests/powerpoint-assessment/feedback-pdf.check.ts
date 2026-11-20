import { randomUUID } from 'node:crypto'
import { createElement, type ReactElement } from 'react'

import { Document, Page, Text, renderToBuffer, type DocumentProps } from '@react-pdf/renderer'

import {
  groupFeedbackTasks,
  parseTaskTitles,
  questionTaskPart,
  readTaskTitles,
  type FeedbackPdfData,
  type FeedbackPdfQuestion,
} from '@/lib/assessment-paper/feedback-pdf'
import { pdfText } from '@/lib/pdf/poppler'
import { AssessmentPaperFeedbackDocument, practicalPartMarks } from '@/components/pdf/assessment-paper-feedback-document'

// The practical feedback PDF set out as the question paper: questions grouped
// into tasks by the leading part of their label, task titles read from the
// question paper's text, each part's marks line (green at full marks, "x of
// n" with the lost marks' advice in red, grey when not marked or not shown),
// and an assessment paper still rendered as the table. Pure, apart from
// pdftotext and readTaskTitles on an activity that does not exist (no
// fixtures written). The held-question case, on real rows, is in
// results.check.ts.
// Run with DATABASE_URL set and poppler-utils installed:
//   npx tsx tests/powerpoint-assessment/feedback-pdf.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

type Crit = FeedbackPdfQuestion['criteria'][number]
const ai = (howToImprove: string | null, whyNotAwarded: string | null = 'WHY'): Crit['feedback'] => ({ source: 'ai', whyNotAwarded, howToImprove })
const teacher = (text: string): Crit['feedback'] => ({ source: 'teacher', text })
const crit = (awarded: number | null, available: number, feedback: Crit['feedback'] = null): Crit => ({ description: 'SC', awarded, available, feedback })

function question(label: string, maxMarks: number, awarded: number | null, criteria: Crit[], extra: Partial<FeedbackPdfQuestion> = {}): FeedbackPdfQuestion {
  return { label, questionText: `Text of ${label}.`, maxMarks, awarded, answer: null, criteria, legacy: null, markScheme: 'SECRET-MARK-SCHEME', ...extra }
}

async function words(data: FeedbackPdfData) {
  const buffer = await renderToBuffer(createElement(AssessmentPaperFeedbackDocument, { data }) as unknown as ReactElement<DocumentProps>)
  return (await pdfText(Buffer.from(buffer), { maxChars: 100_000 })).text.replace(/\s+/g, ' ')
}

async function main() {
  // --- Labels into tasks and parts ------------------------------------------------
  const parts = ['1a', '1j', '2l', '10b', 'S1', 'S5', '7', 'q3'].map((label) => questionTaskPart(label))
  check('1a → task 1, (a); 10b → task 10, (b)', parts[0].group === '1' && parts[0].part === '(a)' && parts[2].group === '2' && parts[3].group === '10' && parts[3].part === '(b)', JSON.stringify(parts))
  check('S1, S5 → group S, shown as the label', parts[4].group === 'S' && parts[4].part === 'S1' && parts[5].group === 'S' && parts[5].part === 'S5')
  check('a label with no part letter shows itself', parts[6].group === '7' && parts[6].part === '7' && parts[7].group === 'Q' && parts[7].part === 'q3', JSON.stringify(parts.slice(6)))

  // --- Task titles from the question paper's text -----------------------------------
  const sample = [
    'Total: 45 marks       Section A: 37 marks (practical)          Section B: 8 marks (short answer)',
    'Section A – Practical (37 marks)',
    'Task 1 – Master slide (10 marks)',
    '   Task 2 — Slides (12 marks)        page 2',
    'Task 3 - Animations and transitions',
    'Task 4 – Hyperlinks (1 mark)',
    'Task 1 – A later mention (3 marks)',
    '\fSection B – Short answer (8 marks)',
  ].join('\n')
  const titles = parseTaskTitles(sample)
  check('en dash, with marks', titles.tasks['1'] === 'Master slide', JSON.stringify(titles))
  check('em dash, second column ignored', titles.tasks['2'] === 'Slides')
  check('hyphen, no marks suffix', titles.tasks['3'] === 'Animations and transitions')
  check('"1 mark" suffix dropped', titles.tasks['4'] === 'Hyperlinks')
  check('the first mention wins', !Object.values(titles.tasks).includes('A later mention'))
  check('Section B up to the first "(", not the summary line', titles.sectionB === 'Section B – Short answer', String(titles.sectionB))
  check('no matches → nothing', JSON.stringify(parseTaskTitles('Instructions\nAnswer every question.')) === JSON.stringify({ tasks: {}, sectionB: null }))

  // The same through pdftotext, from a PDF written here.
  const paper = await renderToBuffer(createElement(Document, null, createElement(Page, { size: 'A4' },
    createElement(Text, null, 'Section A – Practical (37 marks)'),
    createElement(Text, null, 'Task 1 – Master slide (10 marks)'),
    createElement(Text, null, 'Task 2 — Slides'),
    createElement(Text, null, 'Section B – Short answer (8 marks)'),
  )) as unknown as ReactElement<DocumentProps>)
  const fromPdf = parseTaskTitles((await pdfText(Buffer.from(paper), { maxChars: 100_000 })).text)
  check('through pdftotext', fromPdf.tasks['1'] === 'Master slide' && fromPdf.tasks['2'] === 'Slides' && fromPdf.sectionB === 'Section B – Short answer', JSON.stringify(fromPdf))
  const none = await readTaskTitles(randomUUID())
  check('readTaskTitles never throws: no activity or paper gives no titles', JSON.stringify(none) === JSON.stringify({ tasks: {}, sectionB: null }))

  // --- Grouping, headings and subtotals ----------------------------------------------
  const qs = [
    question('1a', 1, 1, [crit(1, 1)]),
    question('1b', 2, 1, [crit(1, 1), crit(0, 1, ai('HOW-1B'))]),
    question('2a', 1, null, [crit(null, 1)]),
    question('2b', 2, null, [crit(null, 1), crit(null, 1)]),
    question('S1', 1, 0, [crit(0, 1, teacher('TEACHER-S1'))]),
    question('S2', 2, 2, [crit(2, 2, ai('HOW-S2-FULL'))]),
  ]
  const tasks = groupFeedbackTasks(qs, titles)
  check('tasks in position order', tasks.map((t) => t.heading).join('|') === 'Task 1 – Master slide|Task 2 – Slides|Section B – Short answer', tasks.map((t) => t.heading).join('|'))
  check('parts', tasks.map((t) => t.parts.map((p) => p.part).join(',')).join('|') === '(a),(b)|(a),(b)|S1,S2')
  check('subtotals: null counts 0', tasks.map((t) => `${t.awarded}/${t.available}`).join('|') === '2/3|0/3|2/3', tasks.map((t) => `${t.awarded}/${t.available}`).join('|'))
  const bare = groupFeedbackTasks(qs, { tasks: {}, sectionB: null })
  check('no titles: Task N and Section B', bare.map((t) => t.heading).join('|') === 'Task 1|Task 2|Section B')
  const split = groupFeedbackTasks([question('1a', 1, 1, []), question('2a', 1, 1, []), question('1b', 1, 1, [])], titles)
  check('a group that comes back later starts a new task, keeping order', split.length === 3)

  // --- Each part's marks line ----------------------------------------------------------
  const full = practicalPartMarks(qs[0])
  check('full marks: green, "1 mark awarded"', full.tone === 'full' && full.text === '1 mark awarded' && full.lost.length === 0, JSON.stringify(full))
  check('full marks, plural, and no advice even when there is some', practicalPartMarks(qs[5]).text === '2 marks awarded' && practicalPartMarks(qs[5]).lost.length === 0)
  const partial = practicalPartMarks(qs[1])
  check('partial: "1 of 2 marks awarded", advice from the criterion that lost marks', partial.tone === 'lost' && partial.text === '1 of 2 marks awarded' && partial.lost.join() === 'HOW-1B', JSON.stringify(partial))
  const zero = practicalPartMarks(qs[4])
  check('zero: "0 of 1 mark awarded", the teacher\'s comment wins', zero.text === '0 of 1 mark awarded' && zero.lost.join() === 'TEACHER-S1', JSON.stringify(zero))
  const unmarked = practicalPartMarks(qs[2])
  check('not marked (or not shown): grey, no red', unmarked.tone === 'unmarked' && unmarked.text === 'Not marked yet' && unmarked.lost.length === 0)
  const fullCriterionAdvice = practicalPartMarks(question('3a', 2, 1, [crit(1, 1, ai('HOW-FULL-CRIT')), crit(0, 1, ai(null))]))
  check('advice only from criteria that lost marks; none → nothing extra', fullCriterionAdvice.lost.length === 0, JSON.stringify(fullCriterionAdvice))
  const blank = practicalPartMarks(question('3b', 1, 0, [crit(0, 1, ai(null, 'No answer submitted'))], { answer: { kind: 'text', status: 'blank', transcription: null, images: [] } }))
  check('a blank answer with no advice says so', blank.lost.join() === 'No answer submitted', JSON.stringify(blank))
  const legacy = practicalPartMarks(question('3c', 2, 1, [crit(1, 2, ai('HOW-LEGACY'))], { legacy: { feedback: ai('HOW-LEGACY') } }))
  check('a legacy mark: its advice once', legacy.lost.join() === 'HOW-LEGACY')

  // --- Rendered ---------------------------------------------------------------------------
  const base: FeedbackPdfData = {
    paperTitle: 'Orbit kiosk', pupilName: 'Test Pupil', fileName: 'Test Pupil - orbit-kiosk-feedback.pdf', className: '10X', maxMarks: 11, marksAwarded: 5,
    overallFeedback: 'OVERALL-COMMENT', folded: false, powerPoint: true, questions: qs, tasks,
  }
  const practical = await words(base)
  check('practical: headings with subtotals', practical.includes('Task 1 – Master slide') && practical.includes('2 / 3 marks') && practical.includes('Section B – Short answer'), practical.slice(0, 600))
  check('…part letters, question text and marks lines', practical.includes('(a)') && practical.includes('Text of 1b.') && practical.includes('1 of 2 marks awarded') && practical.includes('1 mark awarded') && practical.includes('Not marked yet'))
  check('…advice, title block and comment', practical.includes('HOW-1B') && practical.includes('TEACHER-S1') && practical.includes('Test Pupil') && practical.includes('5 / 11 marks') && practical.includes('OVERALL-COMMENT'))
  check('…no table, no mark scheme, no advice on full marks', !practical.includes('HOW TO IMPROVE') && !practical.includes('SECRET-MARK-SCHEME') && !practical.includes('HOW-S2-FULL'))

  const paperData: FeedbackPdfData = { ...base, powerPoint: false, tasks: null, questions: [question('1', 2, 1, [crit(1, 2, ai('HOW-PAPER'))])] }
  const paperWords = await words(paperData)
  check('an assessment paper still renders the table', paperWords.includes('HOW TO IMPROVE') && paperWords.includes('MARK SCHEME') && paperWords.replace(/ /g, '').includes('1/2') && paperWords.includes('HOW-PAPER') && !paperWords.includes('awarded'), paperWords.slice(0, 600))

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
