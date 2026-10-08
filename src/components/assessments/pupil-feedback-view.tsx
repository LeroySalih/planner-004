import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type {
  AssessmentPaperObjective,
  AssessmentPupilQuestionResult,
  AssessmentPupilResult,
} from '@/types'

import { formatAssessmentDate, percentOf, pupilName, SCORE_BAND_CLASSES, scoreBand } from './format'

type PupilFeedbackViewProps = {
  result: AssessmentPupilResult
  objectives: AssessmentPaperObjective[]
  /** Teacher-only extras; the pupil page leaves these out. */
  showProvenance?: boolean
  feedbackActions?: ReactNode
  renderQuestionActions?: (question: AssessmentPupilQuestionResult) => ReactNode
}

/**
 * One pupil's feedback on a paper, laid out like the printed feedback sheet.
 * Read-only and hook-free so the teacher and pupil pages can both render it.
 */
export function PupilFeedbackView({
  result,
  objectives,
  showProvenance = false,
  feedbackActions,
  renderQuestionActions,
}: PupilFeedbackViewProps) {
  const subtotalByCode = new Map(result.objectives.map((o) => [o.code, o]))

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg border bg-card p-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {result.assessment.title} · {formatAssessmentDate(result.assessment.assessed_on)}
          </p>
          <h2 className="text-2xl font-semibold">{pupilName(result)}</h2>
        </div>
        <div className="text-right">
          {result.marked_questions === 0 ? (
            <p className="text-xl font-semibold text-muted-foreground">Not marked yet</p>
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums">
                {result.total_awarded} / {result.total_available} · {result.percent}%
              </p>
              {result.marked_questions < result.question_count && (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {result.marked_questions} of {result.question_count} questions marked
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Objective</th>
              <th className="px-4 py-2 font-medium">What you were assessed on</th>
              <th className="px-4 py-2 text-right font-medium">Mark</th>
              <th className="px-4 py-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {objectives.map((objective) => {
              const subtotal = subtotalByCode.get(objective.code)
              const awarded = subtotal?.awarded ?? 0
              const available = subtotal?.available ?? 0
              return (
                <tr key={objective.code} className="border-b last:border-0">
                  <td className="px-4 py-2 align-top font-medium">{objective.code}</td>
                  <td className="px-4 py-2 align-top">
                    <p>{objective.title}</p>
                    {objective.learning_objective_title && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{objective.learning_objective_title}</p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right align-top tabular-nums">
                    {available > 0 ? `${awarded} / ${available}` : '–'}
                  </td>
                  <td className="px-4 py-2 text-right align-top tabular-nums">
                    {available > 0 ? `${percentOf(awarded, available)}%` : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        {feedbackActions && <div className="flex justify-end">{feedbackActions}</div>}
        <div className="grid gap-4 md:grid-cols-2">
          <FeedbackList title="What went well" items={result.went_well} />
          <FeedbackList title="Your targets" items={result.targets} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Question by question</h3>
        {result.questions.map((question) => (
          <QuestionCard
            key={question.label}
            question={question}
            showProvenance={showProvenance}
            actions={renderQuestionActions?.(question)}
          />
        ))}
      </section>
    </div>
  )
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {items.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      )}
    </section>
  )
}

function QuestionCard({
  question,
  showProvenance,
  actions,
}: {
  question: AssessmentPupilQuestionResult
  showProvenance: boolean
  actions?: ReactNode
}) {
  const marked = question.awarded !== null
  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{question.label}</h4>
          <span className="text-xs text-muted-foreground">{question.objective_code}</span>
          {showProvenance && question.provenance === 'teacher' && (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
              Teacher edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded px-2 py-0.5 text-sm font-medium tabular-nums',
              marked ? SCORE_BAND_CLASSES[scoreBand(question.awarded!, question.max_marks)] : 'bg-muted text-muted-foreground',
            )}
          >
            {marked ? question.awarded : '–'} / {question.max_marks}
          </span>
          {actions}
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        {question.correct_answer && <Detail term="Correct answer" value={question.correct_answer} />}
        {question.why_not_awarded && <Detail term="Why marks were not awarded" value={question.why_not_awarded} />}
        {question.how_to_improve && <Detail term="How to improve" value={question.how_to_improve} />}
      </dl>
    </article>
  )
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="whitespace-pre-line">{value}</dd>
    </div>
  )
}
