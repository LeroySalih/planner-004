'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { FEEDBACK_MAX_ITEM_LENGTH, FEEDBACK_MAX_ITEMS } from '@/lib/assessments/limits'
import {
  getAssessmentPage,
  getAssessmentPupilPage,
  listAssessments,
  mapAssessmentObjective,
  setFeedbackVisible,
  setTeacherMark,
  setTeacherPupilFeedback,
} from '@/lib/assessments/store'
import {
  AssessmentFileSchema,
  AssessmentGridSchema,
  AssessmentLinkableObjectiveSchema,
  AssessmentPaperHeaderSchema,
  AssessmentPaperObjectiveSchema,
  AssessmentPaperSummarySchema,
  AssessmentPupilListItemSchema,
  AssessmentPupilResultSchema,
} from '@/types'

/**
 * Teacher-only reads and writes for assessment papers. All rules (roster,
 * mark ranges, one-to-one objective links) live in the store; these actions
 * only authorise, validate shape and revalidate the affected pages.
 */

const Id = z.string().trim().min(1)

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    const field = issue?.path.join('.')
    return issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Invalid input'
  }
  return error instanceof Error ? error.message : String(error)
}

/** The list, the paper page and every pupil page under it. */
function revalidatePaper(assessmentId: string) {
  revalidatePath('/assessments')
  revalidatePath(`/assessments/${assessmentId}`, 'layout')
}

const ListResult = z.object({
  data: z.object({
    assessments: z.array(AssessmentPaperSummarySchema),
    groupIds: z.array(z.string()),
  }).nullable(),
  error: z.string().nullable(),
})

export async function readAssessmentsAction(groupId?: string | null): Promise<z.infer<typeof ListResult>> {
  await requireRole('teacher')
  try {
    const group = Id.nullable().parse(groupId?.trim() ? groupId : null)
    const all = await listAssessments(null)
    const groupIds = [...new Set(all.flatMap((a) => a.group_ids))].sort()
    const assessments = group ? all.filter((a) => a.group_ids.includes(group)) : all
    return ListResult.parse({ data: { assessments, groupIds }, error: null })
  } catch (error) {
    return ListResult.parse({ data: null, error: errorMessage(error) })
  }
}

const PaperResult = z.object({
  data: z.object({
    paper: AssessmentGridSchema,
    files: z.array(AssessmentFileSchema),
    linkableObjectives: z.array(AssessmentLinkableObjectiveSchema),
  }).nullable(),
  error: z.string().nullable(),
})

export async function readAssessmentAction(assessmentId: string): Promise<z.infer<typeof PaperResult>> {
  await requireRole('teacher')
  try {
    const id = Id.parse(assessmentId)
    return PaperResult.parse({ data: await getAssessmentPage(id), error: null })
  } catch (error) {
    return PaperResult.parse({ data: null, error: errorMessage(error) })
  }
}

const PupilResult = z.object({
  data: z.object({
    result: AssessmentPupilResultSchema,
    objectives: z.array(AssessmentPaperObjectiveSchema),
    previous: AssessmentPupilListItemSchema.nullable(),
    next: AssessmentPupilListItemSchema.nullable(),
    onRoster: z.boolean(),
  }).nullable(),
  error: z.string().nullable(),
})

export async function readAssessmentPupilAction(
  assessmentId: string,
  pupilId: string,
): Promise<z.infer<typeof PupilResult>> {
  await requireRole('teacher')
  try {
    const id = Id.parse(assessmentId)
    const pupil = Id.parse(pupilId)
    return PupilResult.parse({ data: await getAssessmentPupilPage(id, pupil), error: null })
  } catch (error) {
    return PupilResult.parse({ data: null, error: errorMessage(error) })
  }
}

const OptionalComment = z.string().max(4000).nullable()

const MarkInput = z.object({
  assessmentId: Id,
  pupilId: Id,
  label: Id,
  awarded: z.number().int().min(0),
  whyNotAwarded: OptionalComment,
  howToImprove: OptionalComment,
})

const PupilWriteResult = z.object({
  data: AssessmentPupilResultSchema.nullable(),
  error: z.string().nullable(),
})

export async function updateAssessmentMarkAction(
  input: z.infer<typeof MarkInput>,
): Promise<z.infer<typeof PupilWriteResult>> {
  await requireRole('teacher')
  try {
    const payload = MarkInput.parse(input)
    const result = await setTeacherMark(
      payload.assessmentId,
      payload.pupilId,
      payload.label,
      payload.awarded,
      payload.whyNotAwarded,
      payload.howToImprove,
    )
    revalidatePaper(payload.assessmentId)
    return PupilWriteResult.parse({ data: result, error: null })
  } catch (error) {
    return PupilWriteResult.parse({ data: null, error: errorMessage(error) })
  }
}

const FeedbackInput = z.object({
  assessmentId: Id,
  pupilId: Id,
  wentWell: z.array(z.string().max(FEEDBACK_MAX_ITEM_LENGTH)).max(FEEDBACK_MAX_ITEMS),
  targets: z.array(z.string().max(FEEDBACK_MAX_ITEM_LENGTH)).max(FEEDBACK_MAX_ITEMS),
})

export async function updateAssessmentPupilFeedbackAction(
  input: z.infer<typeof FeedbackInput>,
): Promise<z.infer<typeof PupilWriteResult>> {
  await requireRole('teacher')
  try {
    const payload = FeedbackInput.parse(input)
    const result = await setTeacherPupilFeedback(
      payload.assessmentId,
      payload.pupilId,
      payload.wentWell,
      payload.targets,
    )
    revalidatePaper(payload.assessmentId)
    return PupilWriteResult.parse({ data: result, error: null })
  } catch (error) {
    return PupilWriteResult.parse({ data: null, error: errorMessage(error) })
  }
}

const VisibilityResult = z.object({
  data: AssessmentPaperHeaderSchema.nullable(),
  error: z.string().nullable(),
})

export async function setAssessmentFeedbackVisibleAction(
  assessmentId: string,
  visible: boolean,
): Promise<z.infer<typeof VisibilityResult>> {
  await requireRole('teacher')
  try {
    const id = Id.parse(assessmentId)
    const header = await setFeedbackVisible(id, z.boolean().parse(visible))
    revalidatePaper(id)
    return VisibilityResult.parse({ data: header, error: null })
  } catch (error) {
    return VisibilityResult.parse({ data: null, error: errorMessage(error) })
  }
}

const MapInput = z.object({
  assessmentId: Id,
  code: Id,
  learningObjectiveId: Id.nullable(),
})

const MapResult = z.object({
  data: z.array(AssessmentPaperObjectiveSchema).nullable(),
  error: z.string().nullable(),
})

export async function mapAssessmentObjectiveAction(
  input: z.infer<typeof MapInput>,
): Promise<z.infer<typeof MapResult>> {
  await requireRole('teacher')
  try {
    const payload = MapInput.parse(input)
    const paper = await mapAssessmentObjective(payload.assessmentId, payload.code, payload.learningObjectiveId)
    revalidatePaper(payload.assessmentId)
    return MapResult.parse({ data: paper.objectives, error: null })
  } catch (error) {
    return MapResult.parse({ data: null, error: errorMessage(error) })
  }
}
