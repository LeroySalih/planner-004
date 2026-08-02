"use server"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  upsertMcqSubmissionAction,
  upsertMatcherSubmissionAction,
  upsertGroupItemsSubmissionAction,
  upsertSequenceSubmissionAction,
} from "@/lib/server-actions/submissions"
import { saveShortTextAnswerAction } from "@/lib/server-actions/short-text"
import { saveLongTextAnswerAction } from "@/lib/server-actions/long-text"
import {
  extractAnswersFromPhotos,
  type ActivityContext,
  type AnswerableType,
  type ExtractedAnswer,
} from "@/lib/ai/photo-answers"

const norm = (s: unknown) => (typeof s === "string" ? s : "").trim().toLowerCase().replace(/\s+/g, " ")

const ANSWERABLE_TYPES = new Set<AnswerableType>([
  "multiple-choice-question",
  "short-text-question",
  "long-text-question",
  "text-question",
  "matcher",
  "group-items",
  "sequence",
])

type Body = Record<string, unknown>
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Read a lesson's answerable (scorable, paper-answerable) activities as model context. */
export async function readAnswerableActivities(lessonId: string): Promise<ActivityContext[]> {
  const { rows } = await query<{ activity_id: string; type: string; title: string | null; body_data: Body | null }>(
    `select activity_id, type, title, body_data
       from activities
      where lesson_id = $1 and active is not false
      order by order_by asc nulls last`,
    [lessonId],
  )

  const out: ActivityContext[] = []
  for (const r of rows) {
    if (!ANSWERABLE_TYPES.has(r.type as AnswerableType)) continue
    const b = (r.body_data ?? {}) as Body
    const ctx: ActivityContext = {
      activityId: r.activity_id,
      type: r.type as AnswerableType,
      question: str(b.question) || str(b.description) || r.title || "Untitled question",
    }
    if (r.type === "multiple-choice-question") {
      ctx.options = Array.isArray(b.options) ? (b.options as Body[]).map((o) => str(o.text)).filter(Boolean) : []
    } else if (r.type === "matcher") {
      const pairs = Array.isArray(b.pairs) ? (b.pairs as Body[]) : []
      ctx.terms = pairs.map((p) => str(p.term)).filter(Boolean)
      ctx.definitions = pairs.map((p) => str(p.definition)).filter(Boolean)
    } else if (r.type === "group-items") {
      ctx.groups = Array.isArray(b.groups) ? (b.groups as Body[]).map((g) => str(g.name)).filter(Boolean) : []
      ctx.items = Array.isArray(b.items) ? (b.items as Body[]).map((i) => str(i.text)).filter(Boolean) : []
    } else if (r.type === "sequence") {
      ctx.sequenceItems = Array.isArray(b.terms) ? (b.terms as Body[]).map((t) => str(t.text)).filter(Boolean) : []
    }
    out.push(ctx)
  }
  return out
}

export interface PhotoExtractResult {
  success: boolean
  error: string | null
  message: string
  activities: ActivityContext[]
  answers: ExtractedAnswer[]
}

/**
 * Read a photo of handwritten work and return a best-effort answer per activity.
 * Does NOT submit anything — the pupil reviews/edits, then submits separately.
 */
export async function extractPhotoAnswersAction(input: {
  lessonId: string
  images: Array<{ mimeType: string; base64: string }>
}): Promise<PhotoExtractResult> {
  const profile = await requireAuthenticatedProfile()
  if (!profile) return { success: false, error: "Unauthorized", message: "", activities: [], answers: [] }

  const lessonId = input.lessonId?.trim()
  const images = (input.images ?? []).filter((i) => i?.base64)
  if (!lessonId || images.length === 0) {
    return { success: false, error: "Provide a lesson and at least one photo.", message: "", activities: [], answers: [] }
  }

  try {
    const activities = await readAnswerableActivities(lessonId)
    if (activities.length === 0) {
      return { success: false, error: "This lesson has no answerable activities.", message: "", activities: [], answers: [] }
    }
    const { answers, message } = await extractAnswersFromPhotos({ images, activities })
    // Keep only answers that reference a real activity in this lesson.
    const ids = new Set(activities.map((a) => a.activityId))
    const clean = answers.filter((a) => ids.has(a.activityId))
    return { success: true, error: null, message, activities, answers: clean }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed."
    console.error("[photo-answers] extract failed", err)
    return { success: false, error: message, message: "", activities: [], answers: [] }
  }
}

export interface SubmitResult {
  activityId: string
  success: boolean
  error: string | null
}

/**
 * Submit confirmed photo-extracted answers. Each is mapped from the model's
 * human-readable text to the internal IDs, routed through the SAME submit action
 * a pupil widget uses (so marking runs as usual — auto / AI / manual), then the
 * submission body is stamped `source: "photo"` for teacher provenance.
 */
