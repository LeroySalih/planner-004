"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, ChevronDown, ChevronUp, FileText, Loader2, Plus, Sparkles, Trash2, Upload, X } from "lucide-react"

import {
  readAssessmentPaperSetupAction,
  saveAssessmentQuestionsAction,
  sendHeldAssessmentQuestionsAction,
  sendUnmarkedAssessmentScriptsAction,
  splitAssessmentMarkSchemeAction,
  uploadAssessmentPaperFileAction,
  type AssessmentPaperSetup,
  type MarkSchemeProposal,
} from "@/lib/server-updates"
import { AssessmentMarkSchemeToggle } from "@/components/lessons/assessment-mark-scheme-toggle"
import {
  QuestionEvidenceEditor,
  fromDraftSources,
  newDraftSource,
  toDraftSources,
  type DraftEvidenceSource,
} from "@/components/lessons/question-evidence-editor"
import { validateQuestionEvidence } from "@/lib/powerpoint-assessment/evidence-spec"
import type { PowerPointUploadSlot } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// Setup of an assessment-paper activity that already exists: the question
// paper (its page 1 the blank front sheet) and mark scheme, the questions with
// each one's marks split across its success criteria, and how the uploaded
// scripts fared in the front sheet check. Each part saves on its own; the
// sheet's Save button only saves the title and instructions.
//
// A PowerPoint assessment's questions are edited here too (`powerPoint`): each
// question also has its evidence sources, checked against the saved upload
// slots before saving, and there are pupils' files instead of scripts.

export interface AssessmentPaperCriterionOption {
  successCriteriaId: string
  title: string
  learningObjectiveTitle: string | null
}

interface DraftCriterion {
  successCriteriaId: string
  maxMarks: string
}

type QuestionMarking = AssessmentPaperSetup["questions"][number]["marking"]

const MARKING_OPTIONS: Array<{ value: QuestionMarking; label: string }> = [
  { value: "ai", label: "AI" },
  { value: "ai_check", label: "AI, teacher checks" },
  { value: "teacher", label: "Teacher only" },
]

const NO_DEPENDENCY = "none"

interface DraftQuestion {
  key: string
  label: string
  maxMarks: string
  questionText: string
  markScheme: string
  marking: QuestionMarking
  /** Key of the earlier draft question this one builds on, or null. */
  dependsOnKey: string | null
  criteria: DraftCriterion[]
  /** PowerPoint assessment only. */
  evidence: DraftEvidenceSource[]
}

// Server actions above ~12 MB are rejected before they reach the action
// (next.config bodySizeLimit), with an opaque error, so the editor stops first.
const EDITOR_UPLOAD_MAX_BYTES = 11 * 1024 * 1024

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `q-${Math.random().toString(36).slice(2, 10)}`
}

function toDraft(setup: AssessmentPaperSetup): DraftQuestion[] {
  const keyOfLabel = new Map(setup.questions.map((q) => [q.label, q.questionId]))
  return setup.questions.map((q) => ({
    key: q.questionId,
    label: q.label,
    maxMarks: String(q.maxMarks),
    questionText: q.questionText ?? "",
    markScheme: q.markScheme ?? "",
    marking: q.marking,
    dependsOnKey: q.dependsOn ? keyOfLabel.get(q.dependsOn) ?? null : null,
    criteria: q.criteria.map((c) => ({ successCriteriaId: c.successCriteriaId, maxMarks: String(c.maxMarks) })),
    evidence: toDraftSources(q.evidence ?? []),
  }))
}

/**
 * A save's or check's sentences, by the question they name ("Question "1a",
 * …"). Sentences naming no question are under the empty label.
 */
function problemsByLabel(errors: string[]): Map<string, string[]> {
  const byLabel = new Map<string, string[]>()
  for (const error of errors) {
    for (const part of error.split(/(?=Question ")/)) {
      const text = part.trim()
      if (!text) continue
      const label = /^Question "([^"]*)"/.exec(text)?.[1] ?? ""
      byLabel.set(label, [...(byLabel.get(label) ?? []), text])
    }
  }
  return byLabel
}

function parseWhole(value: string): number | null {
  if (!/^\s*\d+\s*$/.test(value)) return null
  return Number.parseInt(value, 10)
}

