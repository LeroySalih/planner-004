"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  AssignmentResultActivitySchema,
  AssignmentResultCellSchema,
  AssignmentResultMatrixSchema,
  AssignmentResultRowSchema,
  LegacyMcqSubmissionBodySchema,
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireTeacherProfile } from "@/lib/auth"

const ASSIGNMENT_ID_SEPARATOR = "__"

const AssignmentIdentifierSchema = z.object({
  assignmentId: z.string().min(3),
})

const AssignmentOverrideInputSchema = z.object({
  assignmentId: z.string().min(3),
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  submissionId: z.string().min(1).nullable(),
  score: z.number().min(0).max(1),
  feedback: z.string().trim().max(2000).nullable().optional(),
})

const AssignmentResetInputSchema = z.object({
  assignmentId: z.string().min(3),
  activityId: z.string().min(1),
  pupilId: z.string().min(1),
  submissionId: z.string().min(1).nullable(),
})

const AssignmentResultsReturnSchema = z.object({
  data: AssignmentResultMatrixSchema.nullable(),
  error: z.string().nullable(),
})

const MutateAssignmentScoreReturnSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
})

type ParsedAssignmentKey = {
  groupId: string
  lessonId: string
}

function decodeAssignmentId(raw: string): ParsedAssignmentKey | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const [groupId, lessonId] = trimmed.split(ASSIGNMENT_ID_SEPARATOR)
  if (!groupId || !lessonId) {
    return null
  }

  return { groupId, lessonId }
}

function buildDisplayName(firstName: string | null, lastName: string | null, fallback: string) {
  const first = (firstName ?? "").trim()
  const last = (lastName ?? "").trim()
  const combined = `${first} ${last}`.trim()
  return combined.length > 0 ? combined : fallback
}

function normaliseTimestamp(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === "string") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString()
    }
  }
  return null
}

function normaliseDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) {
    return value.toISOString().split("T")[0]
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed
    }
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString().split("T")[0]
    }
  }
  return null
}

type SubmissionExtraction = {
  autoScore: number | null
  overrideScore: number | null
  effectiveScore: number | null
  feedback: string | null
}

function extractScoreFromSubmission(
  activityType: string,
  submissionBody: unknown,
): SubmissionExtraction {
  if (activityType === "multiple-choice-question") {
    const parsed = McqSubmissionBodySchema.safeParse(submissionBody)
    if (parsed.success) {
      const override =
        typeof parsed.data.teacher_override_score === "number" ? parsed.data.teacher_override_score : null
      const auto = parsed.data.is_correct ? 1 : 0
      const feedback =
        typeof parsed.data.teacher_feedback === "string" && parsed.data.teacher_feedback.trim().length > 0
          ? parsed.data.teacher_feedback.trim()
          : null
      return {
        autoScore: auto,
        overrideScore: override,
        effectiveScore: override ?? auto,
        feedback,
      }
    }

    const legacy = LegacyMcqSubmissionBodySchema.safeParse(submissionBody)
    if (legacy.success) {
      return {
        autoScore: null,
        overrideScore: null,
        effectiveScore: null,
        feedback: null,
      }
    }

    return { autoScore: null, overrideScore: null, effectiveScore: null, feedback: null }
  }

  if (activityType === "short-text-question") {
    const parsed = ShortTextSubmissionBodySchema.safeParse(submissionBody)
    if (parsed.success) {
      const auto =
        typeof parsed.data.ai_model_score === "number" && Number.isFinite(parsed.data.ai_model_score)
          ? parsed.data.ai_model_score
          : null
      const override =
        typeof parsed.data.teacher_override_score === "number"
        && Number.isFinite(parsed.data.teacher_override_score)
          ? parsed.data.teacher_override_score
          : null
      const feedback =
        typeof parsed.data.teacher_feedback === "string" && parsed.data.teacher_feedback.trim().length > 0
          ? parsed.data.teacher_feedback.trim()
          : null
      return {
        autoScore: auto,
        overrideScore: override,
        effectiveScore: override ?? auto,
        feedback,
      }
    }

    return { autoScore: null, overrideScore: null, effectiveScore: null, feedback: null }
  }

  if (submissionBody && typeof submissionBody === "object") {
    const record = submissionBody as Record<string, unknown>
    const overrideRaw = record.teacher_override_score ?? record.override_score
    const autoRaw = record.score ?? record.auto_score

    const toNumber = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value
      }
      if (typeof value === "string") {
        const parsed = Number.parseFloat(value)
        if (!Number.isNaN(parsed)) {
          return parsed
        }
      }
      return null
    }

    const auto = toNumber(autoRaw)
    const override = toNumber(overrideRaw)
    const feedback =
      typeof record.teacher_feedback === "string" && record.teacher_feedback.trim().length > 0
        ? record.teacher_feedback.trim()
        : null

    return {
      autoScore: auto,
      overrideScore: override,
      effectiveScore: override ?? auto,
      feedback,
    }
  }

  return { autoScore: null, overrideScore: null, effectiveScore: null, feedback: null }
}

