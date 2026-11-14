import "server-only"

import { z } from "zod"

import { query } from "@/lib/db"
import { isPowerPointAssessmentType, isQuestionMarkedActivityType } from "@/dino.config"
import { listHeldQuestionsToSend, listQuestionsAwaitingCheck, readAssessmentQuestions } from "@/lib/assessment-paper/store"
import { countFrontSheetChecks, listUnmarkedScriptSubmissions } from "@/lib/assessment-paper/files"
import { listUnmarkedPowerPointSubmissions } from "@/lib/powerpoint-assessment/files"
import type { QuestionEvidence } from "@/lib/powerpoint-assessment/evidence-spec"
import { AssessmentPaperActivityBodySchema, PowerPointAssessmentActivityBodySchema, PowerPointUploadSlotSchema } from "@/types"

// An assessment paper as the lesson editor and the teacher views show it: its
// files, questions (with each criterion's description), how many pupils have
// a script uploaded and how those scripts fared in the front sheet check. A
// PowerPoint assessment is read the same way, with its upload slots and its
// questions' evidence sources; it has no scripts, so its script counts are 0
// and `powerpoint` says how many pupils have files and have handed in.

const QuestionCriterionSchema = z.object({
  successCriteriaId: z.string().min(1),
  description: z.string(),
  maxMarks: z.number().int(),
})

const QuestionSchema = z.object({
  questionId: z.string(),
  label: z.string(),
  maxMarks: z.number().int(),
  questionText: z.string().nullable(),
  markScheme: z.string().nullable(),
  marking: z.enum(["ai", "ai_check", "teacher"]),
  /** Label of the earlier question this one carries error forward from. */
  dependsOn: z.string().nullable(),
  /** PowerPoint assessment: where the question's evidence comes from (evidence-spec.ts). [] on a paper. */
  evidence: z.array(z.unknown()).transform((sources) => sources as QuestionEvidence[]),
  criteria: z.array(QuestionCriterionSchema),
})

const PowerPointSetupSchema = z.object({
  /** The stored slots; empty when the body does not parse (bodyProblem says why). */
  uploadSlots: z.array(PowerPointUploadSlotSchema),
  bodyProblem: z.string().nullable(),
  evidenceTemplateFile: z.string().nullable(),
  /** Pupils with at least one file on their latest submission. */
  pupilsWithFiles: z.number().int(),
  /** Of those, pupils who have handed in. */
  handedIn: z.number().int(),
})

const SetupSchema = z.object({
  activityId: z.string(),
  type: z.enum(["assessment-paper", "powerpoint-assessment"]),
  lessonId: z.string(),
  /** Σ of the questions: what activities.max_marks holds once there are any. */
  maxMarks: z.number().int(),
  instructions: z.string().nullable(),
  questionPaperPath: z.string().nullable(),
  markSchemePath: z.string().nullable(),
  /** Whether the pupils' feedback PDF includes each question's mark scheme. */
  showMarkSchemeToPupils: z.boolean(),
  /** Scripts by front sheet check: passed, held, never checked (folded papers). */
  frontSheetChecks: z.object({ passed: z.number().int(), failed: z.number().int(), unchecked: z.number().int() }),
  /**
   * Latest submissions that have never been marked and are not queued: with
   * a script (assessment paper), or handed in (PowerPoint assessment).
   */
  unmarkedScriptsCount: z.number().int(),
  scriptsCount: z.number().int(),
  /** Questions marked by the model awaiting a teacher's check, across pupils' latest scripts. */
  awaitingCheck: z.object({ questions: z.number().int(), pupils: z.number().int() }),
  /** Questions held at the read for want of a mark scheme that have one now (Send held questions). */
  heldToSend: z.object({ questions: z.number().int(), pupils: z.number().int() }),
  questions: z.array(QuestionSchema),
  /** Null on an assessment paper. */
  powerpoint: PowerPointSetupSchema.nullable(),
})

export type AssessmentPaperSetup = z.infer<typeof SetupSchema>
export type AssessmentPaperSetupQuestion = z.infer<typeof QuestionSchema>