export async function submitPhotoAnswersAction(input: {
  lessonId: string
  assignmentId?: string
  answers: ExtractedAnswer[]
}): Promise<{ success: boolean; error: string | null; results: SubmitResult[] }> {
  const profile = await requireAuthenticatedProfile()
  if (!profile) return { success: false, error: "Unauthorized", results: [] }
  const userId = profile.userId
  const results: SubmitResult[] = []

  for (const ans of input.answers ?? []) {
    const { rows } = await query<{ type: string; body_data: Body | null; lesson_id: string | null }>(
      `select type, body_data, lesson_id from activities where activity_id = $1 limit 1`,
      [ans.activityId],
    )
    const act = rows[0]
    if (!act || act.lesson_id !== input.lessonId) {
      results.push({ activityId: ans.activityId, success: false, error: "Activity not in this lesson." })
      continue
    }
    const b = (act.body_data ?? {}) as Body

    try {
      let res: { success?: boolean; error?: string | null } | undefined
      if (act.type === "multiple-choice-question") {
        const opts = Array.isArray(b.options) ? (b.options as Body[]) : []
        const opt = opts.find((o) => norm(o.text) === norm(ans.chosenOption))
        if (!opt) throw new Error("Could not match the chosen option.")
        res = await upsertMcqSubmissionAction({ activityId: ans.activityId, userId, optionId: str(opt.id) })
      } else if (act.type === "short-text-question") {
        if (!norm(ans.answerText)) throw new Error("No answer text.")
        res = await saveShortTextAnswerAction({ activityId: ans.activityId, userId, answer: ans.answerText, assignmentId: input.assignmentId })
      } else if (act.type === "long-text-question" || act.type === "text-question") {
        if (!norm(ans.answerText)) throw new Error("No answer text.")
        res = await saveLongTextAnswerAction({ activityId: ans.activityId, userId, answer: ans.answerText })
      } else if (act.type === "matcher") {
        const pairs = Array.isArray(b.pairs) ? (b.pairs as Body[]) : []
        const answers: Record<string, string | null> = {}
        for (const m of ans.matches ?? []) {
          const pair = pairs.find((p) => norm(p.term) === norm(m.term))
          if (pair) answers[str(pair.id)] = m.definition
        }
        if (Object.keys(answers).length === 0) throw new Error("Could not match any term/definition pairs.")
        const layout = pairs.map((p) => ({ pairId: str(p.id), promptSide: "term" as const }))
        res = await upsertMatcherSubmissionAction({ activityId: ans.activityId, userId, layout, answers })
      } else if (act.type === "group-items") {
        const items = Array.isArray(b.items) ? (b.items as Body[]) : []
        const groups = Array.isArray(b.groups) ? (b.groups as Body[]) : []
        const placements: Record<string, string | null> = {}
        for (const p of ans.placements ?? []) {
          const item = items.find((i) => norm(i.text) === norm(p.item))
          const group = groups.find((g) => norm(g.name) === norm(p.group))
          if (item && group) placements[str(item.id)] = str(group.id)
        }
        if (Object.keys(placements).length === 0) throw new Error("Could not map any items to groups.")
        const itemOrder = items.map((i) => str(i.id))
        res = await upsertGroupItemsSubmissionAction({ activityId: ans.activityId, userId, itemOrder, placements })
      } else if (act.type === "sequence") {
        const terms = Array.isArray(b.terms) ? (b.terms as Body[]) : []
        const order = (ans.order ?? [])
          .map((t) => terms.find((term) => norm(term.text) === norm(t)))
          .filter((term): term is Body => Boolean(term))
          .map((term) => str(term.id))
        if (order.length === 0) throw new Error("Could not map the sequence order.")
        res = await upsertSequenceSubmissionAction({ activityId: ans.activityId, userId, order })
      } else {
        throw new Error(`Unsupported type ${act.type}`)
      }

      if (res && res.success === false) throw new Error(res.error ?? "Submit failed.")

      // Stamp provenance on the just-written submission (latest attempt).
      await query(
        `update submissions
            set body = jsonb_set(coalesce(body, '{}'::jsonb), '{source}', '"photo"', true)
          where activity_id = $1 and user_id = $2
            and attempt_number = (select max(attempt_number) from submissions where activity_id = $1 and user_id = $2)`,
        [ans.activityId, userId],
      )
      results.push({ activityId: ans.activityId, success: true, error: null })
    } catch (err) {
      results.push({ activityId: ans.activityId, success: false, error: err instanceof Error ? err.message : "Failed." })
    }
  }

  return { success: true, error: null, results }
}