function selectLatestSubmission(existing: { submittedAt: string | null }, nextSubmittedAt: string | null) {
  if (!existing.submittedAt) {
    return true
  }
  if (!nextSubmittedAt) {
    return false
  }
  return new Date(nextSubmittedAt).valueOf() >= new Date(existing.submittedAt).valueOf()
}

export async function readAssignmentResultsAction(assignmentId: string) {
  await requireTeacherProfile()

  const parsedInput = AssignmentIdentifierSchema.safeParse({ assignmentId })
  if (!parsedInput.success) {
    return AssignmentResultsReturnSchema.parse({
      data: null,
      error: "Invalid assignment identifier.",
    })
  }

  const identifiers = decodeAssignmentId(parsedInput.data.assignmentId)
  if (!identifiers) {
    return AssignmentResultsReturnSchema.parse({
      data: null,
      error: "Assignment not found.",
    })
  }

  const { groupId, lessonId } = identifiers

  try {
    const supabase = await createSupabaseServerClient()

    const [groupResult, lessonResult, assignmentResult] = await Promise.all([
      supabase
        .from("groups")
        .select("group_id, subject")
        .eq("group_id", groupId)
        .maybeSingle(),
      supabase
        .from("lessons")
        .select("lesson_id, unit_id, title")
        .eq("lesson_id", lessonId)
        .maybeSingle(),
      supabase
        .from("lesson_assignments")
        .select("group_id, lesson_id, start_date")
        .eq("group_id", groupId)
        .eq("lesson_id", lessonId)
        .maybeSingle(),
    ])

    if (groupResult.error) {
      console.error("[assignment-results] Failed to load group:", groupResult.error)
      return AssignmentResultsReturnSchema.parse({ data: null, error: "Unable to load group information." })
    }

    if (lessonResult.error) {
      console.error("[assignment-results] Failed to load lesson:", lessonResult.error)
      return AssignmentResultsReturnSchema.parse({ data: null, error: "Unable to load lesson information." })
    }

    if (!groupResult.data || !lessonResult.data) {
      return AssignmentResultsReturnSchema.parse({ data: null, error: "Assignment context not found." })
    }

    const { data: membershipRows, error: membershipError } = await supabase
      .from("group_membership")
      .select("user_id, role")
      .eq("group_id", groupId)

    if (membershipError) {
      console.error("[assignment-results] Failed to load group membership:", membershipError)
      return AssignmentResultsReturnSchema.parse({
        data: null,
        error: "Unable to load group membership.",
      })
    }

    const pupilMemberships = (membershipRows ?? []).filter((entry) => entry.role?.toLowerCase() === "pupil")
    const pupilIds = pupilMemberships.map((entry) => entry.user_id).filter((id): id is string => Boolean(id))

    const profilesByUserId = new Map<string, { firstName: string | null; lastName: string | null }>()

    if (pupilIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", pupilIds)

      if (profileError) {
        console.error("[assignment-results] Failed to load pupil profiles:", profileError)
      } else {
        for (const profile of profileRows ?? []) {
          if (!profile?.user_id) continue
          profilesByUserId.set(profile.user_id, {
            firstName: typeof profile.first_name === "string" ? profile.first_name : null,
            lastName: typeof profile.last_name === "string" ? profile.last_name : null,
          })
        }
      }
    }

    const pupils = pupilIds
      .map((userId) => {
        const profile = profilesByUserId.get(userId) ?? null
        const displayName = buildDisplayName(profile?.firstName ?? null, profile?.lastName ?? null, userId)
        return {
          userId,
          displayName,
          firstName: profile?.firstName ?? null,
          lastName: profile?.lastName ?? null,
        }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }))

    const { data: activityRows, error: activityError } = await supabase
      .from("activities")
      .select("activity_id, title, type, order_by, body_data, active")
      .eq("lesson_id", lessonId)
      .eq("active", true)
      .order("order_by", { ascending: true, nullsFirst: true })

    if (activityError) {
      console.error("[assignment-results] Failed to load activities:", activityError)
      return AssignmentResultsReturnSchema.parse({
        data: null,
        error: "Unable to load lesson activities.",
      })
    }

    const scorableActivities = (activityRows ?? []).filter((activity) => {
      const type = (activity.type ?? "").trim().toLowerCase()
      if (!type) return false
      if (type === "multiple-choice-question" || type === "short-text-question") {
        return true
      }
      if (type === "text" || type === "display-image" || type === "file-download" || type === "upload-file") {
        return false
      }
      if (type === "show-video" || type === "feedback" || type === "voice") {
        return false
      }
      return true
    })

    const activityIds = scorableActivities.map((activity) => activity.activity_id)

    const activitySuccessCriteriaMap = new Map<
      string,
      Array<{
        successCriteriaId: string
        title: string | null
        description: string | null
        level: number | null
      }>
    >()

    if (activityIds.length > 0) {
      const { data: activitySuccessCriteriaRows, error: activitySuccessCriteriaError } = await supabase
        .from("activity_success_criteria")
        .select("activity_id, success_criteria_id")
        .in("activity_id", activityIds)

      if (activitySuccessCriteriaError) {
        console.error("[assignment-results] Failed to load activity success criteria:", activitySuccessCriteriaError)
        return AssignmentResultsReturnSchema.parse({
          data: null,
          error: "Unable to load activity success criteria.",
        })
      }

      const successCriteriaIds = Array.from(
        new Set(
          (activitySuccessCriteriaRows ?? [])
            .map((row) => (typeof row?.success_criteria_id === "string" ? row.success_criteria_id : null))
            .filter((value): value is string => Boolean(value)),
        ),
      )

      const successCriteriaDetails = new Map<
        string,
        {
          title: string | null
          description: string | null
          level: number | null
        }
      >()

      if (successCriteriaIds.length > 0) {
        const { data: successCriteriaRows, error: successCriteriaError } = await supabase
          .from("success_criteria")
          .select("success_criteria_id, description, level")
          .in("success_criteria_id", successCriteriaIds)

        if (successCriteriaError) {
          console.error(
            "[assignment-results] Failed to load success criteria details:",
            successCriteriaError,
          )
        } else {
          for (const criterion of successCriteriaRows ?? []) {
            if (!criterion?.success_criteria_id) continue
            successCriteriaDetails.set(criterion.success_criteria_id, {
              title: null,
              description: typeof criterion.description === "string" ? criterion.description : null,
              level: typeof criterion.level === "number" ? criterion.level : null,
            })
          }
        }
      }

      for (const row of activitySuccessCriteriaRows ?? []) {
        const activityId = typeof row?.activity_id === "string" ? row.activity_id : null
        const successCriteriaId = typeof row?.success_criteria_id === "string" ? row.success_criteria_id : null
        if (!activityId || !successCriteriaId) continue

        const list =
          activitySuccessCriteriaMap.get(activityId) ??
          []

        const detail = successCriteriaDetails.get(successCriteriaId)
        list.push({
          successCriteriaId,
          title: detail?.title ?? null,
          description: detail?.description ?? null,
          level: detail?.level ?? null,
        })
        activitySuccessCriteriaMap.set(activityId, list)
      }
    }

    const activities = scorableActivities.map((activity) =>
      AssignmentResultActivitySchema.parse({
        activityId: activity.activity_id,
        title: activity.title ?? "Untitled activity",
        type: activity.type ?? "",
        orderIndex: typeof activity.order_by === "number" ? activity.order_by : null,
        successCriteria: activitySuccessCriteriaMap.get(activity.activity_id) ?? [],
      }),
    )

    const activityMap = new Map(activities.map((activity) => [activity.activityId, activity]))
    const activityTypeMap = new Map(
      scorableActivities.map((activity) => [activity.activity_id, activity.type ?? ""]),
    )

    let submissionRows: Array<{
      submission_id: string | null
      activity_id: string | null
      user_id: string | null
      submitted_at: string | Date | null
      body: unknown
    }> = []

    if (activityIds.length > 0 && pupilIds.length > 0) {
      const { data: submissions, error: submissionsError } = await supabase
        .from("submissions")
        .select("submission_id, activity_id, user_id, submitted_at, body")
        .in("activity_id", activityIds)
        .in("user_id", pupilIds)

      if (submissionsError) {
        console.error("[assignment-results] Failed to load submissions:", submissionsError)
        return AssignmentResultsReturnSchema.parse({
          data: null,
          error: "Unable to load submissions.",
        })
      }

      submissionRows = submissions ?? []
    }

    const baseCellMap = new Map<string, z.infer<typeof AssignmentResultCellSchema>>()

    for (const pupil of pupils) {
      for (const activity of activities) {
        const baseCell = AssignmentResultCellSchema.parse({
          activityId: activity.activityId,
          pupilId: pupil.userId,
          submissionId: null,
          score: null,
          autoScore: null,
          overrideScore: null,
          status: "missing",
          submittedAt: null,
          feedback: null,
        })
        baseCellMap.set(`${pupil.userId}::${activity.activityId}`, baseCell)
      }
    }

    for (const submission of submissionRows) {
      const activityId = submission.activity_id ?? ""
      const pupilId = submission.user_id ?? ""
      if (!activityMap.has(activityId) || !pupilIds.includes(pupilId)) {
        continue
      }

      const key = `${pupilId}::${activityId}`
      const existingCell = baseCellMap.get(key)
      if (!existingCell) {
        continue
      }

      const submittedAt = normaliseTimestamp(submission.submitted_at)
      if (!selectLatestSubmission(existingCell, submittedAt)) {
        continue
      }

      const activityType = activityTypeMap.get(activityId) ?? ""
      const extracted = extractScoreFromSubmission(activityType, submission.body)
      const status =
        typeof extracted.overrideScore === "number"
          ? "override"
          : typeof extracted.effectiveScore === "number"
            ? "auto"
            : "missing"

      baseCellMap.set(
        key,
        AssignmentResultCellSchema.parse({
          activityId,
          pupilId,
          submissionId: submission.submission_id ?? null,
          score: extracted.effectiveScore,
          autoScore: extracted.autoScore,
          overrideScore: extracted.overrideScore,
          status,
          submittedAt,
          feedback: extracted.feedback,
        }),
      )
    }

    const activityTotals = new Map<
      string,
      {
        total: number
        count: number
        submittedCount: number
      }
    >()
    const rows = pupils.map((pupil) => {
      const cells = activities.map((activity) => {
        const key = `${pupil.userId}::${activity.activityId}`
        const resolved = baseCellMap.get(key)
        if (!resolved) {
          return AssignmentResultCellSchema.parse({
            activityId: activity.activityId,
            pupilId: pupil.userId,
            submissionId: null,
            score: null,
            autoScore: null,
            overrideScore: null,
            status: "missing",
            submittedAt: null,
            feedback: null,
          })
        }
        const entry = activityTotals.get(activity.activityId) ?? {
          total: 0,
          count: 0,
          submittedCount: 0,
        }
        if (typeof resolved.score === "number") {
          entry.total += resolved.score
          entry.submittedCount += 1
        } else {
          entry.total += 0
        }
        entry.count += 1
        activityTotals.set(activity.activityId, entry)
        return resolved
      })

      const activityCount = activities.length
      const totalScore = cells.reduce(
        (acc, cell) => acc + (typeof cell.score === "number" ? cell.score : 0),
        0,
      )
      const averageScore =
        activityCount > 0 ? totalScore / activityCount : null

      return AssignmentResultRowSchema.parse({
        pupil,
        cells,
        averageScore,
      })
    })

    let overallTotal = 0
    let overallCount = 0

    for (const activity of activities) {
      const entry = activityTotals.get(activity.activityId)
      if (entry) {
        overallTotal += entry.total
        overallCount += entry.count
      }
    }

    const activitySummaries = activities.map((activity) => {
      const entry = activityTotals.get(activity.activityId)
      return {
        activityId: activity.activityId,
        averageScore: entry && entry.count > 0 ? entry.total / entry.count : null,
        submittedCount: entry?.submittedCount ?? 0,
      }
    })

    const successCriteriaTotals = new Map<
      string,
      {
        total: number
        count: number
        submittedCount: number
        activityIds: Set<string>
        title: string | null
        description: string | null
      }
    >()

    for (const activity of activities) {
      const totalsEntry = activityTotals.get(activity.activityId) ?? {
        total: 0,
        count: 0,
        submittedCount: 0,
      }

      for (const criterion of activity.successCriteria) {
        const existing = successCriteriaTotals.get(criterion.successCriteriaId) ?? {
          total: 0,
          count: 0,
          submittedCount: 0,
          activityIds: new Set<string>(),
          title: criterion.title ?? null,
          description: criterion.description ?? null,
        }

        existing.total += totalsEntry.total
        existing.count += totalsEntry.count
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

    const successCriteriaSummaries = Array.from(successCriteriaTotals.entries()).map(([successCriteriaId, entry]) => ({
      successCriteriaId,
      title: entry.title ?? null,
      description: entry.description ?? null,
      averageScore: entry.count > 0 ? entry.total / entry.count : null,
      submittedCount: entry.submittedCount,
      activityCount: entry.activityIds.size,
    }))

    const result = AssignmentResultMatrixSchema.parse({
      assignmentId: parsedInput.data.assignmentId,
      group: groupResult.data
        ? {
            groupId: groupResult.data.group_id,
            subject: groupResult.data.subject ?? null,
          }
        : null,
      lesson: lessonResult.data
        ? {
            lessonId: lessonResult.data.lesson_id,
            title: lessonResult.data.title ?? "Untitled lesson",
            unitId: lessonResult.data.unit_id ?? null,
          }
        : null,
      assignment: assignmentResult.data
        ? {
            groupId: assignmentResult.data.group_id,
            lessonId: assignmentResult.data.lesson_id,
            startDate: normaliseDate(assignmentResult.data.start_date),
          }
        : {
            groupId,
            lessonId,
            startDate: null,
          },
      pupils,
      activities,
      rows,
      activitySummaries,
      successCriteriaSummaries,
      overallAverage: overallCount > 0 ? overallTotal / overallCount : null,
    })

    return AssignmentResultsReturnSchema.parse({ data: result, error: null })
  } catch (error) {
    console.error("[assignment-results] Unexpected error building results matrix:", error)
    return AssignmentResultsReturnSchema.parse({
      data: null,
      error: "Unable to load assignment results.",
    })
  }
}

async function getSubmissionRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  activityId: string,
  pupilId: string,
  submissionId: string | null,
) {
  if (submissionId) {
    const { data, error } = await supabase
      .from("submissions")
      .select("submission_id, body, submitted_at")
      .eq("submission_id", submissionId)
      .maybeSingle()

    if (error) {
      return { data: null, error }
    }

    if (data) {
      return { data, error: null }
    }
  }

  const { data, error } = await supabase
    .from("submissions")
    .select("submission_id, body, submitted_at")
    .eq("activity_id", activityId)
    .eq("user_id", pupilId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { data: null, error }
  }

  return { data, error: null }
}

