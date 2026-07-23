"use server"

import { requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { readAllLearningObjectivesAction } from "@/lib/server-actions/learning-objectives"
import { createLessonActivityAction } from "@/lib/server-actions/lesson-activities"
import { McqActivityBodySchema, ShortTextActivityBodySchema } from "@/types"
import {
  generateLessonChatReply,
  type ChatTurn,
  type ProposedActivity,
} from "@/lib/ai/lesson-chat-gemini"

const HISTORY_WINDOW = 20

interface LessonChatContext {
  unitId: string | null
  lessonTitle: string
  systemText: string
  validScIds: Set<string>
}

/** Gather the lesson's LOs, success criteria (with IDs) and existing activities. */
async function getLessonChatContext(lessonId: string): Promise<LessonChatContext> {
  const { rows: lessonRows } = await query<{ title: string | null; unit_id: string | null }>(
    `select title, unit_id from lessons where lesson_id = $1 limit 1`,
    [lessonId],
  )
  const lessonTitle = lessonRows[0]?.title ?? "this lesson"
  const unitId = lessonRows[0]?.unit_id ?? null

  const loResult = unitId ? await readAllLearningObjectivesAction({ unitId }) : { data: [], error: null }
  const los = loResult.data ?? []

  const validScIds = new Set<string>()
  const loLines = los.map((lo) => {
    const scLines = (lo.success_criteria ?? []).map((sc) => {
      if (sc.success_criteria_id) validScIds.add(sc.success_criteria_id)
      return `    - [${sc.success_criteria_id}] ${sc.description ?? ""}`
    })
    return `  • ${lo.title ?? "Untitled objective"}\n${scLines.join("\n")}`
  })

  const { rows: activityRows } = await query<{ title: string | null; type: string | null; body_data: unknown }>(
    `select title, type, body_data from activities where lesson_id = $1 and active is not false order by order_by asc nulls last`,
    [lessonId],
  )
  const activityLines = activityRows.map((a) => {
    const body = (a.body_data ?? {}) as { question?: string }
    const q = typeof body.question === "string" && body.question.trim() ? ` — "${body.question.trim().slice(0, 120)}"` : ""
    return `  • ${a.title ?? "Untitled"} (${a.type ?? "unknown"})${q}`
  })

  const systemText = [
    "You are an assistant that helps a teacher author lesson activities for the lesson below.",
    "You can ONLY propose two activity types: multiple-choice-question (MCQ) and short-text-question (STQ).",
    "You never create activities yourself — you return proposals as structured data; the teacher confirms them.",
    "",
    "Rules:",
    "- MCQ: provide 2–4 options and correctOptionIndex (0-based).",
    "- STQ: provide a concise modelAnswer used for AI marking.",
    "- Align each proposal to the lesson's success criteria where sensible, using successCriteriaIds — you may ONLY use the SC IDs listed below; never invent IDs.",
    "- Keep questions clear and grade-appropriate; base them on the lesson's objectives and existing activities unless the teacher says otherwise.",
    "- Put a short conversational reply in `message` and the activities in `proposals` (empty array if none this turn).",
    "",
    `Lesson: ${lessonTitle}`,
    "",
    "Learning objectives and success criteria (IDs in brackets):",
    loLines.length ? loLines.join("\n") : "  (none defined)",
    "",
    "Existing activities in this lesson:",
    activityLines.length ? activityLines.join("\n") : "  (none yet)",
  ].join("\n")

  return { unitId, lessonTitle, systemText, validScIds }
}

/** Load a bounded window of prior chat turns for the model. */
async function loadHistory(lessonId: string): Promise<ChatTurn[]> {
  const { rows } = await query<{ role: "user" | "assistant"; content: string }>(
    `select role, content from lesson_chat_messages where lesson_id = $1 order by created_at asc`,
    [lessonId],
  )
  const turns = rows.map((r) => ({ role: r.role, content: r.content }))
  return turns.slice(-HISTORY_WINDOW)
}

export type LessonChatMessageRecord = {
  message_id: string
  role: "user" | "assistant"
  content: string
  proposals: ProposedActivity[] | null
  created_at: string
}

/** Full chat history for display when the panel opens. */
export async function readLessonChatAction(lessonId: string): Promise<{
  success: boolean
  data: LessonChatMessageRecord[]
  error: string | null
}> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, data: [], error: "Unauthorized" }
  try {
    const { rows } = await query<LessonChatMessageRecord>(
      `select message_id, role, content, proposals, created_at::text as created_at
       from lesson_chat_messages where lesson_id = $1 order by created_at asc`,
      [lessonId],
    )
    return { success: true, data: rows, error: null }
  } catch (err) {
    console.error("[lesson-chat] read failed", err)
    return { success: false, data: [], error: "Failed to load chat." }
  }
}

