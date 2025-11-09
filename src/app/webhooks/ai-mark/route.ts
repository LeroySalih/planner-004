import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { ShortTextSubmissionBodySchema } from "@/types"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { clampScore, fetchActivitySuccessCriteriaIds, normaliseSuccessCriteriaScores } from "@/lib/scoring/success-criteria"

export const dynamic = "force-dynamic"

const SHORT_TEXT_ACTIVITY_TYPE = "short-text-question"
const SHORT_TEXT_CORRECTNESS_THRESHOLD = 0.8

const PupilAnswerSchema = z
  .object({
    pupilid: z.string().uuid().optional(),
    pupilId: z.string().uuid().optional(),
    pupil_id: z.string().uuid().optional(),
    answer: z.string().optional().nullable(),
  })
  .refine((value) => value.pupilid || value.pupilId || value.pupil_id, {
    message: "pupil identifier is required",
    path: ["pupilid"],
  })

const ResultEntrySchema = z.object({
  pupilid: z.string().uuid(),
  score: z.number().min(0).max(1),
  feedback: z.string().optional().nullable(),
})

const PayloadSchema = z.object({
  group_assignment_id: z.string().min(3),
  activity_id: z.string().uuid(),
  dataSent: z
    .object({
      group_assignment_id: z.string().min(3).optional(),
      activity_id: z.string().uuid().optional(),
      question: z.string().optional(),
      model_answer: z.string().optional(),
      pupil_answers: z.array(PupilAnswerSchema).optional(),
    })
    .passthrough()
    .optional(),
  results: z.array(ResultEntrySchema),
})

type WebhookPayload = z.infer<typeof PayloadSchema>
type ResultEntry = z.infer<typeof ResultEntrySchema>

