"use server"

import { requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { readAllLearningObjectivesAction } from "@/lib/server-actions/learning-objectives"
import { createLessonAction, reorderLessonsAction } from "@/lib/server-actions/lessons"
import { createLearningObjective, createSuccessCriterion } from "@/lib/mcp/losc"
import {
  generateUnitChatReply,
  type ChatTurn,
  type UnitProposal,
} from "@/lib/ai/unit-chat-gemini"

const HISTORY_WINDOW = 20

interface UnitChatContext {
  unitTitle: string
  systemText: string
  validAoIds: Set<string>
  validLoIds: Set<string>
  validLessonIds: Set<string>
}

/** Gather the unit's lessons (with IDs + order) and AO/LO/SC (with IDs). */
async function getUnitChatContext(unitId: string): Promise<UnitChatContext> {
  const { rows: unitRows } = await query<{ title: string | null }>(
    `select title from units where unit_id = $1 limit 1`,
    [unitId],
  )
  const unitTitle = unitRows[0]?.title ?? "this unit"

  const { rows: lessonRows } = await query<{ lesson_id: string; title: string | null; order_by: number | null }>(
    `select lesson_id, title, order_by from lessons
     where unit_id = $1 and active is not false
     order by order_by asc nulls last`,
    [unitId],
  )
  const validLessonIds = new Set<string>()
  const lessonLines = lessonRows.map((l, i) => {
    validLessonIds.add(l.lesson_id)
    return `  ${i + 1}. [${l.lesson_id}] ${l.title ?? "Untitled lesson"}`
  })

  const loResult = await readAllLearningObjectivesAction({ unitId })
  const los = loResult.data ?? []

  const validAoIds = new Set<string>()
  const validLoIds = new Set<string>()
  const aoGroups = new Map<string, { code: string; title: string; loBlocks: string[] }>()
  for (const lo of los) {
    const aoId = lo.assessment_objective_id ?? ""
    if (aoId) validAoIds.add(aoId)
    if (lo.learning_objective_id) validLoIds.add(lo.learning_objective_id)
    const scLines = (lo.success_criteria ?? []).map((sc) => {
      const lvl = typeof sc.level === "number" ? ` (L${sc.level})` : ""
      return `      - [${sc.success_criteria_id}] ${sc.description ?? ""}${lvl}`
    })
    const loBlock = `    LO [${lo.learning_objective_id}] ${lo.title ?? "Untitled objective"}\n${scLines.join("\n")}`
    const key = aoId || "__none__"
    if (!aoGroups.has(key)) {
      aoGroups.set(key, {
        code: lo.assessment_objective_code ?? "",
        title: lo.assessment_objective_title ?? "",
        loBlocks: [],
      })
    }
    aoGroups.get(key)!.loBlocks.push(loBlock)
  }
  const loLines = Array.from(aoGroups.entries()).map(([aoId, g]) => {
    const header = aoId === "__none__"
      ? `  AO (unassigned)`
      : `  AO [${aoId}] ${g.code}${g.code && g.title ? " — " : ""}${g.title}`
    return `${header}\n${g.loBlocks.join("\n")}`
  })

  const systemText = [
    "You help a teacher develop a UNIT of work: its lessons, the order of those lessons, and its curriculum (learning objectives and success criteria).",
    "You return proposals as structured data; the teacher confirms each one. You never make changes yourself.",
    "You can propose these item types:",
    "- lesson: a NEW lesson to add to the unit. Set `title`. Optionally set `learningObjectiveIds` to link existing LOs to it (you may ONLY use LO IDs listed below).",
    "- lesson-reorder: a NEW ORDER for the unit's existing lessons. Set `lessonOrder` to ALL of the unit's current lesson IDs (listed below) in the order you recommend, first to last. Use ONLY the lesson IDs listed; include every one exactly once.",
    "- learning-objective: a NEW learning objective. Set `title`, set `assessmentObjectiveId` to a parent AO's ID from the list below (ONLY an AO ID listed there; never invent one), and optionally `specRef`.",
    "- success-criterion: a NEW success criterion. Set `description`, `level` (integer 1–9), and `learningObjectiveId` to a parent LO's ID from the list below (ONLY an LO ID listed there; never invent one).",
    "",
    "Guidelines:",
    "- Prefer reusing existing lessons/objectives; only propose new ones when they add something the unit is missing or the teacher asks.",
    "- Keep lesson titles and objectives clear and grade-appropriate, building on what the unit already contains.",
    "- For lesson-reorder, only propose it when the teacher asks about sequencing or the current order is clearly illogical; always list every current lesson ID exactly once.",
    "- Put a short conversational reply in `message` and the items in `proposals` (empty array if none this turn).",
    "",
    `Unit: ${unitTitle}`,
    "",
    "Current lessons (in order; IDs in brackets):",
    lessonLines.length ? lessonLines.join("\n") : "  (none yet)",
    "",
    "Assessment objectives (AO), learning objectives (LO) and success criteria (IDs in brackets):",
    loLines.length ? loLines.join("\n") : "  (none defined)",
  ].join("\n")

  return { unitTitle, systemText, validAoIds, validLoIds, validLessonIds }
}

/** Load a bounded window of prior chat turns for the model. */
async function loadHistory(unitId: string): Promise<ChatTurn[]> {
  const { rows } = await query<{ role: "user" | "assistant"; content: string }>(
    `select role, content from unit_chat_messages where unit_id = $1 order by created_at asc`,
    [unitId],
  )
  return rows.map((r) => ({ role: r.role, content: r.content })).slice(-HISTORY_WINDOW)
}

export type UnitChatMessageRecord = {
  message_id: string
  role: "user" | "assistant"
  content: string
  proposals: UnitProposal[] | null
  created_at: string
}

/** Full chat history for display when the panel opens. */
export async function readUnitChatAction(unitId: string): Promise<{
  success: boolean
  data: UnitChatMessageRecord[]
  error: string | null
}> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, data: [], error: "Unauthorized" }
  try {
    const { rows } = await query<UnitChatMessageRecord>(
      `select message_id, role, content, proposals, created_at::text as created_at
       from unit_chat_messages where unit_id = $1 order by created_at asc`,
      [unitId],
    )
    return { success: true, data: rows, error: null }
  } catch (err) {
    console.error("[unit-chat] read failed", err)
    return { success: false, data: [], error: "Failed to load chat." }
  }
}

