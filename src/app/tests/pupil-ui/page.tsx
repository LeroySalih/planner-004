import type { ReactNode } from "react"
import { pupilActivityFontClass } from "@/components/pupil-activity/fonts"
import {
  PupilActivityCard,
  type PupilActivityCardProps,
} from "@/components/pupil-activity/pupil-activity-card"

export const metadata = {
  title: "Pupil UI — activity variants",
}

// Shared feedback copy (rich text with <strong>) reused across released cards.
const shortAnswerFeedback: ReactNode[] = [
  <>
    Well done — &ldquo;ferrous metals&rdquo; is exactly right, and I&apos;m pleased you used the
    correct technical term rather than &ldquo;metals with iron in&rdquo;. That precision is what
    earns full marks here.
  </>,
  <>
    Remember the opposite group is <strong>non-ferrous</strong> metals — little or no iron, e.g.
    aluminium, copper and brass. Sorting metals into these two families will help you in the
    extraction and alloys topics coming up.
  </>,
  <>
    One thing to watch: if a question says &ldquo;name <em>and</em> give an example&rdquo;, be ready
    to add one such as steel or cast iron. Keep up the strong work.
  </>,
]

const mcqFeedback: ReactNode[] = [
  <>
    Spot on. Cast iron is a <strong>ferrous</strong> metal because iron is its main component —
    which is also why it rusts when exposed to water and air.
  </>,
  <>
    The other options are all non-ferrous: aluminium and copper are pure metals with no iron, and
    brass is an alloy of copper and zinc. None of them rust in the same way.
  </>,
]

const fileFeedback: ReactNode[] = [
  <>
    A clear, well-labelled diagram — the blast furnace stages are in the right order and your
    annotations for <strong>coke</strong>, <strong>limestone</strong> and <strong>iron ore</strong>{" "}
    are accurate.
  </>,
  <>
    To reach full marks, add the chemical equation for the reduction of iron(III) oxide and label
    where the slag is tapped off. Strong work overall.
  </>,
]

const variants: { label: string; props: PupilActivityCardProps }[] = [
  {
    label: "Short answer · Released",
    props: {
      question: "Name the category of metals that contain iron.",
      activityIndex: 9,
      activityTotal: 38,
      status: "released",
      body: { kind: "short_answer", answer: "Ferrous metals" },
      teacher: { name: "Mr Salih", initials: "MS" },
      releasedAt: "Released today · 16:04",
      score: { mark: "2/2", word: "Secure" },
      feedbackParagraphs: shortAnswerFeedback,
      lockedNote:
        "This answer is now locked. Reply to your teacher in the lesson if you have a question.",
    },
  },
  {
    label: "Short answer · In progress",
    props: {
      question: "Name the category of metals that contain iron.",
      activityIndex: 9,
      activityTotal: 38,
      status: "in_progress",
      progressRatio: 0.237,
      body: {
        kind: "short_answer",
        answer: "",
        placeholder: "Type your short answer…",
      },
      helperText: "You can edit your answer until your teacher marks the work.",
    },
  },
  {
    label: "Multiple choice · Released",
    props: {
      question: "Which of these is a ferrous metal?",
      activityIndex: 11,
      activityTotal: 38,
      status: "released",
      body: {
        kind: "mcq",
        options: [
          { key: "A", label: "Aluminium" },
          { key: "✓", label: "Cast iron", correct: true },
          { key: "C", label: "Copper" },
          { key: "D", label: "Brass" },
        ],
      },
      teacher: { name: "Mr Salih", initials: "MS" },
      releasedAt: "Released today · 16:04",
      score: { mark: "1/1", word: "Correct" },
      feedbackParagraphs: mcqFeedback,
      lockedNote: "This question is now locked and has been marked automatically.",
    },
  },
  {
    label: "Multiple choice · In progress",
    props: {
      question: "Which of these is a ferrous metal?",
      activityIndex: 11,
      activityTotal: 38,
      status: "in_progress",
      progressRatio: 0.42,
      body: {
        kind: "mcq",
        options: [
          { key: "A", label: "Aluminium" },
          { key: "B", label: "Cast iron" },
          { key: "C", label: "Copper" },
          { key: "D", label: "Brass" },
        ],
      },
      helperText: "Choose the best answer, then save.",
    },
  },
  {
    label: "File upload · Released",
    props: {
      question: "Upload your labelled diagram of the iron extraction process.",
      activityIndex: 14,
      activityTotal: 38,
      status: "released",
      body: {
        kind: "file_upload",
        file: { name: "diagram-iron.jpg", size: "1.2 MB" },
      },
      teacher: { name: "Mr Salih", initials: "MS" },
      releasedAt: "Released today · 16:04",
      score: { mark: "7/8", word: "Strong" },
      feedbackParagraphs: fileFeedback,
      lockedNote:
        "This submission is now locked. Reply to your teacher in the lesson if you have a question.",
    },
  },
  {
    label: "File upload · In progress",
    props: {
      question: "Upload your labelled diagram of the iron extraction process.",
      activityIndex: 14,
      activityTotal: 38,
      status: "in_progress",
      progressRatio: 0.66,
      body: {
        kind: "file_upload",
        file: { name: "diagram-iron.jpg", size: "1.2 MB" },
      },
      helperText: "Attach your diagram, then save to submit it for marking.",
    },
  },
]

export default function PupilUiTestPage() {
  return (
    <div className={`${pupilActivityFontClass} min-h-screen bg-pa-page px-5 py-12`}>
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-10 text-center">
          <h1 className="font-[family-name:var(--font-pa-head)] text-3xl font-semibold text-pa-ink">
            Pupil activity UI
          </h1>
          <p className="mt-2 text-sm text-pa-muted-1">
            Short answer, multiple choice and file upload — each in the released and in-progress
            states. The feedback bar toggles the written feedback.
          </p>
        </header>

        <div className="grid grid-cols-1 justify-items-center gap-x-8 gap-y-12 lg:grid-cols-2">
          {variants.map((variant) => (
            <div key={variant.label} className="w-full max-w-[540px]">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-pa-muted-2">
                {variant.label}
              </p>
              <PupilActivityCard {...variant.props} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