export async function POST(request: Request) {
  const expectedKey = process.env.AI_MARK_SERVICE_KEY
  if (!expectedKey || expectedKey.trim().length === 0) {
    console.error("[ai-mark-webhook] AI_MARK_SERVICE_KEY is not configured")
    return NextResponse.json({ success: false, error: "AI mark webhook is not configured." }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null
  if (!token || token !== expectedKey) {
    console.warn("[ai-mark-webhook] Unauthorized webhook attempt.")
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch (error) {
    console.error("[ai-mark-webhook] Failed to parse payload", error)
    return NextResponse.json({ success: false, error: "Invalid JSON payload." }, { status: 400 })
  }

  const parsed = PayloadSchema.safeParse(json)
  if (!parsed.success) {
    console.error("[ai-mark-webhook] Payload validation failed", parsed.error)
    return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 })
  }

  if (parsed.data.results.length === 0) {
    return NextResponse.json({ success: true, updated: 0, created: 0, skipped: 0 })
  }

  const assignmentIdentifiers = decodeAssignmentIdentifier(parsed.data.group_assignment_id)
  if (!assignmentIdentifiers) {
    return NextResponse.json({ success: false, error: "Invalid group assignment identifier." }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  const { data: activityRow, error: activityError } = await supabase
    .from("activities")
    .select("activity_id, type, lesson_id")
    .eq("activity_id", parsed.data.activity_id)
    .maybeSingle()

  if (activityError) {
    console.error("[ai-mark-webhook] Failed to load activity", activityError)
    return NextResponse.json({ success: false, error: "Unable to load activity." }, { status: 500 })
  }

  if (!activityRow) {
    return NextResponse.json({ success: false, error: "Activity not found." }, { status: 404 })
  }

  if ((activityRow.type ?? "").trim() !== SHORT_TEXT_ACTIVITY_TYPE) {
    console.info("[ai-mark-webhook] Activity type not supported for AI mark", {
      activityId: parsed.data.activity_id,
      type: activityRow.type,
    })
    return NextResponse.json(
      { success: true, updated: 0, created: 0, skipped: parsed.data.results.length, info: "Activity not supported." },
      { status: 202 },
    )
  }

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(supabase, parsed.data.activity_id)
  const pupilIds = parsed.data.results.map((entry) => entry.pupilid)

  const { data: submissionRows, error: submissionsError } = await supabase
    .from("submissions")
    .select("submission_id, user_id, body, submitted_at")
    .eq("activity_id", parsed.data.activity_id)
    .in("user_id", pupilIds)

  if (submissionsError) {
    console.error("[ai-mark-webhook] Failed to load submissions", submissionsError)
    return NextResponse.json({ success: false, error: "Unable to load submissions." }, { status: 500 })
  }

  const submissionsByPupil = new Map(
    (submissionRows ?? [])
      .filter((row) => typeof row.user_id === "string")
      .map((row) => [row.user_id as string, row]),
  )

  const answersByPupil = buildAnswersMap(parsed.data)

  const summary = {
    updated: 0,
    created: 0,
    skipped: 0,
    errors: 0,
  }

  for (const result of parsed.data.results) {
    const existingSubmission = submissionsByPupil.get(result.pupilid) ?? null
    try {
      if (existingSubmission) {
        const updated = await applyAiMarkToSubmission({
          supabase,
          submission: existingSubmission,
          result,
          successCriteriaIds,
          answerFallback: answersByPupil.get(result.pupilid) ?? null,
        })
        if (updated) {
          summary.updated += 1
        } else {
          summary.skipped += 1
        }
      } else {
        const created = await createAiMarkedSubmission({
          supabase,
          activityId: parsed.data.activity_id,
          pupilId: result.pupilid,
          result,
          successCriteriaIds,
          answer: answersByPupil.get(result.pupilid) ?? null,
        })
        if (created) {
          summary.created += 1
        } else {
          summary.skipped += 1
        }
      }
    } catch (error) {
      summary.errors += 1
      console.error("[ai-mark-webhook] Failed to apply AI mark for pupil", {
        pupilId: result.pupilid,
        error,
      })
    }
  }

  if (summary.errors === 0) {
    const assignmentPath = `/results/assignments/${encodeURIComponent(parsed.data.group_assignment_id)}`
    revalidatePath(assignmentPath)
  }

  return NextResponse.json({ success: summary.errors === 0, ...summary })
}

function decodeAssignmentIdentifier(raw: string): { groupId: string; lessonId: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  const [groupId, lessonId] = trimmed.split("__")
  if (!groupId || !lessonId) {
    return null
  }
  return { groupId, lessonId }
}

function buildAnswersMap(payload: WebhookPayload): Map<string, string> {
  const map = new Map<string, string>()
  const answers = payload.dataSent?.pupil_answers ?? []
  for (const entry of answers ?? []) {
    const pupilId = entry?.pupilid ?? entry?.pupilId ?? entry?.pupil_id
    if (entry && typeof pupilId === "string" && typeof entry.answer === "string") {
      map.set(pupilId, entry.answer)
    }
  }
  return map
}

function computeIsCorrect(score: number | null): boolean {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return false
  }
  return score >= SHORT_TEXT_CORRECTNESS_THRESHOLD
}

async function applyAiMarkToSubmission({
  supabase,
  submission,
  result,
  successCriteriaIds,
  answerFallback,
}: {
  supabase: ReturnType<typeof createSupabaseServiceClient>
  submission: { submission_id: string; body: unknown; submitted_at?: string | null }
  result: ResultEntry
  successCriteriaIds: string[]
  answerFallback: string | null
}) {
  const parsedBody = ShortTextSubmissionBodySchema.safeParse(submission.body ?? {})
  const baseBody = parsedBody.success ? parsedBody.data : ShortTextSubmissionBodySchema.parse({})

  const hasTeacherOverride =
    typeof baseBody.teacher_override_score === "number" && Number.isFinite(baseBody.teacher_override_score)

  const aiScore = clampScore(result.score)
  const effectiveScore = hasTeacherOverride ? baseBody.teacher_override_score : aiScore
  const teacherFeedback = baseBody.teacher_feedback ?? null
  const existingAiFeedback =
    typeof baseBody.ai_model_feedback === "string" && baseBody.ai_model_feedback.trim().length > 0
      ? baseBody.ai_model_feedback.trim()
      : null
  const incomingAiFeedback = (result.feedback?.trim() ?? "") || null
  const nextAiFeedback = incomingAiFeedback ?? existingAiFeedback ?? null

  const nextBody = ShortTextSubmissionBodySchema.parse({
    ...baseBody,
    answer: baseBody.answer ?? answerFallback ?? "",
    ai_model_score: aiScore,
    is_correct: computeIsCorrect(effectiveScore ?? null),
    teacher_feedback: teacherFeedback,
    ai_model_feedback: nextAiFeedback,
    success_criteria_scores: normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: effectiveScore ?? 0,
    }),
  })

  const { error } = await supabase
    .from("submissions")
    .update({ body: nextBody })
    .eq("submission_id", submission.submission_id)

  if (error) {
    throw error
  }

  return true
}

async function createAiMarkedSubmission({
  supabase,
  activityId,
  pupilId,
  result,
  successCriteriaIds,
  answer,
}: {
  supabase: ReturnType<typeof createSupabaseServiceClient>
  activityId: string
  pupilId: string
  result: ResultEntry
  successCriteriaIds: string[]
  answer: string | null
}) {
  const score = clampScore(result.score)
  const successCriteriaScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: score,
  })

  const submissionBody = ShortTextSubmissionBodySchema.parse({
    answer: answer ?? "",
    ai_model_score: score,
    teacher_override_score: null,
    teacher_feedback: null,
    ai_model_feedback: (result.feedback?.trim() ?? "") || null,
    is_correct: computeIsCorrect(score),
    success_criteria_scores: successCriteriaScores,
  })

  const { error } = await supabase.from("submissions").insert({
    activity_id: activityId,
    user_id: pupilId,
    submitted_at: new Date().toISOString(),
    body: submissionBody,
  })

  if (error) {
    throw error
  }

  return true
}
