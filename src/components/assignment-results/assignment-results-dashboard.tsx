"use client"

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, Flag, RefreshCw, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react"
import {
  AssignmentResultActivity,
  AssignmentResultActivitySummary,
  AssignmentResultCell,
  AssignmentResultMatrix,
  AssignmentResultRow,
  AssignmentResultSuccessCriterionSummary,
} from "@/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  getPupilActivitySubmissionUrlAction,
  listPupilActivitySubmissionsAction,
  overrideAssignmentScoreAction,
  clearActivityAiMarksAction,
  requestAiMarkAction,
  resetAssignmentScoreAction,
  updateAssignmentFeedbackVisibilityAction,
  triggerManualAiMarkingAction,
  triggerBulkAiMarkingAction,
  toggleSubmissionFlagAction,
} from "@/lib/server-updates"
import { resolveScoreTone } from "@/lib/results/colors"
import {
  computeAverageSuccessCriteriaScore,
  normaliseSuccessCriteriaScores,
} from "@/lib/scoring/client-success-criteria"
import { getRichTextMarkup } from "@/components/lessons/activity-view/utils"
import {
  ASSIGNMENT_FEEDBACK_VISIBILITY_EVENT,
  ASSIGNMENT_RESULTS_UPDATE_EVENT,
  buildAssignmentResultsChannelName,
} from "@/lib/results-channel"
import { extractScoreFromSubmission, selectLatestSubmission } from "@/lib/scoring/activity-scores"
type CellStatus = AssignmentResultCell["status"]

type CellSelection = {
  rowIndex: number
  activityIndex: number
  row: AssignmentResultRow
  activity: AssignmentResultActivity
  cell: AssignmentResultCell
}

type MatrixWithState = AssignmentResultMatrix & {
  rows: AssignmentResultRow[]
}

type OverrideDerivedState = {
  rowIndex: number
  activityIndex: number
  successCriteriaScores: Record<string, number | null>
  parsedAverage: number
  feedback: string | null
  submittedAt: string
  order: string[]
  optimisticToken: string
}

type OverrideActionState =
  | { status: "idle" }
  | { status: "error"; error: string; derived: OverrideDerivedState }
  | { status: "success"; submissionId: string | null; derived: OverrideDerivedState }

type OverrideActionDispatch =
  | { type: "reset" }
  | {
      type: "submit"
      request: Parameters<typeof overrideAssignmentScoreAction>[0]
      derived: OverrideDerivedState
    }

type ResetDerivedState = {
  rowIndex: number
  activityIndex: number
  successCriteriaScores: Record<string, number | null>
  autoScore: number
  submittedAt: string
  status: CellStatus
  order: string[]
}

type ResetActionState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "success"; derived: ResetDerivedState }

type ResetActionDispatch =
  | { type: "reset" }
  | {
      type: "submit"
      request: Parameters<typeof resetAssignmentScoreAction>[0]
      derived: ResetDerivedState
    }

type UploadFileEntry = {
  name: string
  size: number | null
  url: string | null
  updatedAt: string | null
  error?: string | null
}

type UploadFileState = {
  status: "idle" | "loading" | "loaded" | "error"
  files: UploadFileEntry[]
  error?: string | null
  fetchedAt?: string | null
}

type SubmissionRow = {
  submission_id: string | null
  activity_id: string | null
  user_id: string | null
  submitted_at: string | null
  body: unknown
  is_flagged: boolean | null
}

type RealtimeChangesPayload<T> = {
  eventType: string
  schema: string
  table: string
  commit_timestamp: string
  new: T | null
  old: T | null
  errors: unknown
}

type AssignmentResultsRealtimePayload = {
  submissionId: string | null
  pupilId: string
  activityId: string
  aiScore: number | null
  aiFeedback: string | null
  successCriteriaScores: Record<string, number>
  isFlagged?: boolean
}

const OVERRIDE_ACTION_INITIAL_STATE: OverrideActionState = { status: "idle" }
const RESET_ACTION_INITIAL_STATE: ResetActionState = { status: "idle" }
const RESULTS_REALTIME_ENABLED =
  (process.env.NEXT_PUBLIC_RESULTS_REALTIME_ENABLED ?? "true").toLowerCase() === "true"
const SSE_RESULTS_URL = "/sse?topics=submissions,assignments"

function formatPercent(score: number | null): string {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "—"
  }
  return `${Math.round(score * 100)}%`
}

function formatPercentValue(percent: number): string {
  if (Number.isNaN(percent)) {
    return "0"
  }
  const clamped = Math.min(Math.max(percent, 0), 100)
  const rounded = Math.round(clamped * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString()
}

function formatPercentInput(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0"
  }
  return formatPercentValue(value * 100)
}

function toPercentNumber(raw: string | undefined): number | null {
  if (typeof raw !== "string") {
    return 0
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return 0
  }
  const value = Number.parseFloat(trimmed)
  if (Number.isNaN(value) || value < 0 || value > 100) {
    return null
  }
  return value
}