export async function overrideAssignmentScoreAction(input: z.infer<typeof AssignmentOverrideInputSchema>) {
  await requireTeacherProfile()

  const parsed = AssignmentOverrideInputSchema.safeParse(input)
  if (!parsed.success) {
    return MutateAssignmentScoreReturnSchema.parse({
      success: false,
      error: "Invalid override payload.",
    })
  }

  const identifiers = decodeAssignmentId(parsed.data.assignmentId)
  if (!identifiers) {
    return MutateAssignmentScoreReturnSchema.parse({
      success: false,
      error: "Assignment not found.",
    })
  }

  try {
    const supabase = await createSupabaseServerClient()

    const { data: activityRow, error: activityError } = await supabase
      .from("activities")
      .select("activity_id, type")
      .eq("activity_id", parsed.data.activityId)
      .maybeSingle()

    if (activityError) {
      console.error("[assignment-results] Failed to load activity for override:", activityError)
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Unable to load activity.",
      })
    }

    if (!activityRow) {
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Activity not found.",
      })
    }

    const submissionLookup = await getSubmissionRow(
      supabase,
      parsed.data.activityId,
      parsed.data.pupilId,
      parsed.data.submissionId,
    )

    if (submissionLookup.error) {
      console.error("[assignment-results] Failed to load submission for override:", submissionLookup.error)
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Unable to load submission.",
      })
    }

    if (!submissionLookup.data) {
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Submission not found for this pupil.",
      })
    }

    const submissionId = submissionLookup.data.submission_id
    const submittedAt = normaliseTimestamp(submissionLookup.data.submitted_at) ?? new Date().toISOString()
    const body = submissionLookup.data.body ?? {}
    const type = (activityRow.type ?? "").trim()

    let nextBody: Record<string, unknown> = {}

    if (type === "short-text-question") {
      const parsedBody = ShortTextSubmissionBodySchema.safeParse(body)
      if (!parsedBody.success) {
        console.error("[assignment-results] Invalid short-text submission body:", parsedBody.error)
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Submission data is invalid.",
        })
      }

      nextBody = {
        ...parsedBody.data,
        teacher_override_score: parsed.data.score,
        teacher_feedback: parsed.data.feedback ?? null,
      }
    } else if (type === "multiple-choice-question") {
      const parsedBody = McqSubmissionBodySchema.safeParse(body)
      if (!parsedBody.success) {
        console.error("[assignment-results] Invalid MCQ submission body:", parsedBody.error)
        return MutateAssignmentScoreReturnSchema.parse({
          success: false,
          error: "Submission data is invalid.",
        })
      }

      nextBody = {
        ...parsedBody.data,
        teacher_override_score: parsed.data.score,
        teacher_feedback: parsed.data.feedback ?? null,
      }
    } else {
      if (body && typeof body === "object") {
        const record = body as Record<string, unknown>
        nextBody = {
          ...record,
          teacher_override_score: parsed.data.score,
          teacher_feedback: parsed.data.feedback ?? null,
        }
      } else {
        nextBody = {
          teacher_override_score: parsed.data.score,
          teacher_feedback: parsed.data.feedback ?? null,
        }
      }
    }

    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        body: nextBody,
        submitted_at: submittedAt,
      })
      .eq("submission_id", submissionId)

    if (updateError) {
      console.error("[assignment-results] Failed to apply score override:", updateError)
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Unable to save override.",
      })
    }

    revalidatePath(`/results/assignments/${parsed.data.assignmentId}`)

    return MutateAssignmentScoreReturnSchema.parse({ success: true, error: null })
  } catch (error) {
    console.error("[assignment-results] Unexpected error overriding score:", error)
    return MutateAssignmentScoreReturnSchema.parse({
      success: false,
      error: "Unable to save override.",
    })
  }
}