/** Send a teacher message; returns the assistant reply + proposed activities. */
export async function sendLessonChatMessageAction(input: {
  lessonId: string
  message: string
}): Promise<{ success: boolean; message: string; proposals: ProposedActivity[]; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, message: "", proposals: [], error: "Unauthorized" }

  const lessonId = input.lessonId?.trim()
  const userMessage = input.message?.trim()
  if (!lessonId || !userMessage) {
    return { success: false, message: "", proposals: [], error: "Missing lesson or message." }
  }

  try {
    const context = await getLessonChatContext(lessonId)
    const history = await loadHistory(lessonId)

    await query(
      `insert into lesson_chat_messages (lesson_id, teacher_id, role, content) values ($1, $2, 'user', $3)`,
      [lessonId, profile.userId, userMessage],
    )

    const reply = await generateLessonChatReply({
      systemText: context.systemText,
      history,
      userMessage,
    })

    // Keep only proposals that reference valid SC IDs (drop hallucinated ones).
    const proposals = reply.proposals.map((p) => ({
      ...p,
      successCriteriaIds: (p.successCriteriaIds ?? []).filter((id) => context.validScIds.has(id)),
    }))

    await query(
      `insert into lesson_chat_messages (lesson_id, teacher_id, role, content, proposals) values ($1, $2, 'assistant', $3, $4::jsonb)`,
      [lessonId, profile.userId, reply.message, JSON.stringify(proposals)],
    )

    return { success: true, message: reply.message, proposals, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed."
    console.error("[lesson-chat] send failed", err)
    return { success: false, message: "", proposals: [], error: message }
  }
}

/** Create one confirmed proposal as a real activity (reuses the create action). */
export async function confirmProposedActivityAction(input: {
  lessonId: string
  proposal: ProposedActivity
}): Promise<{ success: boolean; error: string | null; activity: unknown }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized", activity: null }

  const { lessonId, proposal } = input
  if (!lessonId || !proposal) return { success: false, error: "Missing parameters.", activity: null }

  const { rows } = await query<{ unit_id: string | null }>(
    `select unit_id from lessons where lesson_id = $1 limit 1`,
    [lessonId],
  )
  const unitId = rows[0]?.unit_id
  if (!unitId) return { success: false, error: "Lesson has no unit.", activity: null }

  const context = await getLessonChatContext(lessonId)
  const successCriteriaIds = (proposal.successCriteriaIds ?? []).filter((id) => context.validScIds.has(id))

  let bodyData: unknown
  if (proposal.type === "multiple-choice-question") {
    const options = (proposal.options ?? []).map((text, i) => ({ id: `opt-${i + 1}`, text }))
    const idx = proposal.correctOptionIndex ?? 0
    const built = { question: proposal.question, options, correctOptionId: `opt-${idx + 1}` }
    const parsed = McqActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid MCQ proposal.", activity: null }
    bodyData = parsed.data
  } else if (proposal.type === "short-text-question") {
    const built = { question: proposal.question, modelAnswer: proposal.modelAnswer ?? "" }
    const parsed = ShortTextActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid STQ proposal.", activity: null }
    bodyData = parsed.data
  } else {
    return { success: false, error: "Unsupported activity type.", activity: null }
  }

  const result = await createLessonActivityAction(unitId, lessonId, {
    title: proposal.title,
    type: proposal.type,
    bodyData,
    successCriteriaIds,
    maxMarks: proposal.maxMarks,
  })

  return { success: result.success, error: result.error ?? null, activity: result.data ?? null }
}

/** Clear a lesson's chat history. */
export async function clearLessonChatAction(lessonId: string): Promise<{ success: boolean; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized" }
  try {
    await query(`delete from lesson_chat_messages where lesson_id = $1`, [lessonId])
    return { success: true, error: null }
  } catch (err) {
    console.error("[lesson-chat] clear failed", err)
    return { success: false, error: "Failed to clear chat." }
  }
}
