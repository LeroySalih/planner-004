"use server"

import { requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { readAllLearningObjectivesAction } from "@/lib/server-actions/learning-objectives"
import { createLessonActivityAction } from "@/lib/server-actions/lesson-activities"
import {
  GroupItemsActivityBodySchema,
  MatcherActivityBodySchema,
  McqActivityBodySchema,
  SequenceActivityBodySchema,
  ShortTextActivityBodySchema,
  UploadUrlActivityBodySchema,
} from "@/types"
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
    "You can propose these activity types:",
    "- multiple-choice-question (MCQ)",
    "- short-text-question (STQ)",
    "- text (Display Text: informational content shown to pupils)",
    "- display-section (Display Section: a heading that groups the activities that follow it)",
    "- show-video (Display Video: embeds a video)",
    "- upload-file (pupils upload a file)",
    "- upload-url (pupils submit a link)",
    "- voice (pupils record a voice response)",
    "- matcher (pupils match terms to definitions)",
    "- group-items (pupils sort items into named groups)",
    "- sequence (pupils arrange items into the correct order)",
    "You never create activities yourself — you return proposals as structured data; the teacher confirms them.",
    "",
    "Each proposal always includes every field; fill the ones relevant to its type and leave the rest empty (\"\" or []):",
    "- MCQ: set `question`; set `options` to 2–4 items, each with `text` and a `correct` boolean, EXACTLY ONE correct: true.",
    "- STQ: set `question` and a concise `modelAnswer` (used for AI marking).",
    "- text: set `text` to the content to display (a few clear sentences).",
    "- display-section: set `text` to the section heading.",
    "- show-video: set `videoUrl` ONLY if the teacher gave you a URL — never invent a video URL; otherwise leave it empty for the teacher to fill.",
    "- upload-file / upload-url / voice: set `text` to the pupil-facing instructions/prompt.",
    "- matcher: set `pairs` to 2–8 items, each with a `term` and its `definition`.",
    "- group-items: set `groups` to 2–4 group names, and `items` to 2–12 items, each with `text` and a `group` that EXACTLY matches one of the group names.",
    "- sequence: set `sequence` to 2–12 short items in the CORRECT order (first to last).",
    "- Align scorable activities to the lesson's success criteria where sensible, using successCriteriaIds — you may ONLY use the SC IDs listed below; never invent IDs. Display types (text, section, video) have no success criteria.",
    "- Keep content clear and grade-appropriate; base it on the lesson's objectives and existing activities unless the teacher says otherwise.",
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
}): Promise<{ success: boolean; messageId: string | null; message: string; proposals: ProposedActivity[]; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, messageId: null, message: "", proposals: [], error: "Unauthorized" }

  const lessonId = input.lessonId?.trim()
  const userMessage = input.message?.trim()
  if (!lessonId || !userMessage) {
    return { success: false, messageId: null, message: "", proposals: [], error: "Missing lesson or message." }
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

    const { rows: inserted } = await query<{ message_id: string }>(
      `insert into lesson_chat_messages (lesson_id, teacher_id, role, content, proposals) values ($1, $2, 'assistant', $3, $4::jsonb) returning message_id`,
      [lessonId, profile.userId, reply.message, JSON.stringify(proposals)],
    )

    return { success: true, messageId: inserted[0]?.message_id ?? null, message: reply.message, proposals, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed."
    console.error("[lesson-chat] send failed", err)
    return { success: false, messageId: null, message: "", proposals: [], error: message }
  }
}

/** Persist an edited proposal back into a stored assistant message (keeps the
 * chat consistent with what the teacher added/changed). */
export async function updateProposalInChatAction(input: {
  messageId: string
  proposalIndex: number
  proposal: ProposedActivity
}): Promise<{ success: boolean; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized" }
  const { messageId, proposalIndex, proposal } = input
  if (!messageId || proposalIndex < 0 || !proposal) return { success: false, error: "Missing parameters." }
  try {
    await query(
      `update lesson_chat_messages
         set proposals = jsonb_set(coalesce(proposals, '[]'::jsonb), array[$2::text], $3::jsonb, false)
       where message_id = $1`,
      [messageId, String(proposalIndex), JSON.stringify(proposal)],
    )
    return { success: true, error: null }
  } catch (err) {
    console.error("[lesson-chat] update proposal failed", err)
    return { success: false, error: "Failed to update chat." }
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
  let linkSuccessCriteria = false
  if (proposal.type === "multiple-choice-question") {
    const rawOptions = proposal.options ?? []
    const options = rawOptions.map((o, i) => ({ id: `opt-${i + 1}`, text: o.text }))
    const correctIdx = rawOptions.findIndex((o) => o.correct)
    const built = { question: proposal.question, options, correctOptionId: `opt-${(correctIdx >= 0 ? correctIdx : 0) + 1}` }
    const parsed = McqActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid MCQ proposal.", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "short-text-question") {
    const built = { question: proposal.question, modelAnswer: proposal.modelAnswer ?? "" }
    const parsed = ShortTextActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid STQ proposal.", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "text") {
    bodyData = { text: proposal.text ?? "" }
  } else if (proposal.type === "display-section") {
    bodyData = { description: proposal.text ?? "" }
  } else if (proposal.type === "show-video") {
    bodyData = { fileUrl: proposal.videoUrl ?? "" }
  } else if (proposal.type === "upload-file") {
    bodyData = { instructions: proposal.text ?? "" }
    linkSuccessCriteria = true
  } else if (proposal.type === "upload-url") {
    const built = { question: proposal.text ?? "" }
    const parsed = UploadUrlActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid Upload URL proposal.", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "voice") {
    bodyData = { audioFile: null, instructions: proposal.text ?? "" }
    linkSuccessCriteria = true
  } else if (proposal.type === "matcher") {
    const pairs = (proposal.pairs ?? []).map((p, i) => ({ id: `pair-${i + 1}`, term: p.term, definition: p.definition }))
    const parsed = MatcherActivityBodySchema.safeParse({ pairs })
    if (!parsed.success) return { success: false, error: "Invalid Matcher proposal (need 2–8 term/definition pairs).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "group-items") {
    const groups = (proposal.groups ?? []).map((name, i) => ({ id: `grp-${i + 1}`, name }))
    const byName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]))
    const items = (proposal.items ?? []).map((it, i) => ({
      id: `item-${i + 1}`,
      text: it.text,
      groupId: byName.get((it.group ?? "").trim().toLowerCase()) ?? groups[0]?.id ?? "",
    }))
    const parsed = GroupItemsActivityBodySchema.safeParse({ groups, items })
    if (!parsed.success) return { success: false, error: "Invalid Group Items proposal (2–4 groups, 2–12 items).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "sequence") {
    const terms = (proposal.sequence ?? []).map((text, i) => ({ id: `term-${i + 1}`, text }))
    const parsed = SequenceActivityBodySchema.safeParse({ terms })
    if (!parsed.success) return { success: false, error: "Invalid Sequence proposal (need 2–12 items).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else {
    return { success: false, error: "Unsupported activity type.", activity: null }
  }

  const result = await createLessonActivityAction(unitId, lessonId, {
    title: proposal.title,
    type: proposal.type,
    bodyData,
    successCriteriaIds: linkSuccessCriteria ? successCriteriaIds : undefined,
    maxMarks: linkSuccessCriteria ? proposal.maxMarks : undefined,
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