export async function resetAssignmentScoreAction(input: z.infer<typeof AssignmentResetInputSchema>) {
  await requireTeacherProfile()

  const parsed = AssignmentResetInputSchema.safeParse(input)
  if (!parsed.success) {
    return MutateAssignmentScoreReturnSchema.parse({
      success: false,
      error: "Invalid reset payload.",
    })
  }

  const identifiers = decodeAssignmentId(parsed.data.assignmentId)
  if (!identifiers) {
    return MutateAssignmentScoreReturnSchema.parse({
      success: false,
      error: "Assignment not found.",
    })
  }

  try {
    const supabase = await createSupabaseServerClient()

    const submissionLookup = await getSubmissionRow(
      supabase,
      parsed.data.activityId,
      parsed.data.pupilId,
      parsed.data.submissionId,
    )

    if (submissionLookup.error) {
      console.error("[assignment-results] Failed to load submission for reset:", submissionLookup.error)
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Unable to load submission.",
      })
    }

    if (!submissionLookup.data) {
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Submission not found for this pupil.",
      })
    }

    const submissionId = submissionLookup.data.submission_id
    const body = submissionLookup.data.body ?? {}

    let nextBody: Record<string, unknown> = {}

    if (body && typeof body === "object") {
      nextBody = {
        ...(body as Record<string, unknown>),
        teacher_override_score: null,
        teacher_feedback: null,
      }
    } else {
      nextBody = {
        teacher_override_score: null,
        teacher_feedback: null,
      }
    }

    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        body: nextBody,
      })
      .eq("submission_id", submissionId)

    if (updateError) {
      console.error("[assignment-results] Failed to reset score override:", updateError)
      return MutateAssignmentScoreReturnSchema.parse({
        success: false,
        error: "Unable to reset override.",
      })
    }

    revalidatePath(`/results/assignments/${parsed.data.assignmentId}`)

    return MutateAssignmentScoreReturnSchema.parse({ success: true, error: null })
  } catch (error) {
    console.error("[assignment-results] Unexpected error resetting score:", error)
    return MutateAssignmentScoreReturnSchema.parse({
      success: false,
      error: "Unable to reset override.",
    })
  }
}