/** What is wrong with one question, or null. Mirrors the store's checks. */
function questionProblem(question: DraftQuestion, labels: string[], earlierKeys: Set<string>): string | null {
  const label = question.label.trim()
  if (!label) return "Needs a label."
  if (labels.filter((other) => other === label).length > 1) return "Label used twice."
  if (question.dependsOnKey && !earlierKeys.has(question.dependsOnKey)) {
    return "It can only build on an earlier question."
  }
  const max = parseWhole(question.maxMarks)
  if (max === null || max < 1) return "Marks must be a whole number, at least 1."
  if (question.criteria.length === 0) return "Choose at least one success criterion."
  if (question.criteria.some((c) => !c.successCriteriaId)) return "Choose a success criterion for each row."
  const allocations = question.criteria.map((c) => parseWhole(c.maxMarks))
  if (allocations.some((a) => a === null || a < 1)) return "Each criterion needs at least 1 mark."
  const total = allocations.reduce<number>((sum, a) => sum + (a ?? 0), 0)
  if (total !== max) return `Allocations add up to ${total} of ${max}.`
  return null
}

function allocationTotal(question: DraftQuestion) {
  return question.criteria.reduce((sum, c) => sum + (parseWhole(c.maxMarks) ?? 0), 0)
}

function nextLabel(questions: DraftQuestion[]) {
  const numbers = questions.map((q) => parseWhole(q.label)).filter((n): n is number => n !== null)
  return String((numbers.length > 0 ? Math.max(...numbers) : questions.length) + 1)
}

function buildPaperFileUrl(path: string) {
  return `/api/files/assessment-scripts/${path.split("/").map(encodeURIComponent).join("/")}`
}

interface AssessmentPaperEditorProps {
  activityId: string
  lessonCriteria: AssessmentPaperCriterionOption[]
  /** Called after anything is saved, so the lesson can refresh when the sheet closes. */
  onSaved?: () => void
  /**
   * PowerPoint assessment: its saved upload slots and the activity's own
   * files, for each question's evidence sources.
   */
  powerPoint?: { slots: PowerPointUploadSlot[]; referenceFiles: string[] }
  /** Called after the questions are saved. */
  onQuestionsSaved?: () => void
}

