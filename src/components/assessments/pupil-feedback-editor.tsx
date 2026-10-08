'use client'

import { useState, useTransition } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FEEDBACK_MAX_ITEM_LENGTH, FEEDBACK_MAX_ITEMS } from '@/lib/assessments/limits'
import { updateAssessmentMarkAction, updateAssessmentPupilFeedbackAction } from '@/lib/server-updates'
import type { AssessmentPaperObjective, AssessmentPupilQuestionResult, AssessmentPupilResult } from '@/types'

import { PupilFeedbackView } from './pupil-feedback-view'

type Props = {
  result: AssessmentPupilResult
  objectives: AssessmentPaperObjective[]
  /** Edits need the pupil on the paper's roster; off-roster results are read-only. */
  editable: boolean
}

/** The shared feedback view plus teacher editing; every save is recorded as a teacher edit. */
export function PupilFeedbackEditor({ result: initial, objectives, editable }: Props) {
  const [result, setResult] = useState(initial)
  const [editing, setEditing] = useState<AssessmentPupilQuestionResult | null>(null)
  const [editingFeedback, setEditingFeedback] = useState(false)

  const ids = { assessmentId: result.assessment.assessment_id, pupilId: result.pupil_id }

  return (
    <>
      <PupilFeedbackView
        result={result}
        objectives={objectives}
        showProvenance
        feedbackActions={editable && (
          <Button variant="outline" size="sm" onClick={() => setEditingFeedback(true)}>
            <Pencil /> Edit what went well and targets
          </Button>
        )}
        renderQuestionActions={editable ? (question) => (
          <Button variant="ghost" size="sm" onClick={() => setEditing(question)} aria-label={`Edit ${question.label}`}>
            <Pencil /> Edit
          </Button>
        ) : undefined}
      />

      {editing && (
        <QuestionDialog
          key={editing.label}
          question={editing}
          onClose={() => setEditing(null)}
          onSave={async (awarded, whyNotAwarded, howToImprove) => {
            const { data, error } = await updateAssessmentMarkAction({
              ...ids,
              label: editing.label,
              awarded,
              whyNotAwarded,
              howToImprove,
            })
            if (error || !data) {
              toast.error(error ?? 'Could not save the mark')
              return false
            }
            setResult(data)
            toast.success(`${editing.label} saved`)
            return true
          }}
        />
      )}

      {editingFeedback && (
        <FeedbackDialog
          wentWell={result.went_well}
          targets={result.targets}
          onClose={() => setEditingFeedback(false)}
          onSave={async (wentWell, targets) => {
            const { data, error } = await updateAssessmentPupilFeedbackAction({ ...ids, wentWell, targets })
            if (error || !data) {
              toast.error(error ?? 'Could not save the feedback')
              return false
            }
            setResult(data)
            toast.success('Feedback saved')
            return true
          }}
        />
      )}
    </>
  )
}

function QuestionDialog({
  question,
  onClose,
  onSave,
}: {
  question: AssessmentPupilQuestionResult
  onClose: () => void
  onSave: (awarded: number, whyNotAwarded: string | null, howToImprove: string | null) => Promise<boolean>
}) {
  const [awarded, setAwarded] = useState(question.awarded === null ? '' : String(question.awarded))
  const [whyNotAwarded, setWhyNotAwarded] = useState(question.why_not_awarded ?? '')
  const [howToImprove, setHowToImprove] = useState(question.how_to_improve ?? '')
  const [pending, startTransition] = useTransition()

  const value = Number(awarded)
  const valid = awarded.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= question.max_marks

  const save = () => {
    startTransition(async () => {
      if (await onSave(value, whyNotAwarded.trim() || null, howToImprove.trim() || null)) onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {question.label}</DialogTitle>
          <DialogDescription>
            {question.objective_code} · out of {question.max_marks}. Saved marks are kept when results are re-imported.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {question.correct_answer && (
            <p className="text-sm"><span className="text-muted-foreground">Correct answer:</span> {question.correct_answer}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="awarded">Marks awarded</Label>
            <Input
              id="awarded"
              type="number"
              min={0}
              max={question.max_marks}
              step={1}
              value={awarded}
              onChange={(event) => setAwarded(event.target.value)}
              className="w-28"
            />
            {!valid && <p className="text-xs text-destructive">A whole number from 0 to {question.max_marks}.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="why-not">Why marks were not awarded</Label>
            <Textarea id="why-not" value={whyNotAwarded} onChange={(event) => setWhyNotAwarded(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="improve">How to improve</Label>
            <Textarea id="improve" value={howToImprove} onChange={(event) => setHowToImprove(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={!valid || pending}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const toLines = (items: string[]) => items.join('\n')
const fromLines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)

function FeedbackDialog({
  wentWell,
  targets,
  onClose,
  onSave,
}: {
  wentWell: string[]
  targets: string[]
  onClose: () => void
  onSave: (wentWell: string[], targets: string[]) => Promise<boolean>
}) {
  const [wentWellText, setWentWellText] = useState(toLines(wentWell))
  const [targetsText, setTargetsText] = useState(toLines(targets))
  const [pending, startTransition] = useTransition()

  const problem = (label: string, lines: string[]) => {
    if (lines.length > FEEDBACK_MAX_ITEMS) return `${label}: at most ${FEEDBACK_MAX_ITEMS} points (${lines.length} entered).`
    const long = lines.findIndex((line) => line.length > FEEDBACK_MAX_ITEM_LENGTH)
    return long >= 0 ? `${label}: point ${long + 1} is longer than ${FEEDBACK_MAX_ITEM_LENGTH} characters.` : null
  }
  const problems = [
    problem('What went well', fromLines(wentWellText)),
    problem('Your targets', fromLines(targetsText)),
  ].filter((p): p is string => p !== null)

  const save = () => {
    startTransition(async () => {
      if (await onSave(fromLines(wentWellText), fromLines(targetsText))) onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What went well and targets</DialogTitle>
          <DialogDescription>One point per line.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="went-well">What went well</Label>
            <Textarea id="went-well" rows={5} value={wentWellText} onChange={(event) => setWentWellText(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="targets">Your targets</Label>
            <Textarea id="targets" rows={5} value={targetsText} onChange={(event) => setTargetsText(event.target.value)} />
          </div>
          {problems.map((p) => (
            <p key={p} className="text-xs text-destructive">{p}</p>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || problems.length > 0}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
