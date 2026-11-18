import { query } from '@/lib/db'
import { isAiMarkedActivity, isQuestionMarkedActivityType, normalizeActivityType } from '@/dino.config'
import { ActivityBodyDataError, updateActivity } from '@/lib/mcp/activities'
import { MarkWorksheetActivityBodySchema, UploadWorksheetActivityBodySchema } from '@/types'

/**
 * The marking prompt of an AI-marked activity: the teacher's instructions the
 * marker sends to the model as MARKING GUIDANCE. Every type that has one keeps
 * it in body_data.markingGuidance. Question-marked types have a mark scheme per
 * question instead (set_assessment_activity_questions), so they have none here.
 */
const PROMPT_TYPES = [
  'short-text-question',
  'upload-code',
  'upload-spreadsheet',
  'upload-worksheet',
  'mark-worksheet',
  'upload-file',
] as const

/** The marker cannot mark these without a prompt; upload-file needs one only while ai_marking is on. */
const PROMPT_REQUIRED_TYPES = ['upload-code', 'upload-spreadsheet']

/** Worksheet types may take a subject marking guidance template, sent to the model before the prompt. */
const TEMPLATE_TYPES = ['upload-worksheet', 'mark-worksheet']

export const QUESTION_MARKED_PROMPT_NOTE =
  'This activity is marked per question against each question\'s mark scheme, not one marking prompt. '
  + 'Read the mark schemes with get_assessment_activity and change them with set_assessment_activity_questions (mark_scheme per question).'

export type ActivityMarkingPrompt = {
  activity_id: string
  lesson_id: string
  title: string | null
  type: string
  /** Whether the marker marks this activity with a model now (an upload-file only with ai_marking on). */
  ai_marked: boolean
  /** Whether the type keeps a per-activity marking prompt (body_data.markingGuidance). */
  has_marking_prompt: boolean
  marking_prompt: string | null
  /** Whether the prompt may not be empty as the activity stands. */
  prompt_required: boolean
  /** upload-file only: the Mark with AI switch. */
  ai_marking: boolean | null
  /** short-text-question only: the model answer, which the marker also sends (change it with update_activity model_answer). */
  model_answer: string | null
  /** Worksheet types only: the subject template the marker sends before the prompt. */
  marking_guidance_template: { id: string; title: string | null; content: string | null } | null
  note: string
}

