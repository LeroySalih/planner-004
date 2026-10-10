'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAuthenticatedProfile, requireRole } from '@/lib/auth'
import { FEEDBACK_MAX_ITEM_LENGTH, FEEDBACK_MAX_ITEMS } from '@/lib/assessments/limits'
import { syncAssessmentFromAssignment } from '@/lib/assessments/from-assignment'
import { readAssignmentResultsAction } from '@/lib/server-actions/assignment-results'
import {
  deleteAssessment,
  renameAssessment,
  getAssessmentPage,
  getAssessmentPupilPage,
  getReleasedPupilResult,
  listReleasedAssessmentsForPupil,
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
  PupilAssessmentListItemSchema,
  PupilAssessmentObjectiveSchema,
  PupilAssessmentResultSchema,
} from '@/types'

/**
 * Reads and writes for assessment papers. Everything is teacher-only except
 * the two `readMy…` actions at the end, which serve the signed-in pupil. All
 * rules (roster, mark ranges, one-to-one objective links) live in the store;
 * these actions only authorise, validate shape and revalidate the affected
 * pages.
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

/** The list, the paper page and every pupil page under it, plus the pupils' own pages. */
function revalidatePaper(assessmentId: string) {
  revalidatePath('/assessments')
  revalidatePath(`/assessments/${assessmentId}`, 'layout')
  revalidatePath('/my-assessments', 'layout')
}

export async function renameAssessmentAction(
  assessmentId: string,
  title: string,
): Promise<{ title: string | null; error: string | null }> {
  await requireRole('teacher')
  try {
    const id = Id.parse(assessmentId)
    const header = await renameAssessment(id, z.string().max(200, 'Title must be 200 characters or fewer').parse(title))
    revalidatePaper(id)
    return { title: header.title, error: null }
  } catch (error) {
    return { title: null, error: errorMessage(error) }
  }
}

export async function deleteAssessmentAction(
  assessmentId: string,
): Promise<{ success: boolean; error: string | null }> {
  await requireRole('teacher')
  try {
    const id = Id.parse(assessmentId)
    await deleteAssessment(id)
    revalidatePaper(id)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

const FromAssignmentResult = z.object({
  data: z.object({
    assessmentId: z.string(),
    created: z.boolean(),
    questions: z.number().int(),
    pupilsRecorded: z.number().int(),
    pupilErrors: z.array(z.string()),
  }).nullable(),
  error: z.string().nullable(),
})

/**
 * Creates (or refreshes) the assessment paper for an assignment from the same
 * results the teacher sees on the results page.
 */
export async function createAssessmentFromAssignmentAction(
  assignmentId: string,
): Promise<z.infer<typeof FromAssignmentResult>> {
  await requireRole('teacher')
  try {
    const { data: matrix, error } = await readAssignmentResultsAction(Id.parse(assignmentId))
    if (!matrix) return FromAssignmentResult.parse({ data: null, error: error ?? 'Assignment not found.' })
    const summary = await syncAssessmentFromAssignment(matrix)
    revalidatePaper(summary.assessmentId)
    return FromAssignmentResult.parse({ data: summary, error: null })
  } catch (error) {
    return FromAssignmentResult.parse({ data: null, error: errorMessage(error) })
  }
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

/*
 * Pupil-facing reads. The pupil is always the signed-in profile: these take no
 * pupil id, so nobody can ask for another pupil's feedback.
 */

const MyListResult = z.object({
  data: z.array(PupilAssessmentListItemSchema).nullable(),
  error: z.string().nullable(),
})

export async function readMyAssessmentsAction(): Promise<z.infer<typeof MyListResult>> {
  const profile = await requireAuthenticatedProfile()
  try {
    return MyListResult.parse({ data: await listReleasedAssessmentsForPupil(profile.userId), error: null })
  } catch (error) {
    return MyListResult.parse({ data: null, error: errorMessage(error) })
  }
}

const MyPaperResult = z.object({
  data: z.object({
    result: PupilAssessmentResultSchema,
    objectives: z.array(PupilAssessmentObjectiveSchema),
  }).nullable(),
  error: z.string().nullable(),
})

/**
 * `data: null, error: null` means not found. Unknown, unreleased and not-sat
 * papers all look the same, so an unreleased paper's existence never leaks.
 */
export async function readMyAssessmentAction(assessmentId: string): Promise<z.infer<typeof MyPaperResult>> {
  const profile = await requireAuthenticatedProfile()
  try {
    const found = await getReleasedPupilResult(assessmentId, profile.userId)
    return MyPaperResult.parse({ data: found, error: null })
  } catch (error) {
    return MyPaperResult.parse({ data: null, error: errorMessage(error) })
  }
}