/** Send a teacher message; returns the assistant reply + proposed changes. */
export async function sendUnitChatMessageAction(input: {
  unitId: string
  message: string
}): Promise<{ success: boolean; messageId: string | null; message: string; proposals: UnitProposal[]; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, messageId: null, message: "", proposals: [], error: "Unauthorized" }

  const unitId = input.unitId?.trim()
  const userMessage = input.message?.trim() ?? ""
  if (!unitId || !userMessage) {
    return { success: false, messageId: null, message: "", proposals: [], error: "Missing unit or message." }
  }

  try {
    const context = await getUnitChatContext(unitId)
    const history = await loadHistory(unitId)

    await query(
      `insert into unit_chat_messages (unit_id, teacher_id, role, content) values ($1, $2, 'user', $3)`,
      [unitId, profile.userId, userMessage],
    )

    const reply = await generateUnitChatReply({ systemText: context.systemText, history, userMessage })

    // Drop proposals whose referenced IDs are hallucinated so bad cards never render.
    const proposals = reply.proposals.filter((p) => {
      if (p.type === "learning-objective") return context.validAoIds.has(p.assessmentObjectiveId ?? "")
      if (p.type === "success-criterion") return context.validLoIds.has(p.learningObjectiveId ?? "")
      if (p.type === "lesson-reorder") {
        const ids = p.lessonOrder ?? []
        return ids.length > 0 && ids.every((id) => context.validLessonIds.has(id))
      }
      if (p.type === "lesson") {
        p.learningObjectiveIds = (p.learningObjectiveIds ?? []).filter((id) => context.validLoIds.has(id))
        return true
      }
      return false
    })

    const { rows: inserted } = await query<{ message_id: string }>(
      `insert into unit_chat_messages (unit_id, teacher_id, role, content, proposals) values ($1, $2, 'assistant', $3, $4::jsonb) returning message_id`,
      [unitId, profile.userId, reply.message, JSON.stringify(proposals)],
    )

    return { success: true, messageId: inserted[0]?.message_id ?? null, message: reply.message, proposals, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed."
    console.error("[unit-chat] send failed", err)
    return { success: false, messageId: null, message: "", proposals: [], error: message }
  }
}