function formatFileSize(size?: number | null): string {
  if (typeof size !== "number" || Number.isNaN(size) || size <= 0) {
    return "—"
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function describeStatus(status: CellStatus) {
  switch (status) {
    case "override":
      return "Override applied"
    case "auto":
      return "Auto score"
    default:
      return "Not marked"
  }
}

function resolveCellBackgroundTone(cell: AssignmentResultCell) {
  if (cell.status === "missing") {
    if (cell.needsMarking) {
      return "bg-muted text-foreground border border-border"
    }
    return "bg-background text-muted-foreground border border-dashed border-border"
  }
  return resolveScoreTone(cell.score, cell.status)
}

function recalculateMatrix(
  activities: AssignmentResultActivity[],
  rows: AssignmentResultRow[],
): {
  rows: AssignmentResultRow[]
  activitySummaries: AssignmentResultActivitySummary[]
  successCriteriaSummaries: AssignmentResultSuccessCriterionSummary[]
  overallAverages: { activitiesAverage: number | null; assessmentAverage: number | null }
} {
  const totals = new Map<
    string,
    {
      total: number
      count: number
      submittedCount: number
    }
  >()

  activities.forEach((activity) => {
    totals.set(activity.activityId, {
      total: 0,
      count: 0,
      submittedCount: 0,
    })
  })

  const nextRows = rows.map((row) => {
    const nextCells = row.cells.map((cell) => {
      const slot = totals.get(cell.activityId)
      if (slot) {
        if (typeof cell.score === "number" && Number.isFinite(cell.score)) {
          slot.total += cell.score
          slot.submittedCount += 1
        } else {
          slot.total += 0
        }
        slot.count += 1
        if (cell.status !== "missing" || typeof cell.score === "number") {
          // submittedCount already incremented above when score exists; ensure manual submissions with missing status do not double count
        }
      }
      return cell
    })

    const activityCount = activities.length
    const activitiesScore = nextCells.reduce(
      (acc, cell) => acc + (typeof cell.score === "number" ? cell.score : 0),
      0,
    )
    const averageScore = activityCount > 0 ? activitiesScore / activityCount : null

    return { ...row, cells: nextCells, averageScore }
  })

  let overallTotal = 0
  let overallCount = 0
  let summativeOverallTotal = 0
  let summativeOverallCount = 0

  const activitySummaries: AssignmentResultActivitySummary[] = activities.map((activity) => {
    const entry = totals.get(activity.activityId) ?? { total: 0, count: 0, submittedCount: 0 }
    if (entry.count > 0) {
      overallTotal += entry.total
      overallCount += entry.count
      if (activity.isSummative) {
        summativeOverallTotal += entry.total
        summativeOverallCount += entry.count
      }
    }
    return {
      activityId: activity.activityId,
      activitiesAverage: entry.count > 0 ? entry.total / entry.count : null,
      assessmentAverage: activity.isSummative && entry.count > 0 ? entry.total / entry.count : null,
      submittedCount: entry.submittedCount,
    }
  })

  const successCriteriaTotals = new Map<
    string,
    {
      total: number
      count: number
      assessmentTotal: number
      assessmentCount: number
      submittedCount: number
      activityIds: Set<string>
      title: string | null
      description: string | null
    }
  >()

  for (const activity of activities) {
    const totalsEntry = totals.get(activity.activityId) ?? {
      total: 0,
      count: 0,
      assessmentTotal: 0,
      assessmentCount: 0,
      submittedCount: 0,
    }

    for (const criterion of activity.successCriteria) {
      const existing = successCriteriaTotals.get(criterion.successCriteriaId) ?? {
        total: 0,
        count: 0,
        assessmentTotal: 0,
        assessmentCount: 0,
        submittedCount: 0,
        activityIds: new Set<string>(),
        title: criterion.title ?? null,
        description: criterion.description ?? null,
      }

      existing.total += totalsEntry.total
      existing.count += totalsEntry.count
      if (activity.isSummative) {
        existing.assessmentTotal += totalsEntry.total
        existing.assessmentCount += totalsEntry.count
      }
      existing.submittedCount += totalsEntry.submittedCount
      existing.activityIds.add(activity.activityId)

      if (!existing.title && criterion.title) {
        existing.title = criterion.title
      }

      if ((!existing.description || existing.description.trim().length === 0) && criterion.description) {
        existing.description = criterion.description
      }

      successCriteriaTotals.set(criterion.successCriteriaId, existing)
    }
  }

  const successCriteriaSummaries: AssignmentResultSuccessCriterionSummary[] = Array.from(
    successCriteriaTotals.entries(),
  ).map(([successCriteriaId, entry]) => ({
    successCriteriaId,
    title: entry.title ?? null,
    description: entry.description ?? null,
    activitiesAverage: entry.count > 0 ? entry.total / entry.count : null,
    assessmentAverage: entry.assessmentCount > 0 ? entry.assessmentTotal / entry.assessmentCount : null,
    submittedCount: entry.submittedCount,
    activityCount: entry.activityIds.size,
  }))

  const overallAverages = {
    activitiesAverage: overallCount > 0 ? overallTotal / overallCount : null,
    assessmentAverage: summativeOverallCount > 0 ? summativeOverallTotal / summativeOverallCount : null,
  }

  return { rows: nextRows, activitySummaries, successCriteriaSummaries, overallAverages }
}

function getSubmissionGuard(cell: AssignmentResultCell) {
  if (!cell.submissionId && cell.status !== "override") {
    return "No submission available to reset yet."
  }
  return null
}

function resolvePupilLabels(pupil: AssignmentResultRow["pupil"]) {
  const email = (pupil.email ?? "").trim()
  const hasProfileName =
    Boolean((pupil.firstName ?? "").trim().length > 0) ||
    Boolean((pupil.lastName ?? "").trim().length > 0)

  const primaryLabel = hasProfileName
    ? pupil.displayName
    : email.length > 0
      ? email
      : pupil.displayName

  let secondaryLabel: string | null = null
  if (hasProfileName) {
    // Only show the user ID when no profile name is available.
    secondaryLabel = null
  } else if (email.length === 0 && pupil.displayName !== pupil.userId) {
    secondaryLabel = pupil.userId
  }

  if (secondaryLabel && secondaryLabel === primaryLabel) {
    secondaryLabel = null
  }

  return { primaryLabel, secondaryLabel }
}

function isImageFile(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename)
}

export function AssignmentResultsDashboard({ matrix }: { matrix: AssignmentResultMatrix }) {
  const [matrixState, setMatrixState] = useState<MatrixWithState>({ ...matrix, rows: matrix.rows })
  const [feedbackVisible, setFeedbackVisible] = useState<boolean>(matrix.assignment?.feedbackVisible ?? false)
  const [selection, setSelection] = useState<CellSelection | null>(null)
  const [activitySummarySelection, setActivitySummarySelection] = useState<string | null>(null)
  const [criterionDrafts, setCriterionDrafts] = useState<Record<string, string>>({})
  const [feedbackDraft, setFeedbackDraft] = useState<string>("")
  const [uploadFiles, setUploadFiles] = useState<Record<string, UploadFileState>>({})
  const [viewingFile, setViewingFile] = useState<{ name: string; url: string | null } | null>(null)
  const [imageTransform, setImageTransform] = useState<{ rotate: number; scale: number }>({ rotate: 0, scale: 1 })
  const [imageViewMode, setImageViewMode] = useState(false)
  const [optimisticOverrides, setOptimisticOverrides] = useState<
    Record<
      string,
      {
        token: string
        snapshot: AssignmentResultCell
      }
    >
  >({})
  const [overrideActionState, triggerOverrideAction, overridePending] = useActionState<
    OverrideActionState,
    OverrideActionDispatch
  >(
    async (_state: OverrideActionState, payload: OverrideActionDispatch) => {
      if (!payload || payload.type === "reset") {
        return OVERRIDE_ACTION_INITIAL_STATE
      }
      const result = await overrideAssignmentScoreAction(payload.request)
      if (!result.success) {
        return { status: "error", error: result.error ?? "Unable to save override.", derived: payload.derived }
      }
      return {
        status: "success",
        submissionId: result.submissionId ?? payload.request.submissionId ?? null,
        derived: payload.derived,
      }
    },
    OVERRIDE_ACTION_INITIAL_STATE,
  )
  const [resetActionState, triggerResetAction, resetPending] = useActionState<ResetActionState, ResetActionDispatch>(
    async (_state: ResetActionState, payload: ResetActionDispatch) => {
      if (!payload || payload.type === "reset") {
        return RESET_ACTION_INITIAL_STATE
      }
      const result = await resetAssignmentScoreAction(payload.request)
      if (!result.success) {
        return { status: "error", error: result.error ?? "Unable to reset override." }
      }
      return {
        status: "success",
        derived: payload.derived,
      }
    },
    RESET_ACTION_INITIAL_STATE,
  )
  const [overrideUITransitionPending, startOverrideUITransition] = useTransition()
  const [resetUITransitionPending, startResetUITransition] = useTransition()
  const [aiMarkPending, startAiMarkTransition] = useTransition()
  const [clearAiPending, startClearAiTransition] = useTransition()
  const [feedbackTogglePending, startFeedbackToggleTransition] = useTransition()
  const [flagPending, startFlagTransition] = useTransition()
  const router = useRouter()
  const matrixStateRef = useRef(matrixState)
  const buildOverrideKey = useCallback((rowIndex: number, activityIndex: number) => `${rowIndex}:${activityIndex}`, [])
  const recordOptimisticSnapshot = useCallback(
    (rowIndex: number, activityIndex: number, cell: AssignmentResultCell, token: string) => {
      const key = buildOverrideKey(rowIndex, activityIndex)
      const snapshot: AssignmentResultCell = {
        ...cell,
        successCriteriaScores: { ...(cell.successCriteriaScores ?? {}) },
        autoSuccessCriteriaScores: cell.autoSuccessCriteriaScores
          ? { ...cell.autoSuccessCriteriaScores }
          : cell.autoSuccessCriteriaScores,
        overrideSuccessCriteriaScores: cell.overrideSuccessCriteriaScores
          ? { ...cell.overrideSuccessCriteriaScores }
          : cell.overrideSuccessCriteriaScores,
      }
      setOptimisticOverrides((current) => ({
        ...current,
        [key]: { token, snapshot },
      }))
    },
    [buildOverrideKey],
  )
  const optimisticOverridesRef = useRef(optimisticOverrides)
  const clearOptimisticEntry = useCallback(
    (rowIndex: number, activityIndex: number, token?: string) => {
      const key = buildOverrideKey(rowIndex, activityIndex)
      setOptimisticOverrides((current) => {
        const existing = current[key]
        if (!existing || (token && existing.token !== token)) {
          return current
        }
        const next = { ...current }
        delete next[key]
        return next
      })
    },
    [buildOverrideKey],
  )
  const getOptimisticEntry = useCallback(
    (rowIndex: number, activityIndex: number) => {
      const key = buildOverrideKey(rowIndex, activityIndex)
      return optimisticOverridesRef.current[key]
    },
    [buildOverrideKey],
  )

  const applyFeedbackVisibilityUpdate = useCallback((visible: boolean) => {
    setMatrixState((current) => {
      const currentVisible = current.assignment?.feedbackVisible ?? false
      if (currentVisible === visible) {
        return current
      }
      return {
        ...current,
        assignment: current.assignment ? { ...current.assignment, feedbackVisible: visible } : current.assignment,
      }
    })
    setFeedbackVisible((previous) => (previous === visible ? previous : visible))
  }, [])

  useEffect(() => {
    applyFeedbackVisibilityUpdate(matrix.assignment?.feedbackVisible ?? false)
  }, [applyFeedbackVisibilityUpdate, matrix.assignment?.feedbackVisible])

  const activities = matrixState.activities
  const assignmentChannelName = useMemo(
    () => buildAssignmentResultsChannelName(matrix.assignmentId),
    [matrix.assignmentId],
  )
  const realtimeFilter = useMemo(() => {
    if (!RESULTS_REALTIME_ENABLED || activities.length === 0) {
      return null
    }
    const quotedIds = activities
      .map((activity) => activity.activityId)
      .filter((id) => typeof id === "string" && id.length > 0)
      .map((id) => `"${id}"`)
    if (quotedIds.length === 0) {
      return null
    }
    return `activity_id=in.(${quotedIds.join(",")})`
  }, [activities])
  const groupedRows = matrixState.rows
  const activitySummariesById = useMemo(() => {
    const map: Record<string, AssignmentResultActivitySummary> = {}
    for (const summary of matrixState.activitySummaries ?? []) {
      map[summary.activityId] = summary
    }
    return map
  }, [matrixState.activitySummaries])
  const successCriteriaSummaries = matrixState.successCriteriaSummaries ?? []
  const pupilsWithoutSubmissions = useMemo(
    () =>
      groupedRows
        .filter((row) => row.cells.every((cell) => !cell.submissionId || cell.status === "missing"))
        .map((row) => row.pupil),
    [groupedRows],
  )
  const selectedUploadKey = selection ? `${selection.row.pupil.userId}::${selection.activity.activityId}` : null
  const selectedUploadState = selectedUploadKey ? uploadFiles[selectedUploadKey] : undefined
  const selectedActivity = useMemo(() => {
    if (!activitySummarySelection) {
      return null
    }
    return activities.find((activity) => activity.activityId === activitySummarySelection) ?? null
  }, [activitySummarySelection, activities])
  const selectedActivitySummary = selectedActivity
    ? activitySummariesById[selectedActivity.activityId] ?? null
    : null
  const selectedActivityStats = useMemo(() => {
    if (!selectedActivity) {
      return null
    }
    const activityIndex = activities.findIndex(
      (activity) => activity.activityId === selectedActivity.activityId,
    )
    if (activityIndex === -1) {
      return null
    }
    let overrideCount = 0
    let autoCount = 0
    let missingCount = 0
    let submittedCount = 0
    let highestScore: number | null = null
    let lowestScore: number | null = null
    for (const row of groupedRows) {
      const cell = row.cells[activityIndex]
      if (!cell) {
        continue
      }
      if (cell.status === "override") {
        overrideCount += 1
      } else if (cell.status === "auto") {
        autoCount += 1
      } else {
        missingCount += 1
      }
      if (typeof cell.score === "number" && Number.isFinite(cell.score)) {
        submittedCount += 1
        highestScore = highestScore === null ? cell.score : Math.max(highestScore, cell.score)
        lowestScore = lowestScore === null ? cell.score : Math.min(lowestScore, cell.score)
      }
    }
    return {
      overrideCount,
      autoCount,
      missingCount,
      submittedCount,
      highestScore,
      lowestScore,
      totalPupils: groupedRows.length,
    }
  }, [selectedActivity, activities, groupedRows])

  useEffect(() => {
    matrixStateRef.current = matrixState
  }, [matrixState])
  useEffect(() => {
    optimisticOverridesRef.current = optimisticOverrides
  }, [optimisticOverrides])
  
  const selectionRef = useRef(selection)
  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const handleAiMark = useCallback(() => {
    if (!selectedActivity) {
      toast.error("No activity is selected.")
      return
    }
    const activityIndex = activities.findIndex(
      (activity) => activity.activityId === selectedActivity.activityId,
    )
    if (activityIndex === -1) {
      toast.error("Unable to find activity details.")
      return
    }
    const questionText =
      groupedRows
        .map((row) => row.cells[activityIndex]?.question)
        .find((question) => typeof question === "string" && question.trim().length > 0) ??
      selectedActivity.title
    const modelAnswer =
      groupedRows
        .map((row) => row.cells[activityIndex]?.correctAnswer)
        .find((answer) => typeof answer === "string" && answer.trim().length > 0) ?? ""
    const providedAnswers = groupedRows
      .map((row) => {
        const cell = row.cells[activityIndex]
        if (!cell) {
          return null
        }
        return {
          pupilId: row.pupil.userId,
          provided_answer: cell.pupilAnswer ?? "",
        }
      })
      .filter((entry): entry is { pupilId: string; provided_answer: string } => Boolean(entry))
    const payload = {
      requestid: crypto.randomUUID(),
      question_text: questionText ?? "",
      model_answer: modelAnswer ?? "",
      provided_answers: providedAnswers,
      group_assignment_id: matrixState.assignmentId,
      activity_id: selectedActivity.activityId,
    }
    startAiMarkTransition(async () => {
      try {
        const result = await requestAiMarkAction(payload)
        if (!result.success) {
          toast.error(result.error ?? "Unable to send AI mark request.")
          return
        }
        toast.success("AI mark request sent.")
      } catch (error) {
        console.error("[assignment-results] AI Mark request failed", error)
        toast.error("Unable to send AI mark request.")
      }
    })
  }, [selectedActivity, activities, groupedRows, matrixState.assignmentId, startAiMarkTransition])

  const handleManualAiMark = useCallback(() => {
    if (!selection) {
      toast.error("No selection to mark.")
      return
    }

    if (!selection.cell.submissionId) {
      toast.error("No submission available to mark.")
      return
    }

    startAiMarkTransition(async () => {
      try {
        const result = await triggerManualAiMarkingAction({
          activityId: selection.activity.activityId,
          pupilId: selection.row.pupil.userId,
          submissionId: selection.cell.submissionId!,
          assignmentId: matrixState.assignmentId,
        })

        if (result.success) {
          toast.success("AI marking requested.")
        } else {
          toast.error("Failed to request AI marking.")
        }
      } catch (error) {
        console.error("[assignment-results] Manual AI marking trigger failed", error)
        toast.error("An error occurred while requesting AI marking.")
      }
    })
  }, [selection, matrixState.assignmentId, startAiMarkTransition])

  const handleColumnAiMark = useCallback((activityIndex: number) => {
    const activity = activities[activityIndex]
    if (!activity) return

    const submissionsToMark = groupedRows
      .map((row) => {
        const cell = row.cells[activityIndex]
        if (cell && cell.submissionId) {
          return {
            pupilId: row.pupil.userId,
            submissionId: cell.submissionId,
          }
        }
        return null
      })
      .filter((entry): entry is { pupilId: string; submissionId: string } => entry !== null)

    if (submissionsToMark.length === 0) {
      toast.info("No submissions found in this column to mark.")
      return
    }

    startAiMarkTransition(async () => {
      try {
        const result = await triggerBulkAiMarkingAction({
          assignmentId: matrixState.assignmentId,
          submissions: submissionsToMark.map((s) => ({
            submissionId: s.submissionId,
          })),
        })

        if (result.success) {
          toast.success(`AI marking queued for ${submissionsToMark.length} submissions.`)
        } else {
          toast.error("Failed to queue AI marking.")
        }
      } catch (error) {
        console.error("[assignment-results] Column AI marking failed", error)
        toast.error("Failed to request AI marking for the column.")
      }
    })
  }, [activities, groupedRows, matrixState.assignmentId, startAiMarkTransition])

  const handleClearAiMarks = useCallback(() => {
    if (!selectedActivity) {
      toast.error("No activity is selected.")
      return
    }
    startClearAiTransition(async () => {
      const result = await clearActivityAiMarksAction({
        assignmentId: matrixState.assignmentId,
        activityId: selectedActivity.activityId,
      })
      if (!result.success) {
        toast.error(result.error ?? "Unable to clear AI marks.")
        return
      }
      const clearedMessage =
        result.cleared > 0
          ? `Cleared AI marks for ${result.cleared} submission${result.cleared === 1 ? "" : "s"}.`
          : "No AI marks were present to clear."
      toast.success(clearedMessage)
      const clearedAt = new Date().toISOString()
      setMatrixState((previous) => {
        const activityIndex = previous.activities.findIndex(
          (activity) => activity.activityId === selectedActivity.activityId,
        )
        if (activityIndex === -1) {
          return previous
        }
        const successCriteriaIds = previous.activities[activityIndex].successCriteria.map(
          (criterion) => criterion.successCriteriaId,
        )
        const nextRows = previous.rows.map((row) => {
          const targetCell = row.cells[activityIndex]
          if (!targetCell) {
            return row
          }
          const hasOverride =
            typeof targetCell.overrideScore === "number" && Number.isFinite(targetCell.overrideScore)
          const fillValue = hasOverride && typeof targetCell.overrideScore === "number" ? targetCell.overrideScore : 0
          const resetScores = normaliseSuccessCriteriaScores({
            successCriteriaIds,
            fillValue,
          })
          const updatedCell: AssignmentResultCell = {
            ...targetCell,
            autoScore: null,
            autoFeedback: null,
            autoFeedbackSource: null,
            autoFeedbackUpdatedAt: clearedAt,
            autoSuccessCriteriaScores: resetScores,
            successCriteriaScores: hasOverride ? targetCell.successCriteriaScores : resetScores,
            status: hasOverride ? "override" : "missing",
            score: hasOverride ? targetCell.overrideScore : fillValue,
            needsMarking: hasOverride ? false : Boolean(targetCell.submissionId),
          }
          const nextCells = row.cells.map((cell, index) => (index === activityIndex ? updatedCell : cell))
          return { ...row, cells: nextCells }
        })
        const recalculated = recalculateMatrix(previous.activities, nextRows)
        return {
          ...previous,
          rows: recalculated.rows,
          activitySummaries: recalculated.activitySummaries,
          successCriteriaSummaries: recalculated.successCriteriaSummaries,
          overallAverages: recalculated.overallAverages,
        }
      })
      setSelection((current) => {
        if (!current || current.activity.activityId !== selectedActivity.activityId) {
          return current
        }
        const hasOverride =
          typeof current.cell.overrideScore === "number" && Number.isFinite(current.cell.overrideScore)
        const fillValue = hasOverride && typeof current.cell.overrideScore === "number" ? current.cell.overrideScore : 0
        const resetScores = normaliseSuccessCriteriaScores({
          successCriteriaIds: current.activity.successCriteria.map((criterion) => criterion.successCriteriaId),
          fillValue,
        })
        return {
          ...current,
          cell: {
            ...current.cell,
            autoScore: null,
            autoFeedback: null,
            autoFeedbackSource: null,
            autoFeedbackUpdatedAt: clearedAt,
            autoSuccessCriteriaScores: resetScores,
            successCriteriaScores: hasOverride ? current.cell.successCriteriaScores : resetScores,
            status: hasOverride ? "override" : "missing",
            score: hasOverride ? current.cell.overrideScore : fillValue,
            needsMarking: hasOverride ? false : Boolean(current.cell.submissionId),
          },
        }
      })
      router.refresh()
    })
  }, [selectedActivity, matrixState.assignmentId, router, startClearAiTransition])

  const draftAverage = useMemo(() => {
    if (!selection) return null
    const criteria = selection.activity.successCriteria
    if (criteria.length === 0) return null
    let total = 0
    for (const criterion of criteria) {
      const percent = toPercentNumber(criterionDrafts[criterion.successCriteriaId])
      if (percent === null) {
        return null
      }
      total += percent / 100
    }
    return total / criteria.length
  }, [selection, criterionDrafts])

  const overallActivitiesLabel = useMemo(
    () => formatPercent(matrixState.overallAverages?.activitiesAverage ?? null),
    [matrixState.overallAverages?.activitiesAverage],
  )
  const overallSummativeLabel = useMemo(
    () => formatPercent(matrixState.overallAverages?.assessmentAverage ?? null),
    [matrixState.overallAverages?.assessmentAverage],
  )
  const loadUploadFiles = useCallback(
    async (
      context: { lessonId: string; activityId: string; pupilId: string; cacheKey: string },
      options?: { force?: boolean },
    ) => {
      setUploadFiles((previous) => {
        const current = previous[context.cacheKey]
        if (!options?.force && current?.status === "loading") {
          return previous
        }
        return {
          ...previous,
          [context.cacheKey]: {
            status: "loading",
            files: current?.files ?? [],
            error: null,
            fetchedAt: current?.fetchedAt ?? null,
          },
        }
      })
      try {
        const listResult = await listPupilActivitySubmissionsAction(
          context.lessonId,
          context.activityId,
          context.pupilId,
        )
        if (listResult.error) {
          setUploadFiles((previous) => ({
            ...previous,
            [context.cacheKey]: {
              status: "error",
              files: [],
              error: listResult.error ?? "Unable to load uploads.",
            },
          }))
          return
        }
        const files = listResult.data ?? []
        const resolved = await Promise.all(
          files.map(async (file) => {
            const urlResult = await getPupilActivitySubmissionUrlAction(
              context.lessonId,
              context.activityId,
              context.pupilId,
              file.name,
            )
            return {
              name: file.name,
              size: typeof file.size === "number" ? file.size : null,
              url: urlResult.success ? urlResult.url ?? null : null,
              error: urlResult.success ? null : urlResult.error ?? "Unable to create download link.",
              updatedAt: file.updated_at ?? file.created_at ?? null,
            }
          }),
        )
        setUploadFiles((previous) => ({
          ...previous,
          [context.cacheKey]: {
            status: "loaded",
            files: resolved,
            error: null,
            fetchedAt: new Date().toISOString(),
          },
        }))
      } catch (error) {
        console.error("[assignment-results] Unexpected error loading uploads:", error)
        setUploadFiles((previous) => ({
          ...previous,
          [context.cacheKey]: {
            status: "error",
            files: [],
            error: "Unable to load uploads.",
          },
        }))
      }
    },
    [],
  )

  useEffect(() => {
    if (!selection || selection.activity.type !== "upload-file" || !selectedUploadKey) {
      return
    }
    const lessonId = matrixState.lesson?.lessonId
    if (!lessonId) {
      return
    }
    if (selectedUploadState && selectedUploadState.status !== "idle") {
      return
    }
    void loadUploadFiles({
      lessonId,
      activityId: selection.activity.activityId,
      pupilId: selection.row.pupil.userId,
      cacheKey: selectedUploadKey,
    })
  }, [selection, matrixState.lesson?.lessonId, selectedUploadKey, selectedUploadState?.status, loadUploadFiles])

  const handleUploadRefresh = useCallback(() => {
    if (!selection || selection.activity.type !== "upload-file") {
      return
    }
    const lessonId = matrixState.lesson?.lessonId
    if (!lessonId) {
      toast.error("Lesson context is unavailable.")
      return
    }
    const cacheKey = `${selection.row.pupil.userId}::${selection.activity.activityId}`
    void loadUploadFiles(
      {
        lessonId,
        activityId: selection.activity.activityId,
        pupilId: selection.row.pupil.userId,
        cacheKey,
      },
      { force: true },
    )
  }, [selection, matrixState.lesson?.lessonId, loadUploadFiles])

  const handleCellSelect = (rowIndex: number, activityIndex: number) => {
    const row = groupedRows[rowIndex]
    const activity = activities[activityIndex]
    const cell = row.cells[activityIndex]
    const cacheKey = `${row.pupil.userId}::${activity.activityId}`

    setUploadFiles((previous) => {
      const current = previous[cacheKey]
      if (!current || current.status === "idle") {
        return previous
      }
      return {
        ...previous,
        [cacheKey]: {
          ...current,
          status: "idle",
        },
      }
    })

    setActivitySummarySelection(null)
    setSelection({
      rowIndex,
      activityIndex,
      row,
      activity,
      cell,
    })

    const nextCriterionDrafts: Record<string, string> = {}
    if (activity.successCriteria.length > 0) {
      for (const criterion of activity.successCriteria) {
        const value = cell.successCriteriaScores[criterion.successCriteriaId]
        const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0
        nextCriterionDrafts[criterion.successCriteriaId] = formatPercentInput(numeric)
      }
    }
    setCriterionDrafts(nextCriterionDrafts)
    setFeedbackDraft(cell.feedback ?? "")
  }

  const closeSheet = () => {
    setSelection(null)
    setCriterionDrafts({})
    setFeedbackDraft("")
  }

  const handleActivitySummaryOpen = (activityId: string) => {
    closeSheet()
    setActivitySummarySelection(activityId)
  }

  const handleActivitySummaryClose = () => {
    setActivitySummarySelection(null)
  }

  const applyCellUpdate = useCallback((
    updater: (cell: AssignmentResultCell) => AssignmentResultCell | null,
    target?: { rowIndex: number; activityIndex: number },
  ) => {
    const targetRowIndex = target?.rowIndex ?? selectionRef.current?.rowIndex
    const targetActivityIndex = target?.activityIndex ?? selectionRef.current?.activityIndex
    if (
      typeof targetRowIndex !== "number"
      || typeof targetActivityIndex !== "number"
    ) {
      return
    }

    setMatrixState((previous) => {
      const nextRows = previous.rows.map((row, rowIndex) => {
        if (rowIndex !== targetRowIndex) {
          return row
        }

        const nextCells = row.cells.map((cell, cellIndex) => {
          if (cellIndex !== targetActivityIndex) {
            return cell
          }
          const updated = updater(cell)
          return updated ?? cell
        })

        return {
          ...row,
          cells: nextCells,
        }
      })

      const recalculated = recalculateMatrix(previous.activities, nextRows)

      return {
        ...previous,
        rows: recalculated.rows,
        activitySummaries: recalculated.activitySummaries,
        successCriteriaSummaries: recalculated.successCriteriaSummaries,
        overallAverages: recalculated.overallAverages,
      }
    })
  }, [])

  const handleClearFlag = useCallback(() => {
    if (!selection) {
      toast.error("No selection to update.")
      return
    }

    if (!selection.cell.submissionId) {
      toast.error("No submission available to update.")
      return
    }

    startFlagTransition(async () => {
      try {
        // Optimistic update
        applyCellUpdate((cell) => ({ ...cell, isFlagged: false }))
        setSelection((prev) => (prev ? { ...prev, cell: { ...prev.cell, isFlagged: false } } : null))

        const result = await toggleSubmissionFlagAction({
          submissionId: selection.cell.submissionId!,
          isFlagged: false,
        })

        if (result.success) {
          toast.success("Flag cleared.")
        } else {
          toast.error("Failed to clear flag.")
        }
      } catch (error) {
        console.error("[assignment-results] Failed to clear flag", error)
        toast.error("An error occurred while clearing the flag.")
      }
    })
  }, [selection, applyCellUpdate, startFlagTransition])

  const normalizeRow = (row: unknown): SubmissionRow | null => {
    if (!row || typeof row !== "object") {
      return null
    }
    const base = row as Record<string, unknown>
    const recordLike =
      (typeof base.record === "object" && base.record) ||
      (typeof base.new === "object" && base.new) ||
      (typeof base.payload === "object" && base.payload) ||
      null
    if (recordLike) {
      return recordLike as SubmissionRow
    }
    return base as SubmissionRow
  }

  const handleRealtimeSubmission = useCallback(
    (payload: RealtimeChangesPayload<SubmissionRow>) => {
      const normalizedNew = normalizeRow(payload.new)
      const normalizedOld = normalizeRow(payload.old)
      const eventActivityId = normalizedNew?.activity_id ?? normalizedOld?.activity_id ?? null
      const eventPupilId = normalizedNew?.user_id ?? normalizedOld?.user_id ?? null
      console.info("[assignment-results] Realtime payload received", {
        eventType: payload.eventType,
        activityId: eventActivityId,
        pupilId: eventPupilId,
        raw: payload,
      })
      if (!eventActivityId || !eventPupilId) {
        console.warn("[assignment-results] Unable to resolve real-time identifiers", {
          payloadKeys: {
            new: payload.new ? Object.getOwnPropertyNames(payload.new) : [],
            old: payload.old ? Object.getOwnPropertyNames(payload.old) : [],
          },
          payload,
        })
      }
      const record = payload.eventType === "DELETE" ? payload.old : payload.new
      if (!record) {
        return
      }
      const activityId = record.activity_id ?? ""
      const pupilId = record.user_id ?? ""
      if (!activityId || !pupilId) {
        return
      }
      const currentMatrix = matrixStateRef.current
      const activityIndex = currentMatrix.activities.findIndex((activity) => activity.activityId === activityId)
      if (activityIndex === -1) {
        return
      }
      const rowIndex = currentMatrix.rows.findIndex((row) => row.pupil.userId === pupilId)
      if (rowIndex === -1) {
        return
      }
      clearOptimisticEntry(rowIndex, activityIndex)
      const successCriteriaIds = currentMatrix.activities[activityIndex].successCriteria.map(
        (criterion) => criterion.successCriteriaId,
      )
      const submittedAt = record.submitted_at ? new Date(record.submitted_at).toISOString() : null

      if (payload.eventType === "DELETE") {
        const zeroScores = normaliseSuccessCriteriaScores({
          successCriteriaIds,
          fillValue: 0,
        })
        let clearedCell: AssignmentResultCell | null = null
        applyCellUpdate(
          (cell) => {
            clearedCell = {
              ...cell,
              submissionId: null,
              score: 0,
              autoScore: 0,
              overrideScore: null,
              status: "missing",
              submittedAt: null,
              feedback: null,
              feedbackSource: null,
              feedbackUpdatedAt: null,
              autoFeedback: null,
              autoFeedbackSource: null,
              autoFeedbackUpdatedAt: null,
              successCriteriaScores: zeroScores,
              autoSuccessCriteriaScores: zeroScores,
              overrideSuccessCriteriaScores: undefined,
              needsMarking: false,
            }
            return clearedCell
          },
          { rowIndex, activityIndex },
        )
        if (clearedCell) {
          setSelection((current) => {
            if (!current || current.rowIndex !== rowIndex || current.activityIndex !== activityIndex) {
              return current
            }
            return {
              ...current,
              cell: clearedCell!,
            }
          })
        }
        return
      }

      let updatedCell: AssignmentResultCell | null = null
      applyCellUpdate(
        (cell) => {
          if (!selectLatestSubmission(cell, submittedAt)) {
            return cell
          }

          if (!record.body) {
            updatedCell = {
              ...cell,
              submissionId: record.submission_id ?? cell.submissionId,
              submittedAt: submittedAt ?? cell.submittedAt,
              isFlagged: typeof record.is_flagged === "boolean" ? record.is_flagged : cell.isFlagged,
            }
            return updatedCell
          }

          const metadata = {
            question: cell.question ?? null,
            correctAnswer: cell.correctAnswer ?? null,
            optionTextMap: undefined,
          }
          const activityType = currentMatrix.activities[activityIndex].type
          const extracted = extractScoreFromSubmission(activityType, record.body, successCriteriaIds, metadata)
          const finalScore =
            computeAverageSuccessCriteriaScore(extracted.successCriteriaScores) ?? extracted.effectiveScore ?? 0
          const status =
            typeof extracted.overrideScore === "number"
              ? "override"
              : typeof extracted.effectiveScore === "number"
                ? "auto"
                : "missing"
          updatedCell = {
            ...cell,
            submissionId: record.submission_id ?? cell.submissionId,
            score: finalScore ?? cell.score,
            autoScore: extracted.autoScore ?? finalScore ?? cell.autoScore,
            overrideScore: extracted.overrideScore ?? cell.overrideScore,
            status: status !== "missing" ? status : cell.status,
            submittedAt: submittedAt ?? cell.submittedAt,
            feedback: extracted.feedback ?? cell.feedback,
            feedbackSource:
              extracted.feedback && extracted.feedback.trim().length > 0
                ? status === "override"
                  ? "teacher"
                  : cell.feedbackSource ?? "teacher"
                : cell.feedbackSource,
            feedbackUpdatedAt:
              extracted.feedback && extracted.feedback.trim().length > 0 ? submittedAt : cell.feedbackUpdatedAt,
            autoFeedback: extracted.autoFeedback ?? cell.autoFeedback,
            autoFeedbackSource:
              extracted.autoFeedback && extracted.autoFeedback.trim().length > 0
                ? activityType === "short-text-question"
                  ? "ai"
                  : cell.autoFeedbackSource ?? "auto"
                : cell.autoFeedbackSource,
            autoFeedbackUpdatedAt:
              extracted.autoFeedback && extracted.autoFeedback.trim().length > 0
                ? submittedAt
                : cell.autoFeedbackUpdatedAt,
            successCriteriaScores: extracted.successCriteriaScores,
            autoSuccessCriteriaScores: extracted.autoSuccessCriteriaScores,
            overrideSuccessCriteriaScores: extracted.overrideSuccessCriteriaScores ?? cell.overrideSuccessCriteriaScores,
            pupilAnswer: extracted.pupilAnswer ?? cell.pupilAnswer,
            needsMarking: status === "missing" ? Boolean(record.submission_id) : false,
            isFlagged: typeof record.is_flagged === "boolean" ? record.is_flagged : cell.isFlagged,
          }
          return updatedCell
        },
        { rowIndex, activityIndex },
      )
      if (updatedCell) {
        setSelection((current) => {
          if (!current || current.rowIndex !== rowIndex || current.activityIndex !== activityIndex) {
            return current
          }
          return {
            ...current,
            cell: updatedCell!,
          }
        })
      }
    },
    [applyCellUpdate, clearOptimisticEntry],
  )

  const handleRealtimeBroadcast = useCallback(
    (payload: { payload?: AssignmentResultsRealtimePayload } | AssignmentResultsRealtimePayload) => {
      const maybePayload = "payload" in payload ? payload.payload : payload
      if (
        !maybePayload
        || typeof (maybePayload as Partial<AssignmentResultsRealtimePayload>).activityId !== "string"
        || typeof (maybePayload as Partial<AssignmentResultsRealtimePayload>).pupilId !== "string"
      ) {
        return
      }
      const rawPayload = maybePayload as AssignmentResultsRealtimePayload

      const currentMatrix = matrixStateRef.current
      const activityIndex = currentMatrix.activities.findIndex(
        (activity) => activity.activityId === rawPayload.activityId,
      )
      const rowIndex = currentMatrix.rows.findIndex((row) => row.pupil.userId === rawPayload.pupilId)
      if (activityIndex === -1 || rowIndex === -1) {
        return
      }
      clearOptimisticEntry(rowIndex, activityIndex)

      const successCriteriaIds = currentMatrix.activities[activityIndex].successCriteria.map(
        (criterion) => criterion.successCriteriaId,
      )
      const fallbackScore =
        typeof rawPayload.aiScore === "number" && Number.isFinite(rawPayload.aiScore) ? rawPayload.aiScore : 0
      const normalisedScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: rawPayload.successCriteriaScores,
        fillValue: fallbackScore,
      })

      applyCellUpdate(
        (cell) => {
          const hasOverride =
            typeof cell.overrideScore === "number" && Number.isFinite(cell.overrideScore)
          const nextAutoScore =
            typeof rawPayload.aiScore === "number" && Number.isFinite(rawPayload.aiScore)
              ? rawPayload.aiScore
              : null
          const nextSuccessCriteriaScores = hasOverride ? cell.successCriteriaScores : normalisedScores
          const autoFeedbackUpdatedAt =
            rawPayload.aiFeedback && rawPayload.aiFeedback.trim().length > 0
              ? new Date().toISOString()
              : cell.autoFeedbackUpdatedAt ?? null
          return {
            ...cell,
            submissionId: rawPayload.submissionId ?? cell.submissionId,
            autoScore: nextAutoScore,
            autoFeedback: rawPayload.aiFeedback ?? null,
            autoFeedbackSource:
              rawPayload.aiFeedback && rawPayload.aiFeedback.trim().length > 0
                ? "ai"
                : cell.autoFeedbackSource ?? null,
            autoFeedbackUpdatedAt,
            autoSuccessCriteriaScores: normalisedScores,
            successCriteriaScores: nextSuccessCriteriaScores,
            score: hasOverride ? cell.overrideScore ?? nextAutoScore ?? fallbackScore : nextAutoScore ?? fallbackScore,
            status: hasOverride ? cell.status : nextAutoScore === null ? "missing" : "auto",
            needsMarking: false,
            isFlagged: typeof rawPayload.isFlagged === "boolean" ? rawPayload.isFlagged : cell.isFlagged,
          }
        },
        { rowIndex, activityIndex },
      )
    },
    [applyCellUpdate, clearOptimisticEntry],
  )

  const handleFeedbackVisibilityBroadcast = useCallback(
    (payload: { payload?: { feedbackVisible?: boolean } } | { feedbackVisible?: boolean }) => {
      const maybePayload = "payload" in payload ? payload.payload : payload
      const nextVisible =
        (maybePayload as { feedbackVisible?: boolean })?.feedbackVisible ??
        (maybePayload as { payload?: { feedbackVisible?: boolean } })?.payload?.feedbackVisible

      if (typeof nextVisible !== "boolean") {
        return
      }
      if (nextVisible === feedbackVisible) {
        return
      }
      applyFeedbackVisibilityUpdate(nextVisible)
    },
    [applyFeedbackVisibilityUpdate, feedbackVisible],
  )

  const handleFeedbackToggle = useCallback(
    (nextVisible: boolean) => {
      if (!matrix.assignmentId) {
        toast.error("Assignment context unavailable.")
        return
      }
      if (nextVisible === feedbackVisible) {
        return
      }
      applyFeedbackVisibilityUpdate(nextVisible)
      startFeedbackToggleTransition(async () => {
        const result = await updateAssignmentFeedbackVisibilityAction({
          assignmentId: matrix.assignmentId,
          feedbackVisible: nextVisible,
        })
        if (!result.success) {
          applyFeedbackVisibilityUpdate(!nextVisible)
          toast.error(result.error ?? "Unable to update feedback visibility.")
          return
        }
        const resolvedVisibility = result.feedbackVisible ?? nextVisible
        applyFeedbackVisibilityUpdate(resolvedVisibility)
        toast.success(resolvedVisibility ? "Feedback is now visible to pupils." : "Feedback hidden from pupils.")
      })
    },
    [applyFeedbackVisibilityUpdate, matrix.assignmentId, startFeedbackToggleTransition],
  )

  useEffect(() => {
    if (!RESULTS_REALTIME_ENABLED) {
      return
    }

    const source = new EventSource(`${SSE_RESULTS_URL}`)

    source.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as {
          topic?: string
          type?: string
          payload?: Record<string, unknown>
        }
        if (envelope.topic === "submissions" && envelope.payload) {
          const payload = envelope.payload
          const activityId = typeof payload.activityId === "string" ? payload.activityId : null
          const pupilId = typeof payload.pupilId === "string" ? payload.pupilId : null
          if (!activityId || !pupilId) {
            return
          }
          const submissionId =
            typeof payload.submissionId === "string"
              ? payload.submissionId
              : typeof payload.submission_id === "string"
                ? payload.submission_id
                : null
          const submittedAt =
            typeof payload.submittedAt === "string"
              ? payload.submittedAt
              : typeof payload.submitted_at === "string"
                ? payload.submitted_at
                : new Date().toISOString()
          const body =
            typeof payload.body === "object" && payload.body
              ? (payload.body as Record<string, unknown>)
              : (envelope.type?.includes("uploaded") || typeof payload.fileName === "string")
                ? {
                    upload_submission: true,
                    upload_file_name:
                      typeof payload.fileName === "string"
                        ? payload.fileName
                        : typeof payload.upload_file_name === "string"
                          ? payload.upload_file_name
                          : null,
                    upload_updated_at: submittedAt,
                  }
                : null

          const isFlagged =
            typeof payload.isFlagged === "boolean"
              ? payload.isFlagged
              : typeof payload.is_flagged === "boolean"
                ? payload.is_flagged
                : null

          const record: SubmissionRow = {
            submission_id: submissionId,
            activity_id: activityId,
            user_id: pupilId,
            submitted_at: submittedAt,
            body,
            is_flagged: isFlagged,
          }

          const eventType =
            envelope.type?.includes("deleted") || envelope.type === "submission.deleted"
              ? "DELETE"
              : envelope.type?.includes("uploaded")
                ? "INSERT"
                : "UPDATE"

          handleRealtimeSubmission({
            eventType,
            schema: "public",
            table: "submissions",
            commit_timestamp: new Date().toISOString(),
            new: eventType === "DELETE" ? null : (record as SubmissionRow),
            old: eventType === "DELETE" ? (record as SubmissionRow) : null,
            errors: null,
          } as RealtimeChangesPayload<SubmissionRow>)
        } else if (envelope.topic === "assignments") {
          if (envelope.type === "assignment.feedback.visibility" && envelope.payload) {
            const targetAssignmentId =
              typeof (envelope.payload as { assignmentId?: string }).assignmentId === "string"
                ? (envelope.payload as { assignmentId: string }).assignmentId
                : null
            if (targetAssignmentId && targetAssignmentId !== matrix.assignmentId) {
              return
            }
            handleFeedbackVisibilityBroadcast(envelope.payload)
          } else if (envelope.type?.includes("results") && envelope.payload) {
            handleRealtimeBroadcast(envelope.payload as AssignmentResultsRealtimePayload)
          }
        }
      } catch (error) {
        console.warn("[assignment-results] Failed to process SSE submission event", error)
      }
    }

    source.onerror = (error) => {
      console.warn("[assignment-results] SSE connection error", error)
    }

    return () => {
      source.close()
    }
  }, [handleRealtimeSubmission])

  const handleOverrideSubmit = (overrides?: Record<string, string>, feedbackOverride?: string) => {
    if (!selection) return

    const criteria = selection.activity.successCriteria
    if (criteria.length === 0) {
      toast.error("This activity has no linked success criteria to override.")
      return
    }

    const currentCriterionDrafts = overrides ?? criterionDrafts
    const currentFeedbackDraft = feedbackOverride ?? feedbackDraft

    const parsedCriterionScores: Record<string, number> = {}

    for (const criterion of criteria) {
      const percent = toPercentNumber(currentCriterionDrafts[criterion.successCriteriaId])
      if (percent === null) {
        toast.error("Enter a percentage between 0 and 100 for each success criterion.")
        return
      }
      const normalised = percent / 100
      parsedCriterionScores[criterion.successCriteriaId] = Number.parseFloat(
        Math.min(Math.max(normalised, 0), 1).toFixed(3),
      )
    }

    const successCriteriaScores = normaliseSuccessCriteriaScores({
      successCriteriaIds: criteria.map((criterion) => criterion.successCriteriaId),
      existingScores: parsedCriterionScores,
      fillValue: 0,
    })

    const parsedAverage = computeAverageSuccessCriteriaScore(successCriteriaScores) ?? 0
    const feedback = currentFeedbackDraft.trim()
    const submittedAt = new Date().toISOString()
    const optimisticToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const currentMatrix = matrixStateRef.current
    const currentCell = currentMatrix.rows[selection.rowIndex]?.cells[selection.activityIndex]
    if (currentCell) {
      recordOptimisticSnapshot(selection.rowIndex, selection.activityIndex, currentCell, optimisticToken)
    }

      applyCellUpdate(
        (cell) => ({
          ...cell,
          submissionId: selection.cell.submissionId ?? cell.submissionId ?? null,
          score: parsedAverage,
          overrideScore: parsedAverage,
          status: "override",
          feedback: feedback.length > 0 ? feedback : null,
          feedbackSource: feedback.length > 0 ? "teacher" : cell.feedbackSource ?? null,
          feedbackUpdatedAt: submittedAt,
          successCriteriaScores,
          overrideSuccessCriteriaScores: successCriteriaScores,
          submittedAt,
          needsMarking: false,
        }),
      { rowIndex: selection.rowIndex, activityIndex: selection.activityIndex },
    )
    setSelection((current) => {
      if (!current || current.rowIndex !== selection.rowIndex || current.activityIndex !== selection.activityIndex) {
        return current
      }
      return {
        ...current,
        cell: {
            ...current.cell,
            submissionId: selection.cell.submissionId ?? current.cell.submissionId ?? null,
            score: parsedAverage,
            overrideScore: parsedAverage,
            status: "override",
            feedback: feedback.length > 0 ? feedback : null,
            feedbackSource: feedback.length > 0 ? "teacher" : current.cell.feedbackSource ?? null,
            feedbackUpdatedAt: submittedAt,
            successCriteriaScores,
            overrideSuccessCriteriaScores: successCriteriaScores,
            submittedAt,
            needsMarking: false,
          },
      }
    })
    setCriterionDrafts(
      Object.fromEntries(
        selection.activity.successCriteria.map((criterion) => {
          const value = successCriteriaScores[criterion.successCriteriaId]
          const normalised = typeof value === "number" && Number.isFinite(value) ? value : 0
          return [criterion.successCriteriaId, formatPercentInput(normalised)]
        }),
      ),
    )
    setFeedbackDraft(feedback)

    startOverrideUITransition(() => {
      triggerOverrideAction({
        type: "submit",
        request: {
          assignmentId: matrixState.assignmentId,
          activityId: selection.activity.activityId,
          pupilId: selection.row.pupil.userId,
          submissionId: selection.cell.submissionId,
          score: parsedAverage,
          feedback: feedback.length > 0 ? feedback : null,
          criterionScores: successCriteriaScores,
        },
        derived: {
          rowIndex: selection.rowIndex,
          activityIndex: selection.activityIndex,
          successCriteriaScores,
          parsedAverage,
          feedback: feedback.length > 0 ? feedback : null,
          submittedAt,
          order: selection.activity.successCriteria.map((criterion) => criterion.successCriteriaId),
          optimisticToken,
        },
      })
    })
  }

  const handleReset = () => {
    if (!selection) return

    const submissionGuard = getSubmissionGuard(selection.cell)
    if (submissionGuard) {
      toast.error(submissionGuard)
      return
    }

    const successCriteriaIds = selection.activity.successCriteria.map((criterion) => criterion.successCriteriaId)
    const autoScore = typeof selection.cell.autoScore === "number" ? selection.cell.autoScore : 0
    const autoScores =
      selection.cell.autoSuccessCriteriaScores ??
      normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: autoScore,
      })
    const submittedAt = new Date().toISOString()

    startResetUITransition(() => {
      triggerResetAction({
        type: "submit",
        request: {
          assignmentId: matrixState.assignmentId,
          activityId: selection.activity.activityId,
          pupilId: selection.row.pupil.userId,
          submissionId: selection.cell.submissionId,
        },
        derived: {
          rowIndex: selection.rowIndex,
          activityIndex: selection.activityIndex,
          successCriteriaScores: autoScores,
          autoScore,
          submittedAt,
          status: typeof selection.cell.autoScore === "number" ? "auto" : "missing",
          order: successCriteriaIds,
        },
      })
    })
  }

  useEffect(() => {
    if (overrideActionState.status === "idle") {
      return
    }
    if (overrideActionState.status === "error") {
      console.error("[assignment-results] Override save failed:", overrideActionState.error)
      const { derived } = overrideActionState
      const optimisticEntry = getOptimisticEntry(derived.rowIndex, derived.activityIndex)
      if (optimisticEntry && optimisticEntry.token === derived.optimisticToken) {
        applyCellUpdate(
          () => optimisticEntry.snapshot,
          { rowIndex: derived.rowIndex, activityIndex: derived.activityIndex },
        )
        setSelection((current) => {
          if (!current || current.rowIndex !== derived.rowIndex || current.activityIndex !== derived.activityIndex) {
            return current
          }
          return { ...current, cell: optimisticEntry.snapshot }
        })
        setCriterionDrafts(
          Object.fromEntries(
            derived.order.map((criterionId) => {
              const value = optimisticEntry.snapshot.successCriteriaScores?.[criterionId]
              const normalised = typeof value === "number" && Number.isFinite(value) ? value : 0
              return [criterionId, formatPercentInput(normalised)]
            }),
          ),
        )
        setFeedbackDraft(optimisticEntry.snapshot.feedback ?? "")
        clearOptimisticEntry(derived.rowIndex, derived.activityIndex, derived.optimisticToken)
      }
      toast.error(overrideActionState.error ?? "Unable to save override.")
      triggerOverrideAction({ type: "reset" })
      return
    }
    if (overrideActionState.status === "success") {
      const { derived, submissionId } = overrideActionState
      clearOptimisticEntry(derived.rowIndex, derived.activityIndex, derived.optimisticToken)
      if (submissionId) {
        applyCellUpdate(
          (cell) => {
            if (cell.submissionId === submissionId) {
              return cell
            }
            return { ...cell, submissionId }
          },
          { rowIndex: derived.rowIndex, activityIndex: derived.activityIndex },
        )
      }
      setSelection((current) => {
        if (!current || current.rowIndex !== derived.rowIndex || current.activityIndex !== derived.activityIndex) {
          return current
        }
        return {
          ...current,
          cell: {
            ...current.cell,
            submissionId: submissionId ?? current.cell.submissionId ?? null,
          },
        }
      })
      setCriterionDrafts(
        Object.fromEntries(
          derived.order.map((criterionId) => {
            const value = derived.successCriteriaScores[criterionId]
            return [
              criterionId,
              formatPercentInput(typeof value === "number" && Number.isFinite(value) ? value : 0),
            ]
          }),
        ),
      )
      setFeedbackDraft(derived.feedback ?? "")
      toast.success("Override saved.")
      startOverrideUITransition(() => {
        triggerOverrideAction({ type: "reset" })
      })
    }
  }, [overrideActionState, applyCellUpdate, triggerOverrideAction, clearOptimisticEntry, getOptimisticEntry, startOverrideUITransition])

  useEffect(() => {
    if (resetActionState.status === "idle") {
      return
    }
    if (resetActionState.status === "error") {
      toast.error(resetActionState.error ?? "Unable to reset override.")
      startResetUITransition(() => {
        triggerResetAction({ type: "reset" })
      })
      return
    }
    if (resetActionState.status === "success") {
      const { derived } = resetActionState
      applyCellUpdate(
        (cell) => ({
          ...cell,
          score: derived.autoScore,
          overrideScore: null,
          status: derived.status,
          feedback: null,
          feedbackSource: null,
          feedbackUpdatedAt: derived.submittedAt,
          successCriteriaScores: derived.successCriteriaScores,
          autoSuccessCriteriaScores: derived.successCriteriaScores,
          overrideSuccessCriteriaScores: undefined,
          submittedAt: derived.submittedAt,
          needsMarking: derived.status === "missing" && Boolean(cell.submissionId),
        }),
        { rowIndex: derived.rowIndex, activityIndex: derived.activityIndex },
      )
      setSelection((current) => {
        if (!current || current.rowIndex !== derived.rowIndex || current.activityIndex !== derived.activityIndex) {
          return current
        }
        return {
          ...current,
          cell: {
            ...current.cell,
            score: derived.autoScore,
            autoScore: derived.autoScore,
            overrideScore: null,
            status: derived.status,
            feedback: null,
            feedbackSource: null,
            feedbackUpdatedAt: derived.submittedAt,
            successCriteriaScores: derived.successCriteriaScores,
            autoSuccessCriteriaScores: derived.successCriteriaScores,
            overrideSuccessCriteriaScores: undefined,
            submittedAt: derived.submittedAt,
            needsMarking: derived.status === "missing" && Boolean(current.cell.submissionId),
          },
        }
      })
      setCriterionDrafts(
        Object.fromEntries(
          derived.order.map((criterionId) => {
            const value = derived.successCriteriaScores[criterionId]
            return [
              criterionId,
              formatPercentInput(typeof value === "number" && Number.isFinite(value) ? value : 0),
            ]
          }),
        ),
      )
      setFeedbackDraft("")
      toast.success("Override cleared.")
      startResetUITransition(() => {
        triggerResetAction({ type: "reset" })
      })
    }
  }, [resetActionState, applyCellUpdate, triggerResetAction, startResetUITransition])

  const goToAssignments = () => {
    router.push("/assignments")
  }

  const goToLesson = () => {
    if (!matrixState.lesson?.lessonId) return
    router.push(`/lessons/${encodeURIComponent(matrixState.lesson.lessonId)}`)
  }

  const handleCriterionInputChange = (criterionId: string, value: string) => {
    setCriterionDrafts((previous) => ({
      ...previous,
      [criterionId]: value,
    }))
  }

  const handleCriterionInputBlur = (criterionId: string) => {
    setCriterionDrafts((previous) => {
      const raw = previous[criterionId]
      const trimmed = typeof raw === "string" ? raw.trim() : ""
      if (trimmed.length === 0) {
        if (raw === "0") {
          return previous
        }
        return {
          ...previous,
          [criterionId]: "0",
        }
      }
      const parsed = Number.parseFloat(trimmed)
      if (Number.isNaN(parsed)) {
        return {
          ...previous,
          [criterionId]: "0",
        }
      }
      const clamped = Math.min(Math.max(parsed, 0), 100)
      const formatted = formatPercentValue(clamped)
      if (formatted === raw) {
        return previous
      }
      return {
        ...previous,
        [criterionId]: formatted,
      }
    })
  }

  const handlePrevPupil = useCallback(() => {
    if (!selection) return
    const prevRowIndex = selection.rowIndex - 1
    if (prevRowIndex >= 0) {
      handleCellSelect(prevRowIndex, selection.activityIndex)
      setViewingFile(null)
      setImageTransform({ rotate: 0, scale: 1 })
    }
  }, [selection, handleCellSelect])

  const handleNextPupil = useCallback(() => {
    if (!selection) return
    const nextRowIndex = selection.rowIndex + 1
    if (nextRowIndex < groupedRows.length) {
      handleCellSelect(nextRowIndex, selection.activityIndex)
      setViewingFile(null)
      setImageTransform({ rotate: 0, scale: 1 })
    }
  }, [selection, groupedRows.length, handleCellSelect])

  const canPrev = selection ? selection.rowIndex > 0 : false
  const canNext = selection ? selection.rowIndex < groupedRows.length - 1 : false

  const handleRotateLeft = () => setImageTransform((prev) => ({ ...prev, rotate: prev.rotate - 90 }))
  const handleRotateRight = () => setImageTransform((prev) => ({ ...prev, rotate: prev.rotate + 90 }))
  const handleZoomIn = () => setImageTransform((prev) => ({ ...prev, scale: Math.min(prev.scale + 0.25, 5) }))
  const handleZoomOut = () => setImageTransform((prev) => ({ ...prev, scale: Math.max(prev.scale - 0.25, 0.25) }))
  const handleResetTransform = () => setImageTransform({ rotate: 0, scale: 1 })

  if (viewingFile && selection) {
    return (
      <div className="flex items-start gap-6">
        <div className="flex h-[calc(100vh-2rem)] flex-1 min-w-0 flex-col gap-4 overflow-hidden rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-4">
            <Button
              variant="ghost"
              onClick={() => {
                setViewingFile(null)
                setImageViewMode(false)
              }}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to table
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={handlePrevPupil} disabled={!canPrev}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium">{selection.row.pupil.displayName}</span>
              <Button variant="outline" size="icon" onClick={handleNextPupil} disabled={!canNext}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-1 border-l border-border/60 pl-2">
              <Button variant="ghost" size="icon" onClick={handleRotateLeft} title="Rotate Left">
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleRotateRight} title="Rotate Right">
                <RotateCw className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleZoomIn} title="Zoom In">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleResetTransform} className="text-xs">
                Reset
              </Button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto bg-muted/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewingFile.url ?? ""}
              alt={viewingFile.name}
              className="max-h-full max-w-full object-contain transition-transform duration-200"
              style={{
                transform: `rotate(${imageTransform.rotate}deg) scale(${imageTransform.scale})`,
              }}
            />
          </div>
        </div>

        {selection && (
          <aside className="sticky top-4 flex h-[calc(100vh-2rem)] w-[400px] shrink-0 flex-col gap-4 overflow-hidden rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">
                  {selection.activity.title} • {resolvePupilLabels(selection.row.pupil).primaryLabel}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {describeStatus(selection.cell.status)} · Submitted{" "}
                  {selection.cell.submittedAt
                    ? new Date(selection.cell.submittedAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="-mt-1 -mr-2" onClick={closeSheet}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold text-foreground">
                {formatPercent(selection.cell.score ?? null)}
              </span>
              <div className="flex items-center gap-2">
                {selection.cell.isFlagged && (
                  <Badge
                    variant="destructive"
                    className={cn(
                      "h-6 w-6 p-0 flex items-center justify-center cursor-pointer hover:bg-destructive/90 transition-colors",
                      flagPending && "opacity-50 pointer-events-none"
                    )}
                    onClick={handleClearFlag}
                    title="Clear flag"
                  >
                    <Flag className="h-3.5 w-3.5 fill-current" />
                  </Badge>
                )}
                <Badge variant={selection.cell.status === "override" ? "default" : "secondary"}>
                  {selection.cell.status === "override" ? "Override" : "Auto"}
                </Badge>
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-6 overflow-y-auto pr-1">
                {/* Context Section */}
                <div className="space-y-4">
                  <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Question
                    </p>
                    <p className="text-sm text-foreground">
                      {selection.cell.question ?? "No question text available."}
                    </p>
                  </div>

                  {selection.cell.correctAnswer ? (
                    <div className="rounded-md border border-emerald-300/70 bg-emerald-100/40 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        Correct answer
                      </p>
                      <p className="text-sm text-emerald-900">{selection.cell.correctAnswer}</p>
                    </div>
                  ) : null}

                  <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Pupil response</p>
                    {selection.activity.type === "upload-file" ? (
                      <p className="text-sm text-foreground">
                        {selectedUploadState?.files.length
                          ? "Learner submitted file uploads listed below."
                          : "No upload has been submitted yet."}
                      </p>
                    ) : selection.cell.pupilAnswer ? (
                      (() => {
                        const markup = getRichTextMarkup(selection.cell.pupilAnswer ?? "")
                        if (markup) {
                          return (
                            <div
                              className="prose prose-sm max-w-none text-foreground"
                              dangerouslySetInnerHTML={{ __html: markup }}
                            />
                          )
                        }
                        return (
                          <p className="text-sm text-foreground whitespace-pre-wrap">
                            {selection.cell.pupilAnswer}
                          </p>
                        )
                      })()
                    ) : (
                      <p className="text-sm text-foreground">No response has been recorded yet.</p>
                    )}
                  </div>

                  {selection.activity.type === "upload-file" ? (
                    <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Uploaded files
                        </p>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={handleUploadRefresh}
                          disabled={!matrixState.lesson?.lessonId || selectedUploadState?.status === "loading"}
                          aria-label="Refresh uploads"
                        >
                          <RefreshCw
                            className={cn(
                              "h-3.5 w-3.5",
                              selectedUploadState?.status === "loading" ? "animate-spin" : "",
                            )}
                          />
                        </Button>
                      </div>
                      {selectedUploadState?.status === "loading" ? (
                        <p className="text-xs text-muted-foreground">Loading uploads…</p>
                      ) : selectedUploadState?.status === "error" ? (
                        <p className="text-xs text-destructive">
                          {selectedUploadState.error ?? "Unable to load uploads."}
                        </p>
                      ) : selectedUploadState?.files.length ? (
                        <ul className="space-y-2">
                          {selectedUploadState.files.map((file) => (
                            <li
                              key={file.name}
                              className="rounded-md border border-border/70 bg-background p-2 text-sm"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-col">
                                  <span className="font-medium text-foreground">{file.name}</span>
                                  {file.updatedAt ? (
                                    <span className="text-[11px] text-muted-foreground">
                                      Updated {new Date(file.updatedAt).toLocaleString()}
                                    </span>
                                  ) : null}
                                </div>
                                {file.size ? (
                                  <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                                ) : null}
                              </div>
                              {file.url ? (
                                <div className="mt-1 flex items-center gap-3">
                                  {isImageFile(file.name) ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setViewingFile({ name: file.name, url: file.url })
                                        setImageViewMode(true)
                                      }}
                                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                    >
                                      <Eye className="h-3 w-3" />
                                      View
                                    </button>
                                  ) : null}
                                  <a
                                    href={file.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                  >
                                    <Download className="h-3 w-3" />
                                    Download
                                  </a>
                                </div>
                              ) : (
                                <span className="mt-1 text-xs text-muted-foreground">
                                  {file.error ?? "Download link unavailable."}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">No uploads yet.</p>
                      )}
                    </div>
                  ) : null}
                </div>

                <Tabs defaultValue="override" className="flex flex-1 flex-col gap-4 overflow-hidden pt-4 border-t border-border/60">
                  <TabsList className="w-full">
                    <TabsTrigger value="override">Override</TabsTrigger>
                    <TabsTrigger value="auto">Automatic score</TabsTrigger>
                  </TabsList>

                  <TabsContent value="override" className="flex-1 overflow-hidden">
                    <div className="flex h-full flex-col">
                      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">Marking</p>
                          <span className="text-xs text-muted-foreground">
                            Average: {draftAverage !== null ? formatPercent(draftAverage) : "—"}
                          </span>
                        </div>
                        {selection.activity.successCriteria.length > 0 ? (
                          <div className="space-y-3">
                            {selection.activity.successCriteria.map((criterion) => {
                              const criterionId = criterion.successCriteriaId
                              const label =
                                criterion.title?.trim() && criterion.title.trim().length > 0
                                  ? criterion.title.trim()
                                  : criterion.description?.trim() && criterion.description.trim().length > 0
                                    ? criterion.description.trim()
                                    : criterionId
                              const draftValueRaw = criterionDrafts[criterionId]
                              const percentDraft =
                                typeof draftValueRaw === "string" ? draftValueRaw : "0"
                              const trimmed = percentDraft.trim()
                              const numericDraft =
                                trimmed.length === 0 ? 0 : Number.parseFloat(trimmed)
                              const isNumericDraftValid = !Number.isNaN(numericDraft)
                              return (
                                <div key={criterionId} className="space-y-2">
                                  <p className="text-xs font-semibold text-muted-foreground">{label}</p>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {[
                                      { label: "0", percent: 0 },
                                      { label: "Partial", percent: 50 },
                                      { label: "Full", percent: 100 },
                                    ].map((option) => {
                                      const isActive =
                                        isNumericDraftValid &&
                                        Math.abs(numericDraft - option.percent) < 0.0001
                                      return (
                                        <Button
                                          key={option.label}
                                          type="button"
                                          size="sm"
                                          variant={isActive ? "default" : "outline"}
                                          aria-pressed={isActive}
                                          className="h-8 px-2 text-xs"
                                          onClick={() => {
                                            const val = formatPercentValue(option.percent)
                                            const nextDrafts = { ...criterionDrafts, [criterionId]: val }
                                            setCriterionDrafts(nextDrafts)
                                            handleOverrideSubmit(nextDrafts)
                                          }}
                                        >
                                          {option.label}
                                        </Button>
                                      )
                                    })}
                                    <Input
                                      type="number"
                                      inputMode="decimal"
                                      min="0"
                                      max="100"
                                      step="0.1"
                                      value={percentDraft}
                                      onChange={(event) =>
                                        handleCriterionInputChange(criterionId, event.target.value)
                                      }
                                      onBlur={() => {
                                        handleCriterionInputBlur(criterionId)
                                        handleOverrideSubmit()
                                      }}
                                      placeholder="Exact percent (0-100)"
                                      aria-label={`Exact percent for ${label}`}
                                      className="h-8 w-24"
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No success criteria linked to this activity.
                          </p>
                        )}

                        <div className="grid gap-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="override-feedback">
                            Teacher feedback
                          </label>
                          <Textarea
                            id="override-feedback"
                            value={feedbackDraft}
                            placeholder="Optional feedback for the pupil"
                            onChange={(event) => setFeedbackDraft(event.target.value)}
                            onBlur={() => handleOverrideSubmit()}
                            rows={4}
                          />
                        </div>

                        {!selection.cell.submissionId ? (
                          <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            No learner submission has been recorded yet. Saving an override will create a submission on behalf
                            of the pupil so you can capture scores and feedback.
                          </div>
                        ) : null}
                      </div>

                      <div className="sticky bottom-0 left-0 right-0 mt-4 flex flex-col gap-2 bg-background pt-2">
                        <Button
                          variant="outline"
                          onClick={handleReset}
                          disabled={
                            resetPending
                            || resetUITransitionPending
                            || !selection.cell.submissionId
                          }
                        >
                          {resetPending || resetUITransitionPending ? "Resetting…" : "Reset to auto score"}
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="auto" className="flex-1 overflow-hidden">
                    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
                      <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Automatic score
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] font-bold uppercase tracking-wider"
                            onClick={handleManualAiMark}
                            disabled={aiMarkPending || !selection.cell.submissionId}
                          >
                            {aiMarkPending ? "Marking..." : "Mark with AI"}
                          </Button>
                        </div>
                        <div className="mt-1 flex items-baseline justify-between">
                          <span className="text-lg font-semibold text-foreground">
                            {formatPercent(selection.cell.autoScore ?? selection.cell.score ?? null)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {selection.cell.status === "override" ? "Override applied" : "Auto"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {selection.cell.status === "override"
                            ? "This score has been overridden. The stored automatic values are shown below for reference."
                            : "This score was calculated automatically from the success criteria inputs."}
                        </p>
                      </div>
                      {selection.activity.successCriteria.length > 0 ? (
                        <div className="space-y-1 rounded-md border border-border/50 bg-muted/40 p-2">
                          {selection.activity.successCriteria.map((criterion) => {
                            const label =
                              criterion.title?.trim() && criterion.title.trim().length > 0
                                ? criterion.title.trim()
                                : criterion.description?.trim() && criterion.description.trim().length > 0
                                  ? criterion.description.trim()
                                  : criterion.successCriteriaId
                            const autoValues =
                              selection.cell.autoSuccessCriteriaScores ?? selection.cell.successCriteriaScores
                            const value = autoValues[criterion.successCriteriaId]
                            return (
                              <div
                                key={criterion.successCriteriaId}
                                className="flex items-center justify-between text-xs"
                              >
                                <span className="text-muted-foreground">{label}</span>
                                <span className="font-semibold text-foreground">
                                  {formatPercent(typeof value === "number" ? value : null)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No success criteria linked to this activity.
                        </p>
                      )}
                      <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                          Automatic feedback
                        </p>
                        <p className="text-sm text-foreground">
                          {selection.cell.autoFeedback?.trim()
                            ? selection.cell.autoFeedback
                            : "No automatic feedback available."}
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </aside>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-6">
      <div className="flex-1 min-w-0 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assignment results</h1>
            <p className="text-sm text-muted-foreground">
              Review pupil performance across all scored activities in this lesson.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={goToAssignments}>
              Back to assignments
            </Button>
            {matrixState.lesson?.lessonId ? (
              <Button variant="outline" onClick={goToLesson}>
                Open lesson
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <details className="group rounded-lg border border-border bg-card text-sm">
            <summary className="flex list-none cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left font-semibold text-muted-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              <span>Assignment context</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:-rotate-180" />
            </summary>
            <div className="border-t border-border/60 px-4 py-4">
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {matrixState.lesson?.title ?? "Lesson unavailable"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Group {matrixState.group?.groupId ?? "—"}
                    {matrixState.group?.subject ? ` · ${matrixState.group.subject}` : ""}
                  </p>
                </div>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium text-muted-foreground">Group ID:</span>{" "}
                    <span className="text-foreground">{matrixState.group?.groupId ?? "Not available"}</span>
                  </p>
                  <p>
                    <span className="font-medium text-muted-foreground">Lesson ID:</span>{" "}
                    <span className="text-foreground">{matrixState.lesson?.lessonId ?? "Not available"}</span>
                  </p>
                </div>
                <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Pupil feedback visibility</p>
                    <p className="text-xs text-muted-foreground">
                      Control whether pupils can see automatic or teacher feedback for this assignment.
                    </p>
                    {!matrixState.assignment ? (
                      <p className="text-[11px] text-muted-foreground">Assignment context unavailable.</p>
                    ) : feedbackTogglePending ? (
                      <p className="text-[11px] text-muted-foreground">Saving…</p>
                    ) : null}
                  </div>
                  <Switch
                    checked={feedbackVisible}
                    onCheckedChange={handleFeedbackToggle}
                    disabled={!matrixState.assignment || feedbackTogglePending}
                    aria-label="Toggle pupil feedback visibility"
                  />
                </div>
              </div>
            </div>
          </details>
          <details className="group rounded-lg border border-border bg-card text-sm">
            <summary className="flex list-none cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              <div className="space-y-0.5">
                <span className="text-sm font-semibold text-muted-foreground">Score overview</span>
                <span className="text-xs text-muted-foreground">Overall & assessment averages</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end text-right">
                  <span className="text-3xl font-semibold text-foreground">{overallActivitiesLabel}</span>
                  <span className="text-xs text-muted-foreground">Assessment {overallSummativeLabel}</span>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:-rotate-180" />
              </div>
            </summary>
            <div className="space-y-3 border-t border-border/60 px-4 py-4">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Overall lesson averages with linked success criteria summaries.</span>
                <span>Activities: {overallActivitiesLabel}</span>
                <span>Assessment: {overallSummativeLabel}</span>
              </div>
              {successCriteriaSummaries.length > 0 ? (
                <div className="space-y-2">
                  {successCriteriaSummaries.map((summary) => {
                    const label =
                      summary.title?.trim() && summary.title.trim().length > 0
                        ? summary.title.trim()
                        : summary.description?.trim() && summary.description.trim().length > 0
                          ? summary.description.trim()
                          : summary.successCriteriaId
                    return (
                      <div
                        key={summary.successCriteriaId}
                        className="flex items-start justify-between gap-3 rounded-md border border-border/70 px-3 py-2"
                      >
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">
                            {summary.activityCount} activit{summary.activityCount === 1 ? "y" : "ies"} ·{" "}
                            {summary.submittedCount} submission{summary.submittedCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 text-right">
                          <span className="text-sm font-semibold text-foreground">
                            Activities {formatPercent(summary.activitiesAverage ?? null)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Assessment {formatPercent(summary.assessmentAverage ?? null)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No success criteria links found for the activities in this lesson.
                </p>
              )}
            </div>
          </details>
          <details className="group rounded-lg border border-border bg-card text-sm">
            <summary className="flex list-none cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left font-semibold text-muted-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              <span>Missing submissions</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs font-semibold">
                  {pupilsWithoutSubmissions.length}
                </Badge>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:-rotate-180" />
              </div>
            </summary>
            <div className="space-y-2 border-t border-border/60 px-4 py-4">
              {pupilsWithoutSubmissions.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {pupilsWithoutSubmissions.map((pupil) => {
                    const { primaryLabel, secondaryLabel } = resolvePupilLabels(pupil)
                    return (
                      <li
                        key={pupil.userId}
                        className="flex flex-col rounded-md border border-border/60 px-3 py-2"
                      >
                        <span className="font-medium text-foreground">{primaryLabel}</span>
                        {secondaryLabel ? (
                          <span className="text-xs text-muted-foreground">{secondaryLabel}</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">All pupils have submitted answers.</p>
              )}
            </div>
          </details>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="relative w-full overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-30 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm"
                  >
                    Pupil
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-20 bg-card px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm"
                  >
                    Average
                  </th>
                  {activities.map((activity, activityIndex) => (
                    <th
                      key={activity.activityId}
                      scope="col"
                      className="sticky top-0 z-20 min-w-40 bg-card px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm group/th"
                    >
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => handleActivitySummaryOpen(activity.activityId)}
                          className="group flex w-full flex-col gap-2 rounded-md border border-transparent px-2 py-1 text-left text-muted-foreground transition hover:border-border hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          aria-label={`View ${activity.title} statistics`}
                        >
                          <div>
                            <span className="block truncate text-sm font-semibold text-foreground">{activity.title}</span>
                            <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                              {activity.type.replace(/-/g, " ")}
                            </span>
                          </div>
                          {activity.successCriteria.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {activity.successCriteria.map((criterion) => {
                                const label =
                                  criterion.title?.trim() && criterion.title.trim().length > 0
                                    ? criterion.title.trim()
                                    : criterion.description?.trim() && criterion.description.trim().length > 0
                                      ? criterion.description.trim()
                                      : criterion.successCriteriaId
                                return (
                                  <span
                                    key={criterion.successCriteriaId}
                                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition group-hover:bg-muted/80"
                                  >
                                    {label}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No linked success criteria</span>
                          )}
                          <div className="flex flex-col text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">
                              Activities {formatPercent(activitySummariesById[activity.activityId]?.activitiesAverage ?? null)}
                            </span>
                            <span>
                              {activity.isSummative
                                ? `Assessment ${formatPercent(activitySummariesById[activity.activityId]?.assessmentAverage ?? null)}`
                                : "Not marked as assessment"}
                            </span>
                          </div>
                        </button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-full text-[10px] font-bold uppercase tracking-wider opacity-0 group-hover/th:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleColumnAiMark(activityIndex)
                          }}
                          disabled={aiMarkPending}
                        >
                          {aiMarkPending ? "Marking..." : "Mark All"}
                        </Button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2 + activities.length}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      No pupils are currently assigned to this group.
                    </td>
                  </tr>
                ) : (
                  groupedRows.map((row, rowIndex) => {
                    const { primaryLabel, secondaryLabel } = resolvePupilLabels(row.pupil)
                    return (
                      <tr key={row.pupil.userId} className="even:bg-muted/30">
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-0 z-10 bg-background px-4 py-3 text-left text-sm font-semibold text-foreground shadow-[1px_0_0_0_rgba(15,23,42,0.08)]",
                            "whitespace-nowrap",
                          )}
                        >
                          <div className="flex flex-col">
                            <span>{primaryLabel}</span>
                            {secondaryLabel ? (
                              <span className="text-xs font-normal text-muted-foreground">{secondaryLabel}</span>
                            ) : null}
                          </div>
                        </th>
                        <td className="px-3 py-3 text-center font-medium text-foreground">
                          {formatPercent(row.averageScore ?? null)}
                        </td>
                        {row.cells.map((cell, activityIndex) => {
                          const tone = resolveCellBackgroundTone(cell)
                          return (
                            <td key={cell.activityId} className="px-2 py-2 text-center">
                              <button
                                type="button"
                                className={cn(
                                  "flex h-10 w-full items-center justify-center rounded-md border border-transparent text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  tone,
                                )}
                                onClick={() => handleCellSelect(rowIndex, activityIndex)}
                              >
                                {formatPercent(cell.score ?? null)}
                                {cell.isFlagged ? (
                                  <Flag className="ml-1.5 h-3.5 w-3.5 fill-current" />
                                ) : null}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <Sheet open={Boolean(selectedActivity)} onOpenChange={(open) => !open && handleActivitySummaryClose()}>
        <SheetContent side="right" className="h-full w-full p-6 sm:max-w-md">
          {selectedActivity ? (
            <div className="flex h-full flex-col gap-4 overflow-y-auto">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" onClick={handleAiMark} disabled={aiMarkPending}>
                  {aiMarkPending ? "Sending…" : "AI Mark"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearAiMarks}
                  disabled={clearAiPending}
                >
                  {clearAiPending ? "Clearing…" : "Clear AI Marks"}
                </Button>
              </div>
              <SheetHeader className="p-0">
                <SheetTitle>{selectedActivity.title}</SheetTitle>
                <SheetDescription>
                  Activity insights across {selectedActivityStats?.totalPupils ?? groupedRows.length} pupils.
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="uppercase tracking-wide">
                  {selectedActivity.type.replace(/-/g, " ")}
                </Badge>
                <Badge variant={selectedActivity.isSummative ? "default" : "outline"}>
                  {selectedActivity.isSummative ? "Counts toward assessment" : "Formative only"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Activities average
                  </p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatPercent(selectedActivitySummary?.activitiesAverage ?? null)}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Assessment average
                  </p>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedActivity.isSummative
                      ? formatPercent(selectedActivitySummary?.assessmentAverage ?? null)
                      : "N/A"}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submissions</p>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedActivityStats
                      ? `${selectedActivityStats.submittedCount} / ${selectedActivityStats.totalPupils}`
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Pupils submitted</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Awaiting</p>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedActivityStats ? selectedActivityStats.missingCount : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Yet to be marked</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overrides</p>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedActivityStats ? selectedActivityStats.overrideCount : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Manual scores applied</p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auto scores</p>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedActivityStats ? selectedActivityStats.autoCount : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Generated automatically</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Highest score</p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatPercent(selectedActivityStats?.highestScore ?? null)}
                  </p>
                </div>
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Lowest score</p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatPercent(selectedActivityStats?.lowestScore ?? null)}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Linked success criteria
                </p>
                {selectedActivity.successCriteria.length > 0 ? (
                  <ul className="mt-2 space-y-2 text-sm">
                    {selectedActivity.successCriteria.map((criterion) => (
                      <li key={criterion.successCriteriaId} className="rounded-md border border-border/60 px-3 py-2">
                        <p className="font-medium text-foreground">
                          {criterion.title?.trim() && criterion.title.trim().length > 0
                            ? criterion.title.trim()
                            : criterion.successCriteriaId}
                        </p>
                        {criterion.description ? (
                          <p className="text-xs text-muted-foreground">{criterion.description}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No success criteria linked to this activity.</p>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      {selection && (
        <aside className="sticky top-4 flex h-[calc(100vh-2rem)] w-[400px] shrink-0 flex-col gap-4 overflow-hidden rounded-lg border border-border bg-card p-6 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <h3 className="font-semibold text-foreground">
                    {selection.activity.title} • {resolvePupilLabels(selection.row.pupil).primaryLabel}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {describeStatus(selection.cell.status)} · Submitted{" "}
                    {selection.cell.submittedAt
                      ? new Date(selection.cell.submittedAt).toLocaleString()
                      : "N/A"}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="-mt-1 -mr-2" onClick={closeSheet}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-semibold text-foreground">
                  {formatPercent(selection.cell.score ?? null)}
                </span>
                <div className="flex items-center gap-2">
                  {selection.cell.isFlagged && (
                    <Badge
                      variant="destructive"
                      className={cn(
                        "h-6 w-6 p-0 flex items-center justify-center cursor-pointer hover:bg-destructive/90 transition-colors",
                        flagPending && "opacity-50 pointer-events-none"
                      )}
                      onClick={handleClearFlag}
                      title="Clear flag"
                    >
                      <Flag className="h-3.5 w-3.5 fill-current" />
                    </Badge>
                  )}
                  <Badge variant={selection.cell.status === "override" ? "default" : "secondary"}>
                    {selection.cell.status === "override" ? "Override" : "Auto"}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 space-y-6 overflow-y-auto pr-1">
                  {/* Context Section */}
                  <div className="space-y-4">
                    <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Question</p>
                      <p className="text-sm text-foreground">
                        {selection.cell.question ?? "No question text available."}
                      </p>
                    </div>

                    {selection.cell.correctAnswer ? (
                      <div className="rounded-md border border-emerald-300/70 bg-emerald-100/40 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                          Correct answer
                        </p>
                        <p className="text-sm text-emerald-900">{selection.cell.correctAnswer}</p>
                      </div>
                    ) : null}

                    <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Pupil response</p>
                      {selection.activity.type === "upload-file" ? (
                        <p className="text-sm text-foreground">
                          {selectedUploadState?.files.length
                            ? "Learner submitted file uploads listed below."
                            : "No upload has been submitted yet."}
                        </p>
                      ) : selection.cell.pupilAnswer ? (
                        (() => {
                          const markup = getRichTextMarkup(selection.cell.pupilAnswer ?? "")
                          if (markup) {
                            return (
                              <div
                                className="prose prose-sm max-w-none text-foreground"
                                dangerouslySetInnerHTML={{ __html: markup }}
                              />
                            )
                          }
                          return (
                            <p className="text-sm text-foreground whitespace-pre-wrap">
                              {selection.cell.pupilAnswer}
                            </p>
                          )
                        })()
                      ) : (
                        <p className="text-sm text-foreground">No response has been recorded yet.</p>
                      )}
                    </div>

                    {selection.activity.type === "upload-file" ? (
                      <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Uploaded files
                          </p>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={handleUploadRefresh}
                            disabled={!matrixState.lesson?.lessonId || selectedUploadState?.status === "loading"}
                            aria-label="Refresh uploads"
                          >
                            <RefreshCw
                              className={cn(
                                "h-3.5 w-3.5",
                                selectedUploadState?.status === "loading" ? "animate-spin" : "",
                              )}
                            />
                          </Button>
                        </div>
                        {selectedUploadState?.status === "loading" ? (
                          <p className="text-xs text-muted-foreground">Loading uploads…</p>
                        ) : selectedUploadState?.status === "error" ? (
                          <p className="text-xs text-destructive">
                            {selectedUploadState.error ?? "Unable to load uploads."}
                          </p>
                        ) : selectedUploadState?.files.length ? (
                          <ul className="space-y-2">
                            {selectedUploadState.files.map((file) => (
                              <li
                                key={file.name}
                                className="rounded-md border border-border/70 bg-background p-2 text-sm"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex flex-col">
                                    <span className="font-medium text-foreground">{file.name}</span>
                                    {file.updatedAt ? (
                                      <span className="text-[11px] text-muted-foreground">
                                        Updated {new Date(file.updatedAt).toLocaleString()}
                                      </span>
                                    ) : null}
                                  </div>
                                  {file.size ? (
                                    <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                                  ) : null}
                                </div>
                                {file.url ? (
                                  <div className="mt-1 flex items-center gap-3">
                                    {isImageFile(file.name) ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setViewingFile({ name: file.name, url: file.url })
                                          setImageTransform({ rotate: 0, scale: 1 })
                                          setImageViewMode(true)
                                        }}
                                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                      >
                                        <Eye className="h-3 w-3" />
                                        View
                                      </button>
                                    ) : null}
                                    <a
                                      href={file.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                    >
                                      <Download className="h-3 w-3" />
                                      Download
                                    </a>
                                  </div>
                                ) : (
                                  <span className="mt-1 text-xs text-muted-foreground">
                                    {file.error ?? "Download link unavailable."}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground">No uploads yet.</p>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <Tabs defaultValue="override" className="flex flex-1 flex-col gap-4 overflow-hidden pt-4 border-t border-border/60">
                    <TabsList className="w-full">
                      <TabsTrigger value="override">Override</TabsTrigger>
                      <TabsTrigger value="auto">Automatic score</TabsTrigger>
                    </TabsList>

                    <TabsContent value="override" className="flex-1 overflow-hidden">
                      <div className="flex h-full flex-col">
                        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">Marking</p>
                            <span className="text-xs text-muted-foreground">
                              Average: {draftAverage !== null ? formatPercent(draftAverage) : "—"}
                            </span>
                          </div>
                          {selection.activity.successCriteria.length > 0 ? (
                            <div className="space-y-3">
                              {selection.activity.successCriteria.map((criterion) => {
                                const criterionId = criterion.successCriteriaId
                                const label =
                                  criterion.title?.trim() && criterion.title.trim().length > 0
                                    ? criterion.title.trim()
                                    : criterion.description?.trim() && criterion.description.trim().length > 0
                                      ? criterion.description.trim()
                                      : criterionId
                                const draftValueRaw = criterionDrafts[criterionId]
                                const percentDraft =
                                  typeof draftValueRaw === "string" ? draftValueRaw : "0"
                                const trimmed = percentDraft.trim()
                                const numericDraft =
                                  trimmed.length === 0 ? 0 : Number.parseFloat(trimmed)
                                const isNumericDraftValid = !Number.isNaN(numericDraft)
                                return (
                                  <div key={criterionId} className="space-y-2">
                                    <p className="text-xs font-semibold text-muted-foreground">{label}</p>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {[
                                        { label: "0", percent: 0 },
                                        { label: "Partial", percent: 50 },
                                        { label: "Full", percent: 100 },
                                      ].map((option) => {
                                        const isActive =
                                          isNumericDraftValid &&
                                          Math.abs(numericDraft - option.percent) < 0.0001
                                        return (
                                          <Button
                                            key={option.label}
                                            type="button"
                                            size="sm"
                                            variant={isActive ? "default" : "outline"}
                                            aria-pressed={isActive}
                                            className="h-8 px-2 text-xs"
                                            onClick={() => {
                                              const val = formatPercentValue(option.percent)
                                              const nextDrafts = { ...criterionDrafts, [criterionId]: val }
                                              setCriterionDrafts(nextDrafts)
                                              handleOverrideSubmit(nextDrafts)
                                            }}
                                          >
                                            {option.label}
                                          </Button>
                                        )
                                      })}
                                      <Input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        max="100"
                                        step="0.1"
                                        value={percentDraft}
                                        onChange={(event) =>
                                          handleCriterionInputChange(criterionId, event.target.value)
                                        }
                                        onBlur={() => {
                                          handleCriterionInputBlur(criterionId)
                                          handleOverrideSubmit()
                                        }}
                                        placeholder="Exact percent (0-100)"
                                        aria-label={`Exact percent for ${label}`}
                                        className="h-8 w-24"
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              No success criteria linked to this activity.
                            </p>
                          )}

                          <div className="grid gap-2">
                            <label className="text-sm font-medium text-foreground" htmlFor="override-feedback">
                              Teacher feedback
                            </label>
                            <Textarea
                              id="override-feedback"
                              value={feedbackDraft}
                              placeholder="Optional feedback for the pupil"
                              onChange={(event) => setFeedbackDraft(event.target.value)}
                              onBlur={() => handleOverrideSubmit()}
                              rows={4}
                            />
                          </div>

                          {!selection.cell.submissionId ? (
                            <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              No learner submission has been recorded yet. Saving an override will create a submission on behalf
                              of the pupil so you can capture scores and feedback.
                            </div>
                          ) : null}
                        </div>

                        <div className="sticky bottom-0 left-0 right-0 mt-4 flex flex-col gap-2 bg-background pt-2">
                          <Button
                            variant="outline"
                            onClick={handleReset}
                            disabled={
                              resetPending
                              || resetUITransitionPending
                              || !selection.cell.submissionId
                            }
                          >
                            {resetPending || resetUITransitionPending ? "Resetting…" : "Reset to auto score"}
                          </Button>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="auto" className="flex-1 overflow-hidden">
                      <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
                        <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Automatic score
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] font-bold uppercase tracking-wider"
                              onClick={handleManualAiMark}
                              disabled={aiMarkPending || !selection.cell.submissionId}
                            >
                              {aiMarkPending ? "Marking..." : "Mark with AI"}
                            </Button>
                          </div>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-lg font-semibold text-foreground">
                              {formatPercent(selection.cell.autoScore ?? selection.cell.score ?? null)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {selection.cell.status === "override" ? "Override applied" : "Auto"}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {selection.cell.status === "override"
                              ? "This score has been overridden. The stored automatic values are shown below for reference."
                              : "This score was calculated automatically from the success criteria inputs."}
                          </p>
                        </div>
                        {selection.activity.successCriteria.length > 0 ? (
                          <div className="space-y-1 rounded-md border border-border/50 bg-muted/40 p-2">
                            {selection.activity.successCriteria.map((criterion) => {
                              const label =
                                criterion.title?.trim() && criterion.title.trim().length > 0
                                  ? criterion.title.trim()
                                  : criterion.description?.trim() && criterion.description.trim().length > 0
                                    ? criterion.description.trim()
                                    : criterion.successCriteriaId
                              const autoValues =
                                selection.cell.autoSuccessCriteriaScores ?? selection.cell.successCriteriaScores
                              const value = autoValues[criterion.successCriteriaId]
                              return (
                                <div
                                  key={criterion.successCriteriaId}
                                  className="flex items-center justify-between text-xs"
                                >
                                  <span className="text-muted-foreground">{label}</span>
                                  <span className="font-semibold text-foreground">
                                    {formatPercent(typeof value === "number" ? value : null)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No success criteria linked to this activity.
                          </p>
                        )}
                        <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                            Automatic feedback
                          </p>
                          <p className="text-sm text-foreground">
                            {selection.cell.autoFeedback?.trim()
                              ? selection.cell.autoFeedback
                              : "No automatic feedback available."}
                          </p>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                              </div>
                            </div>
                      </aside>    )}
    </div>
  )
}