function hasPrompt(type: string): boolean {
  return (PROMPT_TYPES as readonly string[]).includes(type)
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

function promptRequired(type: string, body: Record<string, unknown>): boolean {
  if (PROMPT_REQUIRED_TYPES.includes(type)) return true
  if (type === 'upload-file') return body.aiMarking === true
  if (type === 'upload-worksheet') return typeof body.markingGuidanceId !== 'string' || !body.markingGuidanceId
  return false
}

function noteFor(type: string, body: Record<string, unknown>, aiMarked: boolean): string {
  if (isQuestionMarkedActivityType(type)) return QUESTION_MARKED_PROMPT_NOTE
  if (!hasPrompt(type)) return `A ${type} activity is not marked by AI, so it has no marking prompt.`
  switch (type) {
    case 'short-text-question':
      return 'The marker sends the model answer and this prompt (optional) with the question. Change the model answer with update_activity model_answer.'
    case 'upload-code':
    case 'upload-spreadsheet':
      return 'Required: the marker cannot mark pupils\' work without it. It may hold HTML from the lesson editor.'
    case 'upload-worksheet':
      return 'Required unless a marking guidance template is chosen in the lesson editor; the template is sent before the prompt. It may hold HTML from the lesson editor.'
    case 'mark-worksheet':
      return 'Optional; sent with the blank worksheet and answer sheet images, after any marking guidance template. It may hold HTML from the lesson editor.'
    case 'upload-file':
      return aiMarked
        ? 'Mark with AI is on: pupils\' uploads are marked against this prompt. Turn it off with set_activity_marking_prompt ai_marking false.'
        : `Mark with AI is off: the teacher marks this activity${body.markingGuidance ? ' and the stored prompt is not used' : ''}. Turn it on with set_activity_marking_prompt ai_marking true (needs a prompt).`
    default:
      return ''
  }
}

async function readTemplate(id: unknown): Promise<ActivityMarkingPrompt['marking_guidance_template']> {
  if (typeof id !== 'string' || !id) return null
  const { rows } = await query<{ title: string; content: string }>(
    'select title, content from marking_guidances where id::text = $1 limit 1',
    [id],
  )
  return { id, title: rows[0]?.title ?? null, content: rows[0]?.content ?? null }
}

export async function getActivityMarkingPrompt(activityId: string): Promise<ActivityMarkingPrompt> {
  const { rows } = await query<{ activity_id: string; lesson_id: string; title: string | null; type: string; body_data: unknown }>(
    'select activity_id, lesson_id, title, type, body_data from activities where activity_id = $1 limit 1',
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Activity ${activityId} not found`)

  const type = normalizeActivityType(row.type)
  const body = bodyRecord(row.body_data)
  const prompt = hasPrompt(type)
  const aiMarked = isAiMarkedActivity(type, row.body_data)
  return {
    activity_id: row.activity_id,
    lesson_id: row.lesson_id,
    title: row.title,
    type: row.type,
    ai_marked: aiMarked,
    has_marking_prompt: prompt,
    marking_prompt: prompt ? (typeof body.markingGuidance === 'string' ? body.markingGuidance : '') : null,
    prompt_required: prompt && promptRequired(type, body),
    ai_marking: type === 'upload-file' ? body.aiMarking === true : null,
    model_answer: type === 'short-text-question' && typeof body.modelAnswer === 'string' ? body.modelAnswer : null,
    marking_guidance_template: TEMPLATE_TYPES.includes(type) ? await readTemplate(body.markingGuidanceId) : null,
    note: noteFor(type, body, aiMarked),
  }
}

export type MarkingPromptUpdate = {
  markingPrompt?: string
  /** upload-file only. */
  aiMarking?: boolean
}

/**
 * Sets an activity's marking prompt (and, for an upload-file, its Mark with AI
 * switch) through update_activity's save path, so the body is checked as the
 * lesson editor and update_activity check it. Nothing is marked or re-marked
 * here: the MCP tool re-marks through setActivityMarkingPromptAndRemark
 * (marking-prompt-remark.ts) unless asked not to.
 */
export async function setActivityMarkingPrompt(activityId: string, update: MarkingPromptUpdate): Promise<ActivityMarkingPrompt> {
  if (update.markingPrompt === undefined && update.aiMarking === undefined) {
    throw new Error('Pass marking_prompt, or ai_marking for an upload-file')
  }

  const { rows } = await query<{ type: string; body_data: unknown }>(
    'select type, body_data from activities where activity_id = $1 limit 1',
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error(`Activity ${activityId} not found`)
  const type = normalizeActivityType(row.type)

  if (isQuestionMarkedActivityType(type)) throw new Error(`A ${type} has no single marking prompt. ${QUESTION_MARKED_PROMPT_NOTE}`)
  if (!hasPrompt(type)) {
    throw new Error(`A ${type} activity is not marked by AI, so it has no marking prompt. Types with one: ${PROMPT_TYPES.join(', ')}.`)
  }
  if (update.aiMarking !== undefined && type !== 'upload-file') {
    throw new ActivityBodyDataError('INVALID_BODY_DATA', 'ai_marking', `ai_marking is for upload-file activities only, not ${type}: a ${type} is always marked by AI`)
  }

  // An empty prompt removes the field, as the lesson editor leaves an
  // upload-file's; a type that needs one is refused by the body check.
  const patch: Record<string, unknown> = {}
  if (update.markingPrompt !== undefined) {
    const prompt = update.markingPrompt.trim()
    patch.markingGuidance = prompt.length > 0 ? prompt : null
  }
  if (update.aiMarking !== undefined) patch.aiMarking = update.aiMarking

  // update_activity checks upload-file, upload-code, upload-spreadsheet and
  // short-text-question bodies; the worksheet types are checked here against
  // the schemas the marker reads them with.
  if (TEMPLATE_TYPES.includes(type)) {
    const next = { ...bodyRecord(row.body_data) }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    const schema = type === 'upload-worksheet' ? UploadWorksheetActivityBodySchema : MarkWorksheetActivityBodySchema
    const parsed = schema.safeParse(next)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = ['body_data', ...issue.path.map(String)].join('.')
      throw new ActivityBodyDataError('INVALID_BODY_DATA', field, `${field}: ${issue.message}`)
    }
  }

  await updateActivity(activityId, { bodyPatch: patch })
  return getActivityMarkingPrompt(activityId)
}