/** Persist an edited proposal back into a stored assistant message. */
export async function updateUnitProposalInChatAction(input: {
  messageId: string
  proposalIndex: number
  proposal: UnitProposal
}): Promise<{ success: boolean; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized" }
  const { messageId, proposalIndex, proposal } = input
  if (!messageId || proposalIndex < 0 || !proposal) return { success: false, error: "Missing parameters." }
  try {
    await query(
      `update unit_chat_messages
         set proposals = jsonb_set(coalesce(proposals, '[]'::jsonb), array[$2::text], $3::jsonb, false)
       where message_id = $1`,
      [messageId, String(proposalIndex), JSON.stringify(proposal)],
    )
    return { success: true, error: null }
  } catch (err) {
    console.error("[unit-chat] update proposal failed", err)
    return { success: false, error: "Failed to update chat." }
  }
}

/** Apply one confirmed proposal to the unit. */
export async function confirmUnitProposalAction(input: {
  unitId: string
  proposal: UnitProposal
}): Promise<{ success: boolean; error: string | null; result: unknown }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized", result: null }

  const { unitId, proposal } = input
  if (!unitId || !proposal) return { success: false, error: "Missing parameters.", result: null }

  const context = await getUnitChatContext(unitId)
  try {
    if (proposal.type === "lesson") {
      const title = (proposal.title ?? "").trim()
      if (!title) return { success: false, error: "The lesson needs a title.", result: null }
      const loIds = (proposal.learningObjectiveIds ?? []).filter((id) => context.validLoIds.has(id))
      const created = await createLessonAction(unitId, title, loIds)
      if (!created?.data) return { success: false, error: created?.error ?? "Could not create lesson.", result: null }
      return { success: true, error: null, result: created.data }
    }

    if (proposal.type === "lesson-reorder") {
      const ids = proposal.lessonOrder ?? []
      if (!ids.length || !ids.every((id) => context.validLessonIds.has(id))) {
        return { success: false, error: "The proposed order references lessons that aren't in this unit.", result: null }
      }
      if (ids.length !== context.validLessonIds.size) {
        return { success: false, error: "The proposed order must include every lesson in the unit exactly once.", result: null }
      }
      const ordering = ids.map((lessonId, index) => ({ lessonId, orderBy: index }))
      const result = await reorderLessonsAction(unitId, ordering)
      if (result && result.success === false) {
        return { success: false, error: result.error ?? "Could not reorder lessons.", result: null }
      }
      return { success: true, error: null, result: { ordering } }
    }

    if (proposal.type === "learning-objective") {
      const aoId = proposal.assessmentObjectiveId ?? ""
      if (!context.validAoIds.has(aoId)) {
        return { success: false, error: "That assessment objective is not part of this unit's curriculum.", result: null }
      }
      const title = (proposal.title ?? "").trim()
      if (!title) return { success: false, error: "The learning objective needs a title.", result: null }
      const lo = await createLearningObjective(aoId, title, proposal.specRef?.trim() || null)
      return { success: true, error: null, result: lo }
    }

    if (proposal.type === "success-criterion") {
      const loId = proposal.learningObjectiveId ?? ""
      if (!context.validLoIds.has(loId)) {
        return { success: false, error: "That learning objective is not part of this unit's curriculum.", result: null }
      }
      const description = (proposal.description ?? "").trim()
      if (!description) return { success: false, error: "The success criterion needs a description.", result: null }
      const level = typeof proposal.level === "number" && proposal.level >= 1 && proposal.level <= 9 ? Math.round(proposal.level) : 1
      const sc = await createSuccessCriterion(loId, description, level)
      return { success: true, error: null, result: sc }
    }

    return { success: false, error: "Unsupported proposal type.", result: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply proposal."
    console.error("[unit-chat] confirm failed", err)
    return { success: false, error: message, result: null }
  }
}

/** Clear a unit's chat history. */
export async function clearUnitChatAction(unitId: string): Promise<{ success: boolean; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized" }
  try {
    await query(`delete from unit_chat_messages where unit_id = $1`, [unitId])
    return { success: true, error: null }
  } catch (err) {
    console.error("[unit-chat] clear failed", err)
    return { success: false, error: "Failed to clear chat." }
  }
}