export async function readAssessmentPaperSetup(activityId: string): Promise<AssessmentPaperSetup> {
  const { rows } = await query<{
    activity_id: string
    lesson_id: string
    type: string | null
    body_data: unknown
  }>(
    "select activity_id, lesson_id, type, body_data from activities where activity_id = $1",
    [activityId],
  )
  const row = rows[0]
  if (!row) throw new Error("Activity not found.")
  if (!isQuestionMarkedActivityType(row.type)) throw new Error("This activity is not an assessment paper.")
  const isPowerPoint = isPowerPointAssessmentType(row.type)

  const parsed = AssessmentPaperActivityBodySchema.safeParse(row.body_data ?? {})
  const body = parsed.success ? parsed.data : {}

  const questions = await readAssessmentQuestions(activityId)
  const criterionIds = Array.from(new Set(questions.flatMap((q) => q.criteria.map((c) => c.successCriteriaId))))
  const { rows: descriptions } = await query<{ success_criteria_id: string; description: string | null }>(
    "select success_criteria_id, description from success_criteria where success_criteria_id = any($1::text[])",
    [criterionIds],
  )
  const descriptionOf = new Map(descriptions.map((d) => [d.success_criteria_id, d.description ?? ""]))

  // One per pupil: a re-upload replaces the pupil's script.
  const { rows: scriptRows } = await query<{ n: string }>(
    "select count(distinct pupil_id)::text as n from assessment_scripts where activity_id = $1",
    [activityId],
  )

  const [frontSheetChecks, unmarked, awaiting, heldToSend, powerpoint] = await Promise.all([
    countFrontSheetChecks(activityId),
    isPowerPoint ? listUnmarkedPowerPointSubmissions(activityId) : listUnmarkedScriptSubmissions(activityId),
    listQuestionsAwaitingCheck(activityId),
    listHeldQuestionsToSend(activityId),
    isPowerPoint ? readPowerPointSetup(activityId, row.body_data) : Promise.resolve(null),
  ])
  const labelOf = new Map(questions.map((q) => [q.questionId, q.label]))

  return SetupSchema.parse({
    activityId: row.activity_id,
    type: isPowerPoint ? "powerpoint-assessment" : "assessment-paper",
    lessonId: row.lesson_id,
    maxMarks: questions.reduce((sum, q) => sum + q.maxMarks, 0),
    instructions: body.instructions ?? null,
    questionPaperPath: body.questionPaperPath ?? null,
    markSchemePath: body.markSchemePath ?? null,
    showMarkSchemeToPupils: body.showMarkSchemeToPupils !== false,
    frontSheetChecks,
    unmarkedScriptsCount: unmarked.length,
    scriptsCount: Number(scriptRows[0]?.n ?? 0),
    awaitingCheck: {
      questions: awaiting.length,
      pupils: new Set(awaiting.map((row) => row.submissionId)).size,
    },
    heldToSend: {
      questions: heldToSend.length,
      pupils: new Set(heldToSend.map((row) => row.submissionId)).size,
    },
    questions: questions.map((q) => ({
      questionId: q.questionId,
      label: q.label,
      maxMarks: q.maxMarks,
      questionText: q.questionText,
      markScheme: q.markScheme,
      marking: q.marking,
      dependsOn: q.dependsOnQuestionId ? labelOf.get(q.dependsOnQuestionId) ?? null : null,
      evidence: q.evidence ?? [],
      criteria: q.criteria.map((c) => ({
        successCriteriaId: c.successCriteriaId,
        description: descriptionOf.get(c.successCriteriaId) ?? "",
        maxMarks: c.maxMarks,
      })),
    })),
    powerpoint,
  })
}

async function readPowerPointSetup(activityId: string, bodyData: unknown): Promise<z.infer<typeof PowerPointSetupSchema>> {
  const body = PowerPointAssessmentActivityBodySchema.safeParse(bodyData ?? {})
  const { rows } = await query<{ with_files: number; handed_in: number }>(
    `with latest as (
       select distinct on (s.user_id) s.submission_id, s.submission_status
         from submissions s
        where s.activity_id = $1
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select count(*)::int as with_files,
            count(*) filter (where l.submission_status = 'submitted')::int as handed_in
       from latest l
      where exists (select 1 from practical_submission_files f where f.submission_id = l.submission_id)`,
    [activityId],
  )
  return {
    uploadSlots: body.success ? body.data.uploadSlots : [],
    bodyProblem: body.success ? null : body.error.issues[0]?.message ?? "The upload slots are not set up.",
    evidenceTemplateFile: body.success ? body.data.evidenceTemplateFile ?? null : null,
    pupilsWithFiles: rows[0]?.with_files ?? 0,
    handedIn: rows[0]?.handed_in ?? 0,
  }
}