export function AssessmentPaperEditor({
  activityId,
  lessonCriteria,
  onSaved,
  powerPoint,
  onQuestionsSaved,
}: AssessmentPaperEditorProps) {
  const [setup, setSetup] = useState<AssessmentPaperSetup | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [questionsDirty, setQuestionsDirty] = useState(false)
  const [isSavingQuestions, setIsSavingQuestions] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)

  const [uploadingKind, setUploadingKind] = useState<"question_paper" | "mark_scheme" | null>(null)
  const questionPaperInputRef = useRef<HTMLInputElement | null>(null)
  const markSchemeInputRef = useRef<HTMLInputElement | null>(null)

  const [isSending, setIsSending] = useState(false)

  // The mark scheme split: the model's text per saved question, by question
  // id, until the teacher accepts it into the draft or dismisses it.
  const [proposals, setProposals] = useState<Map<string, MarkSchemeProposal>>(new Map())
  const [isSplitting, setIsSplitting] = useState(false)
  const [isSendingHeld, setIsSendingHeld] = useState(false)

  const applySetup = useCallback((next: AssessmentPaperSetup, options?: { keepQuestions?: boolean }) => {
    setSetup(next)
    if (!options?.keepQuestions) {
      setQuestions(toDraft(next))
      setQuestionsDirty(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    readAssessmentPaperSetupAction(activityId)
      .then((result) => {
        if (cancelled) return
        if (result.error || !result.data) {
          setLoadError(result.error ?? "Unable to load the assessment paper.")
          return
        }
        setLoadError(null)
        applySetup(result.data)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load the assessment paper.")
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activityId, applySetup])

  // The lesson's criteria, plus any a question already uses that the lesson no
  // longer lists (so a saved question never shows a blank picker).
  const criterionOptions = useMemo(() => {
    const options = new Map<string, AssessmentPaperCriterionOption>()
    for (const option of lessonCriteria) options.set(option.successCriteriaId, option)
    for (const question of setup?.questions ?? []) {
      for (const criterion of question.criteria) {
        if (!options.has(criterion.successCriteriaId)) {
          options.set(criterion.successCriteriaId, {
            successCriteriaId: criterion.successCriteriaId,
            title: criterion.description || "Success criterion",
            learningObjectiveTitle: "Not linked to this lesson",
          })
        }
      }
    }
    return Array.from(options.values())
  }, [lessonCriteria, setup])

  const criterionTitle = useMemo(
    () => new Map(criterionOptions.map((option) => [option.successCriteriaId, option.title])),
    [criterionOptions],
  )

  const labels = useMemo(() => questions.map((q) => q.label.trim()), [questions])
  const problems = useMemo(
    () => questions.map((q, index) => questionProblem(q, labels, new Set(questions.slice(0, index).map((e) => e.key)))),
    [questions, labels],
  )
  // A PowerPoint assessment's evidence, checked as the store will check it.
  const evidenceCheck = useMemo(() => {
    if (!powerPoint) return null
    const { errors } = validateQuestionEvidence(
      questions.map((q) => ({
        label: q.label.trim(),
        marking: q.marking,
        evidence: fromDraftSources(q.evidence, q.label),
      })),
      { uploadSlots: powerPoint.slots },
    )
    return problemsByLabel(errors)
  }, [powerPoint, questions])
  const serverProblems = useMemo(() => problemsByLabel(questionsError ? [questionsError] : []), [questionsError])
  const questionsValid =
    problems.every((p) => p === null) && (!evidenceCheck || evidenceCheck.size === 0)
  const draftTotal = useMemo(
    () => questions.reduce((sum, q) => sum + (parseWhole(q.maxMarks) ?? 0), 0),
    [questions],
  )

  const updateQuestions = (updater: (current: DraftQuestion[]) => DraftQuestion[]) => {
    setQuestions((current) => updater(current))
    setQuestionsDirty(true)
    setQuestionsError(null)
  }

  const updateQuestion = (key: string, patch: Partial<DraftQuestion>) => {
    updateQuestions((current) =>
      current.map((q) => {
        if (q.key !== key) return q
        const next = { ...q, ...patch }
        // A question with one criterion gives it all its marks.
        if (patch.maxMarks !== undefined && next.criteria.length === 1) {
          next.criteria = [{ ...next.criteria[0], maxMarks: patch.maxMarks }]
        }
        return next
      }),
    )
  }

  const addQuestion = () => {
    updateQuestions((current) => [
      ...current,
      {
        key: newKey(),
        label: nextLabel(current),
        maxMarks: "1",
        questionText: "",
        markScheme: "",
        marking: "ai",
        dependsOnKey: null,
        criteria: [],
        // A new question reads the presentation until told otherwise.
        evidence: powerPoint ? [newDraftSource("presentation", powerPoint.slots, powerPoint.referenceFiles)] : [],
      },
    ])
  }

  const moveQuestion = (index: number, delta: -1 | 1) => {
    updateQuestions((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = current.slice()
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const removeQuestion = (key: string) => {
    updateQuestions((current) =>
      current
        .filter((q) => q.key !== key)
        .map((q) => (q.dependsOnKey === key ? { ...q, dependsOnKey: null } : q)),
    )
  }

  const addCriterion = (key: string) => {
    updateQuestions((current) =>
      current.map((q) => {
        if (q.key !== key) return q
        const remaining = (parseWhole(q.maxMarks) ?? 0) - allocationTotal(q)
        return {
          ...q,
          criteria: [...q.criteria, { successCriteriaId: "", maxMarks: String(remaining >= 1 ? remaining : 1) }],
        }
      }),
    )
  }

  const updateCriterion = (key: string, index: number, patch: Partial<DraftCriterion>) => {
    updateQuestions((current) =>
      current.map((q) =>
        q.key === key
          ? { ...q, criteria: q.criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)) }
          : q,
      ),
    )
  }

  const removeCriterion = (key: string, index: number) => {
    updateQuestions((current) =>
      current.map((q) => (q.key === key ? { ...q, criteria: q.criteria.filter((_, i) => i !== index) } : q)),
    )
  }

  const handleSaveQuestions = async () => {
    if (!questionsValid) return
    setIsSavingQuestions(true)
    setQuestionsError(null)
    try {
      const labelOfKey = new Map(questions.map((q) => [q.key, q.label.trim()]))
      const payload = questions.map((q) => ({
        label: q.label.trim(),
        maxMarks: parseWhole(q.maxMarks) ?? 0,
        questionText: q.questionText.trim() || null,
        markScheme: q.markScheme.trim() || null,
        marking: q.marking,
        dependsOn: q.dependsOnKey ? labelOfKey.get(q.dependsOnKey) ?? null : null,
        criteria: q.criteria.map((c) => ({
          successCriteriaId: c.successCriteriaId,
          maxMarks: parseWhole(c.maxMarks) ?? 0,
        })),
        ...(powerPoint ? { evidence: fromDraftSources(q.evidence, q.label) } : {}),
      }))
      const result = await saveAssessmentQuestionsAction(activityId, payload)
      if (result.error || !result.data) {
        setQuestionsError(result.error ?? "Unable to save the questions.")
        toast.error("Questions not saved", { description: result.error ?? "Please try again." })
        return
      }
      applySetup(result.data)
      toast.success("Questions saved", {
        description: `The ${powerPoint ? "assessment" : "paper"} is out of ${result.data.maxMarks}.`,
      })
      onSaved?.()
      onQuestionsSaved?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the questions."
      setQuestionsError(message)
      toast.error("Questions not saved", { description: message })
    } finally {
      setIsSavingQuestions(false)
    }
  }

  const handleUpload = async (kind: "question_paper" | "mark_scheme", file: File | undefined) => {
    if (!file) return
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    if (!isPdf) {
      toast.error("Upload a PDF.")
      return
    }
    if (file.size > EDITOR_UPLOAD_MAX_BYTES) {
      toast.error("File too large for the editor", {
        description: "Files over 11 MB must be uploaded with an MCP upload link.",
      })
      return
    }
    setUploadingKind(kind)
    try {
      const formData = new FormData()
      formData.append("activityId", activityId)
      formData.append("kind", kind)
      formData.append("file", file)
      const result = await uploadAssessmentPaperFileAction(formData)
      if (result.error || !result.data) {
        toast.error("Upload failed", { description: result.error ?? "Please try again." })
        return
      }
      applySetup(result.data, { keepQuestions: questionsDirty })
      onSaved?.()
      toast.success(kind === "question_paper" ? "Question paper uploaded" : "Mark scheme uploaded")
    } catch (error) {
      toast.error("Upload failed", { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setUploadingKind(null)
    }
  }

  const handleSplitMarkScheme = async () => {
    setIsSplitting(true)
    try {
      const result = await splitAssessmentMarkSchemeAction(activityId)
      if (result.error || !result.data) {
        toast.error("Mark scheme not split", { description: result.error ?? "Please try again." })
        return
      }
      // Only a change is worth reviewing, or a question still without text
      // that the mark scheme did not cover.
      const changed = result.data.proposals.filter((proposal) =>
        proposal.proposed === null ? !proposal.current?.trim() : proposal.proposed !== (proposal.current ?? "").trim(),
      )
      setProposals(new Map(changed.map((proposal) => [proposal.questionId, proposal])))
      const found = result.data.proposals.filter((proposal) => proposal.proposed).length
      toast.success("Mark scheme split", {
        description: `Text found for ${found} of ${result.data.proposals.length} questions. Review it beside each question; nothing is saved until you accept it and save the questions.`,
      })
    } catch (error) {
      toast.error("Mark scheme not split", { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setIsSplitting(false)
    }
  }

  const dismissProposal = (questionId: string) => {
    setProposals((current) => {
      const next = new Map(current)
      next.delete(questionId)
      return next
    })
  }

  const acceptProposal = (questionId: string) => {
    const proposal = proposals.get(questionId)
    if (!proposal?.proposed) return
    updateQuestion(questionId, { markScheme: proposal.proposed })
    dismissProposal(questionId)
  }

  const acceptAllProposals = () => {
    const accepted = new Map(
      Array.from(proposals.values()).flatMap((proposal) =>
        proposal.proposed ? [[proposal.questionId, proposal.proposed] as const] : [],
      ),
    )
    updateQuestions((current) =>
      current.map((q) => (accepted.has(q.key) ? { ...q, markScheme: accepted.get(q.key)! } : q)),
    )
    setProposals((current) => new Map(Array.from(current).filter(([questionId]) => !accepted.has(questionId))))
  }

  const handleSendHeld = async () => {
    setIsSendingHeld(true)
    try {
      const result = await sendHeldAssessmentQuestionsAction(activityId)
      if (result.error || !result.data) {
        toast.error("Questions not sent", { description: result.error ?? "Please try again." })
        return
      }
      applySetup(result.data.setup, { keepQuestions: questionsDirty })
      onSaved?.()
      const { sent, pupils } = result.data
      const questionsSent = `${sent} question${sent === 1 ? "" : "s"}`
      toast.success(
        result.data.setup.powerpoint
          ? `${questionsSent} for ${pupils} pupil${pupils === 1 ? "" : "s"} sent for marking`
          : `${questionsSent} on ${pupils} script${pupils === 1 ? "" : "s"} sent for marking`,
      )
    } catch (error) {
      toast.error("Questions not sent", { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setIsSendingHeld(false)
    }
  }

  const handleSendUnmarked = async () => {
    const notSent = setup?.powerpoint ? "Work not sent" : "Scripts not sent"
    setIsSending(true)
    try {
      const result = await sendUnmarkedAssessmentScriptsAction(activityId)
      if (result.error || !result.data) {
        toast.error(notSent, { description: result.error ?? "Please try again." })
        return
      }
      applySetup(result.data.setup, { keepQuestions: questionsDirty })
      onSaved?.()
      const sent = result.data.sent
      toast.success(
        result.data.setup.powerpoint
          ? `${sent} pupil${sent === 1 ? "'s" : "s'"} work sent for marking`
          : `${sent} script${sent === 1 ? "" : "s"} sent for marking`,
      )
    } catch (error) {
      toast.error(notSent, { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setIsSending(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the assessment paper…
      </div>
    )
  }

  if (loadError || !setup) {
    return <p className="text-sm text-destructive">{loadError ?? "Unable to load the assessment paper."}</p>
  }

  const checks = setup.frontSheetChecks

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <span>
          <span className="text-muted-foreground">Total marks: </span>
          <span className="font-semibold text-foreground">{setup.maxMarks}</span>
          {questionsDirty && draftTotal !== setup.maxMarks ? (
            <span className="text-muted-foreground"> ({draftTotal} once saved)</span>
          ) : null}
        </span>
        <span>
          <span className="text-muted-foreground">Questions: </span>
          <span className="font-semibold text-foreground">{setup.questions.length}</span>
        </span>
        {setup.powerpoint ? (
          <span>
            <span className="text-muted-foreground">Pupils with files: </span>
            <span className="font-semibold text-foreground">{setup.powerpoint.pupilsWithFiles}</span>
            <span className="text-muted-foreground"> ({setup.powerpoint.handedIn} handed in)</span>
          </span>
        ) : (
          <span>
            <span className="text-muted-foreground">Scripts uploaded: </span>
            <span className="font-semibold text-foreground">{setup.scriptsCount}</span>
          </span>
        )}
      </div>

      {/* Paper files */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Question paper and mark scheme</h3>
        {powerPoint ? (
          <p className="text-xs text-muted-foreground">
            Pupils can open the question paper; the mark scheme is only for you and the marker. Split it by question
            to fill each question&apos;s mark scheme extract.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Page 1 of the question paper must be its blank front sheet, the only place pupils write their name. Each
            script&apos;s page 1 is checked against it and is never sent to the marker.
          </p>
        )}
        {(
          [
            { kind: "question_paper", label: "Question paper", path: setup.questionPaperPath, ref: questionPaperInputRef },
            { kind: "mark_scheme", label: "Mark scheme", path: setup.markSchemePath, ref: markSchemeInputRef },
          ] as const
        ).map((entry) => (
          <div
            key={entry.kind}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{entry.label}</span>
              {entry.path ? (
                <a
                  href={buildPaperFileUrl(entry.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Open
                </a>
              ) : (
                <span className="text-muted-foreground">Not uploaded</span>
              )}
            </div>
            <input
              ref={entry.ref}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                void handleUpload(entry.kind, file)
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploadingKind !== null}
              onClick={() => entry.ref.current?.click()}
            >
              {uploadingKind === entry.kind ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              {entry.path ? "Replace" : "Upload PDF"}
            </Button>
          </div>
        ))}
        <AssessmentMarkSchemeToggle
          activityId={activityId}
          initialShow={setup.showMarkSchemeToPupils}
          onSaved={onSaved}
        />
      </section>

      {/* Questions */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Questions</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSplitMarkScheme}
              disabled={isSplitting || isSavingQuestions || !setup.markSchemePath || setup.questions.length === 0}
              title={
                !setup.markSchemePath
                  ? "Upload the mark scheme first"
                  : setup.questions.length === 0
                    ? "Save the questions first"
                    : "Ask the AI to copy each question's part of the mark scheme for you to review"
              }
            >
              {isSplitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
              Split the mark scheme by question
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={addQuestion} disabled={isSavingQuestions}>
              <Plus className="mr-1 h-4 w-4" /> Add question
            </Button>
          </div>
        </div>
        {proposals.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {proposals.size} question{proposals.size === 1 ? " has" : "s have"} mark scheme text proposed from the PDF.
              Review it beside each question; accepted text is saved when you save the questions.
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setProposals(new Map())}>
                Dismiss all
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={acceptAllProposals}
                disabled={isSavingQuestions || !Array.from(proposals.values()).some((proposal) => proposal.proposed)}
              >
                <Check className="mr-1 h-4 w-4" /> Accept all
              </Button>
            </div>
          </div>
        ) : null}
        {criterionOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Link success criteria to this lesson first: each question&apos;s marks are split across the lesson&apos;s criteria.
          </p>
        ) : null}
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions yet.</p>
        ) : (
          <ol className="space-y-3">
            {questions.map((question, index) => {
              const max = parseWhole(question.maxMarks) ?? 0
              const total = allocationTotal(question)
              const problem = problems[index]
              const usedIds = new Set(question.criteria.map((c) => c.successCriteriaId))
              return (
                <li
                  key={question.key}
                  className={cn(
                    "space-y-3 rounded-md border p-3",
                    problem ? "border-destructive/50" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-24 space-y-1">
                      <Label className="text-xs text-muted-foreground" htmlFor={`q-label-${question.key}`}>
                        Label
                      </Label>
                      <Input
                        id={`q-label-${question.key}`}
                        value={question.label}
                        onChange={(event) => updateQuestion(question.key, { label: event.target.value })}
                        disabled={isSavingQuestions}
                      />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs text-muted-foreground" htmlFor={`q-marks-${question.key}`}>
                        Marks
                      </Label>
                      <Input
                        id={`q-marks-${question.key}`}
                        type="number"
                        min={1}
                        step={1}
                        value={question.maxMarks}
                        onChange={(event) => updateQuestion(question.key, { maxMarks: event.target.value })}
                        disabled={isSavingQuestions}
                      />
                    </div>
                    <div className="ml-auto flex gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Move question up"
                        disabled={index === 0 || isSavingQuestions}
                        onClick={() => moveQuestion(index, -1)}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Move question down"
                        disabled={index === questions.length - 1 || isSavingQuestions}
                        onClick={() => moveQuestion(index, 1)}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove question"
                        disabled={isSavingQuestions}
                        onClick={() => removeQuestion(question.key)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground" htmlFor={`q-text-${question.key}`}>
                        Question text (optional)
                      </Label>
                      <Textarea
                        id={`q-text-${question.key}`}
                        rows={2}
                        value={question.questionText}
                        onChange={(event) => updateQuestion(question.key, { questionText: event.target.value })}
                        disabled={isSavingQuestions}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground" htmlFor={`q-scheme-${question.key}`}>
                        Mark scheme extract (needed for AI marking)
                      </Label>
                      <Textarea
                        id={`q-scheme-${question.key}`}
                        rows={2}
                        value={question.markScheme}
                        onChange={(event) => updateQuestion(question.key, { markScheme: event.target.value })}
                        disabled={isSavingQuestions}
                      />
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Marked by</Label>
                      <Select
                        value={question.marking}
                        onValueChange={(value) => updateQuestion(question.key, { marking: value as QuestionMarking })}
                        disabled={isSavingQuestions}
                      >
                        <SelectTrigger aria-label={`Who marks question ${question.label}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MARKING_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Builds on (error carried forward)</Label>
                      <Select
                        value={question.dependsOnKey ?? NO_DEPENDENCY}
                        onValueChange={(value) =>
                          updateQuestion(question.key, { dependsOnKey: value === NO_DEPENDENCY ? null : value })
                        }
                        disabled={isSavingQuestions || index === 0}
                      >
                        <SelectTrigger aria-label={`Question ${question.label} builds on`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_DEPENDENCY}>No earlier question</SelectItem>
                          {questions.slice(0, index).map((earlier) => (
                            <SelectItem key={earlier.key} value={earlier.key}>
                              Question {earlier.label.trim() || "(no label)"}
                            </SelectItem>
                          ))}
                          {question.dependsOnKey &&
                          !questions.slice(0, index).some((earlier) => earlier.key === question.dependsOnKey) ? (
                            <SelectItem value={question.dependsOnKey}>A later question (move it first)</SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {proposals.has(question.key) ? (
                    <MarkSchemeProposalBox
                      proposal={proposals.get(question.key)!}
                      disabled={isSavingQuestions}
                      onAccept={() => acceptProposal(question.key)}
                      onDismiss={() => dismissProposal(question.key)}
                    />
                  ) : null}
                  {question.marking !== "teacher" && !question.markScheme.trim() ? (
                    <p className="text-xs text-muted-foreground">
                      With no mark scheme extract this question is not sent to the marker; you mark it on the results page.
                    </p>
                  ) : null}

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Success criteria and their marks</Label>
                    {question.criteria.map((criterion, criterionIndex) => (
                      <div key={criterionIndex} className="flex items-center gap-2">
                        <Select
                          value={criterion.successCriteriaId || undefined}
                          onValueChange={(value) =>
                            updateCriterion(question.key, criterionIndex, { successCriteriaId: value })
                          }
                          disabled={isSavingQuestions}
                        >
                          <SelectTrigger className="min-w-0 flex-1 [&>span]:truncate">
                            <SelectValue placeholder="Choose a success criterion" />
                          </SelectTrigger>
                          <SelectContent className="max-w-[min(90vw,40rem)]">
                            {criterionOptions
                              .filter(
                                (option) =>
                                  option.successCriteriaId === criterion.successCriteriaId ||
                                  !usedIds.has(option.successCriteriaId),
                              )
                              .map((option) => (
                                <SelectItem key={option.successCriteriaId} value={option.successCriteriaId}>
                                  <span className="whitespace-normal">
                                    {option.title}
                                    {option.learningObjectiveTitle ? (
                                      <span className="text-muted-foreground"> · {option.learningObjectiveTitle}</span>
                                    ) : null}
                                  </span>
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          className="w-20"
                          aria-label={`Marks for ${criterionTitle.get(criterion.successCriteriaId) ?? "this criterion"}`}
                          value={criterion.maxMarks}
                          onChange={(event) =>
                            updateCriterion(question.key, criterionIndex, { maxMarks: event.target.value })
                          }
                          disabled={isSavingQuestions}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Remove criterion"
                          disabled={isSavingQuestions}
                          onClick={() => removeCriterion(question.key, criterionIndex)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => addCriterion(question.key)}
                        disabled={isSavingQuestions || question.criteria.length >= criterionOptions.length}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Add criterion
                      </Button>
                      <span
                        className={cn(
                          "text-xs",
                          total === max && max > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                        )}
                      >
                        Allocations add up to {total} of {max}
                      </span>
                    </div>
                    {problem && !problem.startsWith("Allocations") ? (
                      <p className="text-xs text-destructive">{problem}</p>
                    ) : null}
                  </div>

                  {powerPoint ? (
                    <div className="space-y-1">
                      <QuestionEvidenceEditor
                        questionKey={question.key}
                        questionLabel={question.label}
                        sources={question.evidence}
                        slots={powerPoint.slots}
                        referenceFiles={powerPoint.referenceFiles}
                        disabled={isSavingQuestions}
                        onChange={(evidence) => updateQuestion(question.key, { evidence })}
                      />
                      {[
                        ...(evidenceCheck?.get(question.label.trim()) ?? []),
                        ...(serverProblems.get(question.label.trim()) ?? []).filter(
                          (text) => !(evidenceCheck?.get(question.label.trim()) ?? []).includes(text),
                        ),
                      ].map((text) => (
                        <p key={text} className="text-xs text-destructive">
                          {text}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
        {evidenceCheck?.get("")?.map((text) => (
          <p key={text} className="text-sm text-destructive">
            {text}
          </p>
        ))}
        {questionsError ? <p className="text-sm text-destructive">{questionsError}</p> : null}
        <div className="flex items-center justify-end gap-2">
          {questionsDirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSavingQuestions}
              onClick={() => {
                setQuestions(toDraft(setup))
                setQuestionsDirty(false)
                setQuestionsError(null)
              }}
            >
              Discard changes
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={handleSaveQuestions}
            disabled={!questionsDirty || !questionsValid || isSavingQuestions}
          >
            {isSavingQuestions ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save questions
          </Button>
        </div>
      </section>

      {/* Scripts, or a PowerPoint assessment's pupils' files */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{setup.powerpoint ? "Pupils' files" : "Scripts"}</h3>
        {setup.powerpoint ? (
          <p className="text-sm text-muted-foreground">
            {setup.powerpoint.pupilsWithFiles === 0
              ? "No pupil has uploaded files yet."
              : `${setup.powerpoint.pupilsWithFiles} pupil${setup.powerpoint.pupilsWithFiles === 1 ? " has" : "s have"} uploaded files; ${setup.powerpoint.handedIn} handed in. Marking starts when a pupil hands in.`}
          </p>
        ) : setup.scriptsCount === 0 ? (
          <p className="text-sm text-muted-foreground">No scripts uploaded yet.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Front sheet check: {checks.passed} passed, {checks.failed} held
            {checks.unchecked > 0 ? `, ${checks.unchecked} not checked (uploaded before the front sheet)` : ""}.
            {checks.failed > 0 ? " A held script is not marked; fix its page order and upload it again." : ""}
          </p>
        )}
        {setup.awaitingCheck.questions > 0 ? (
          <p className="text-sm text-muted-foreground">
            {setup.awaitingCheck.questions} marked question{setup.awaitingCheck.questions === 1 ? "" : "s"} on{" "}
            {setup.awaitingCheck.pupils} pupil
            {setup.awaitingCheck.pupils === 1
              ? setup.powerpoint ? "'s work" : "'s script"
              : setup.powerpoint ? "s' work" : "s' scripts"}{" "}
            {setup.awaitingCheck.questions === 1 ? "awaits" : "await"} your check on the results page.
          </p>
        ) : null}
        {setup.heldToSend.questions > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {setup.heldToSend.questions} question{setup.heldToSend.questions === 1 ? "" : "s"} on{" "}
              {setup.heldToSend.pupils} {setup.powerpoint ? "pupil" : "script"}
              {setup.heldToSend.pupils === 1 ? (setup.powerpoint ? "'s work was" : " was") : setup.powerpoint ? "s' work was" : "s were"} held for want of a
              mark scheme and can be marked now.
            </span>
            <Button
              type="button"
              size="sm"
              onClick={handleSendHeld}
              disabled={isSendingHeld || questionsDirty}
              title={questionsDirty ? "Save the questions first" : undefined}
            >
              {isSendingHeld ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Send held questions
            </Button>
          </div>
        ) : null}
        {setup.unmarkedScriptsCount > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {setup.powerpoint
                ? `${setup.unmarkedScriptsCount} pupil${setup.unmarkedScriptsCount === 1 ? "'s" : "s'"} handed-in work has not been marked yet.`
                : `${setup.unmarkedScriptsCount} script${setup.unmarkedScriptsCount === 1 ? " has" : "s have"} not been marked yet.`}
            </span>
            <Button type="button" size="sm" onClick={handleSendUnmarked} disabled={isSending}>
              {isSending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {setup.powerpoint
                ? `Send ${setup.unmarkedScriptsCount} pupil${setup.unmarkedScriptsCount === 1 ? "'s" : "s'"} work for marking`
                : `Send ${setup.unmarkedScriptsCount} unmarked script${setup.unmarkedScriptsCount === 1 ? "" : "s"} for marking`}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function MarkSchemeProposalBox({
  proposal,
  disabled,
  onAccept,
  onDismiss,
}: {
  proposal: MarkSchemeProposal
  disabled: boolean
  onAccept: () => void
  onDismiss: () => void
}) {
  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">Proposed from the mark scheme PDF</span>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss} disabled={disabled}>
            Dismiss
          </Button>
          {proposal.proposed ? (
            <Button type="button" size="sm" variant="outline" onClick={onAccept} disabled={disabled}>
              <Check className="mr-1 h-4 w-4" /> Accept
            </Button>
          ) : null}
        </div>
      </div>
      {proposal.proposed ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Saved now</p>
            <p className="whitespace-pre-wrap text-xs text-foreground">{proposal.current?.trim() || "(none)"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Proposed</p>
            <p className="whitespace-pre-wrap text-xs text-foreground">{proposal.proposed}</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          The AI found nothing for this question in the mark scheme. Type its mark scheme in yourself.
        </p>
      )}
    </div>
  )
}
