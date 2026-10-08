import type { PoolClient } from 'pg'

import { query, withDbClient } from '@/lib/db'
import { pupilMembershipSql } from '@/lib/roles/pupil-membership'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import {
  AssessmentFileSchema,
  AssessmentPaperSchema,
  AssessmentPaperSummarySchema,
  AssessmentPupilResultSchema,
  GroupPupilSchema,
  RecordAssessmentResultSchema,
  type AssessmentFile,
  type AssessmentObjectiveSubtotal,
  type AssessmentPaper,
  type AssessmentPaperHeader,
  type AssessmentPaperObjective,
  type AssessmentPaperQuestion,
  type AssessmentPaperSummary,
  type AssessmentPupilResult,
  type GroupPupil,
  type RecordAssessmentResult,
} from '@/types'

/**
 * Assessment papers (104-assessments.sql): written papers marked outside a
 * lesson. Nothing here touches submissions or reports.
 *
 * Every validation failure throws an Error whose message names the offending
 * label, code or id, because the main caller is a model that must be able to
 * correct itself from the message alone. Each write runs in one transaction.
 */

const FILES_BUCKET = 'assessments'
const FILES_MAX_BYTES = 5 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AssessmentObjectiveInput = {
  code?: string | null
  title?: string | null
  learningObjectiveId?: string | null
}

export type CreateAssessmentInput = {
  title: string
  assessedOn: string
  curriculumId: string
  groupIds: string[]
  objectives: AssessmentObjectiveInput[]
}

export type AssessmentQuestionInput = {
  label: string
  maxMarks: number
  objectiveCode: string
  correctAnswer?: string | null
}

export type AssessmentMarkInput = {
  label: string
  awarded: number
  whyNotAwarded?: string | null
  howToImprove?: string | null
}

export type RecordPupilResultInput = {
  assessmentId: string
  pupilId: string
  marks: AssessmentMarkInput[]
  wentWell?: string[]
  targets?: string[]
}

type PaperRow = {
  assessment_id: string
  title: string
  assessed_on: string
  curriculum_id: string
  curriculum_title: string
  group_ids: string[]
  feedback_visible: boolean
}

type QuestionRow = AssessmentPaperQuestion & { question_id: string }

type MarkRow = {
  question_id: string
  pupil_id: string
  awarded: number
  why_not_awarded: string | null
  how_to_improve: string | null
  provenance: 'ai' | 'teacher'
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

function cleanList(values: string[]): string[] {
  return values.map((v) => cleanText(v)).filter((v): v is string => v !== null)
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withDbClient(async (client) => {
    await client.query('BEGIN')
    try {
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
  })
}

const PAPER_SELECT = `
  select a.assessment_id::text as assessment_id, a.title,
         to_char(a.assessed_on, 'YYYY-MM-DD') as assessed_on,
         a.curriculum_id, c.title as curriculum_title, a.feedback_visible,
         coalesce((select array_agg(ag.group_id order by ag.group_id)
                     from assessment_groups ag
                    where ag.assessment_id = a.assessment_id), '{}') as group_ids
    from assessments a
    join curricula c on c.curriculum_id = a.curriculum_id`

/**
 * `lock` serialises writers on one paper: question/objective edits take
 * `update`, result recording takes `share`, so a mark can never be written
 * against a max (or a question) that a concurrent call is changing, while
 * different pupils still record in parallel.
 */
async function loadPaper(client: PoolClient, assessmentId: string, lock?: 'update' | 'share'): Promise<PaperRow> {
  const id = assessmentId?.trim() ?? ''
  if (UUID_RE.test(id)) {
    if (lock) {
      await client.query(`select 1 from assessments where assessment_id = $1 for ${lock}`, [id])
    }
    const { rows } = await client.query<PaperRow>(
      `${PAPER_SELECT} where a.assessment_id = $1 and a.active`,
      [id],
    )
    if (rows[0]) return rows[0]
  }
  throw new Error(`Assessment paper ${assessmentId} not found`)
}

function header(paper: PaperRow): AssessmentPaperHeader {
  return {
    assessment_id: paper.assessment_id,
    title: paper.title,
    assessed_on: paper.assessed_on,
    curriculum_id: paper.curriculum_id,
    curriculum_title: paper.curriculum_title,
    group_ids: paper.group_ids,
    feedback_visible: paper.feedback_visible,
  }
}

async function loadObjectives(client: PoolClient, assessmentId: string) {
  const { rows } = await client.query<AssessmentPaperObjective & { assessment_lo_id: string }>(
    `select alo.assessment_lo_id::text as assessment_lo_id, alo.code, alo.position, alo.title,
            alo.learning_objective_id, lo.title as learning_objective_title
       from assessment_learning_objectives alo
       left join learning_objectives lo on lo.learning_objective_id = alo.learning_objective_id
      where alo.assessment_id = $1
      order by alo.position, alo.code`,
    [assessmentId],
  )
  return rows
}

async function loadQuestions(client: PoolClient, assessmentId: string): Promise<QuestionRow[]> {
  const { rows } = await client.query<QuestionRow>(
    `select q.question_id::text as question_id, q.label, q.position, q.max_marks,
            alo.code as objective_code, q.correct_answer
       from assessment_questions q
       join assessment_learning_objectives alo on alo.assessment_lo_id = q.assessment_lo_id
      where q.assessment_id = $1
      order by q.position, q.label`,
    [assessmentId],
  )
  return rows
}

async function loadMarks(client: PoolClient, assessmentId: string, pupilId?: string): Promise<MarkRow[]> {
  const { rows } = await client.query<MarkRow>(
    `select question_id::text as question_id, pupil_id, awarded, why_not_awarded, how_to_improve, provenance
       from assessment_question_marks
      where assessment_id = $1 and ($2::text is null or pupil_id = $2)`,
    [assessmentId, pupilId ?? null],
  )
  return rows
}

function computeTotals(
  objectives: { code: string }[],
  questions: QuestionRow[],
  marks: MarkRow[],
) {
  const awardedByQuestion = new Map(marks.map((m) => [m.question_id, m.awarded]))
  const subtotals: AssessmentObjectiveSubtotal[] = objectives.map((o) => {
    const own = questions.filter((q) => q.objective_code === o.code)
    return {
      code: o.code,
      available: own.reduce((sum, q) => sum + q.max_marks, 0),
      awarded: own.reduce((sum, q) => sum + (awardedByQuestion.get(q.question_id) ?? 0), 0),
    }
  })
  const totalAvailable = questions.reduce((sum, q) => sum + q.max_marks, 0)
  const totalAwarded = questions.reduce((sum, q) => sum + (awardedByQuestion.get(q.question_id) ?? 0), 0)
  return {
    total_awarded: totalAwarded,
    total_available: totalAvailable,
    percent: totalAvailable > 0 ? Math.round((totalAwarded / totalAvailable) * 100) : 0,
    objectives: subtotals,
  }
}

async function readPaper(client: PoolClient, assessmentId: string): Promise<AssessmentPaper> {
  const paper = await loadPaper(client, assessmentId)
  const objectives = await loadObjectives(client, paper.assessment_id)
  const questions = await loadQuestions(client, paper.assessment_id)
  const marks = await loadMarks(client, paper.assessment_id)

  const pupilIds = [...new Set(marks.map((m) => m.pupil_id))]
  const { rows: profiles } = await client.query<{ user_id: string; first_name: string | null; last_name: string | null }>(
    'select user_id, first_name, last_name from profiles where user_id = any($1::text[])',
    [pupilIds],
  )
  const pupils = profiles
    .map((p) => ({
      pupil_id: p.user_id,
      first_name: p.first_name,
      last_name: p.last_name,
      ...computeTotals(objectives, questions, marks.filter((m) => m.pupil_id === p.user_id)),
    }))
    .sort((a, b) =>
      (a.last_name ?? '').localeCompare(b.last_name ?? '') || (a.first_name ?? '').localeCompare(b.first_name ?? ''),
    )

  return AssessmentPaperSchema.parse({
    ...header(paper),
    objectives: objectives.map((o) => ({
      code: o.code,
      position: o.position,
      title: o.title,
      learning_objective_id: o.learning_objective_id,
      learning_objective_title: o.learning_objective_title,
    })),
    questions: questions.map((q) => ({
      label: q.label,
      position: q.position,
      max_marks: q.max_marks,
      objective_code: q.objective_code,
      correct_answer: q.correct_answer,
    })),
    total_marks: questions.reduce((sum, q) => sum + q.max_marks, 0),
    pupils,
  })
}

async function readPupilResult(client: PoolClient, assessmentId: string, pupilId: string): Promise<AssessmentPupilResult> {
  const paper = await loadPaper(client, assessmentId)
  const { rows: profileRows } = await client.query<{ first_name: string | null; last_name: string | null }>(
    'select first_name, last_name from profiles where user_id = $1',
    [pupilId],
  )
  if (!profileRows[0]) throw new Error(`Pupil ${pupilId} not found`)

  const objectives = await loadObjectives(client, paper.assessment_id)
  const questions = await loadQuestions(client, paper.assessment_id)
  const marks = await loadMarks(client, paper.assessment_id, pupilId)
  const markByQuestion = new Map(marks.map((m) => [m.question_id, m]))
  const { rows: feedbackRows } = await client.query<{ went_well: string[]; targets: string[] }>(
    'select went_well, targets from assessment_pupil_feedback where assessment_id = $1 and pupil_id = $2',
    [paper.assessment_id, pupilId],
  )

  return AssessmentPupilResultSchema.parse({
    assessment: header(paper),
    pupil_id: pupilId,
    first_name: profileRows[0].first_name,
    last_name: profileRows[0].last_name,
    ...computeTotals(objectives, questions, marks),
    questions: questions.map((q) => {
      const mark = markByQuestion.get(q.question_id)
      return {
        label: q.label,
        objective_code: q.objective_code,
        max_marks: q.max_marks,
        correct_answer: q.correct_answer,
        awarded: mark?.awarded ?? null,
        why_not_awarded: mark?.why_not_awarded ?? null,
        how_to_improve: mark?.how_to_improve ?? null,
        provenance: mark?.provenance ?? null,
      }
    }),
    went_well: feedbackRows[0]?.went_well ?? [],
    targets: feedbackRows[0]?.targets ?? [],
  })
}

type ResolvedObjective = { code: string; title: string; learningObjectiveId: string | null }

/**
 * Shared validation for create and set. `existing` maps code -> stored row, so
 * an omitted title or learningObjectiveId keeps what is already there.
 */
async function resolveObjectives(
  client: PoolClient,
  curriculumId: string,
  objectives: AssessmentObjectiveInput[],
  existing: Map<string, { title: string; learning_objective_id: string | null }> = new Map(),
): Promise<ResolvedObjective[]> {
  if (!Array.isArray(objectives) || objectives.length === 0) {
    throw new Error('At least one objective is required')
  }

  const planned = objectives.map((objective, index) => {
    const code = cleanText(objective.code) ?? `LO${index + 1}`
    const stored = existing.get(code)
    const requested = objective.learningObjectiveId === undefined
      ? stored?.learning_objective_id ?? null
      : cleanText(objective.learningObjectiveId)
    return { objective, code, stored, requested }
  })

  const loIds = [...new Set(planned.map((p) => p.requested).filter((v): v is string => v !== null))]
  const { rows: loRows } = await client.query<{ learning_objective_id: string; title: string; curriculum_id: string | null }>(
    `select lo.learning_objective_id, lo.title, ao.curriculum_id
       from learning_objectives lo
       join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
      where lo.learning_objective_id = any($1::text[])`,
    [loIds],
  )
  const loById = new Map(loRows.map((r) => [r.learning_objective_id, r]))

  const seenCodes = new Set<string>()
  const linkedBy = new Map<string, string>()
  return planned.map(({ objective, code, stored, requested }) => {
    if (seenCodes.has(code)) throw new Error(`Objective code ${code} is used more than once`)
    seenCodes.add(code)

    let loTitle: string | null = null
    if (requested) {
      const lo = loById.get(requested)
      if (!lo) throw new Error(`${code}: learning objective ${requested} not found`)
      if (lo.curriculum_id !== curriculumId) {
        throw new Error(`${code}: learning objective ${requested} ("${lo.title}") is not in this paper's curriculum`)
      }
      const other = linkedBy.get(requested)
      if (other) throw new Error(`${code}: learning objective ${requested} is already linked to ${other}`)
      linkedBy.set(requested, code)
      loTitle = lo.title
    }

    const title = cleanText(objective.title) ?? stored?.title ?? loTitle
    if (!title) throw new Error(`${code}: a title is required when no learning objective is linked`)
    return { code, title, learningObjectiveId: requested }
  })
}

async function loadMembership(client: PoolClient, assessmentId: string, pupilId: string) {
  const { rows } = await client.query<{ first_name: string | null; last_name: string | null; member: boolean }>(
    `select p.first_name, p.last_name,
            exists (
              select 1 from group_membership gm
                join assessment_groups ag on ag.group_id = gm.group_id
               where ag.assessment_id = $1 and gm.user_id = p.user_id
                 and ${pupilMembershipSql('gm')}
            ) as member
       from profiles p where p.user_id = $2`,
    [assessmentId, pupilId],
  )
  return rows[0] ?? null
}

export async function listAssessments(groupId?: string | null): Promise<AssessmentPaperSummary[]> {
  const { rows } = await query(
    `select a.assessment_id::text as assessment_id, a.title,
            to_char(a.assessed_on, 'YYYY-MM-DD') as assessed_on,
            a.curriculum_id, c.title as curriculum_title, a.feedback_visible,
            coalesce((select array_agg(ag.group_id order by ag.group_id)
                        from assessment_groups ag where ag.assessment_id = a.assessment_id), '{}') as group_ids,
            (select count(*)::int from assessment_learning_objectives alo where alo.assessment_id = a.assessment_id) as objective_count,
            (select count(*)::int from assessment_learning_objectives alo
              where alo.assessment_id = a.assessment_id and alo.learning_objective_id is null) as unlinked_objective_count,
            (select count(*)::int from assessment_questions q where q.assessment_id = a.assessment_id) as question_count,
            (select coalesce(sum(q.max_marks), 0)::int from assessment_questions q where q.assessment_id = a.assessment_id) as total_marks,
            (select count(distinct m.pupil_id)::int from assessment_question_marks m where m.assessment_id = a.assessment_id) as pupils_with_results
       from assessments a
       join curricula c on c.curriculum_id = a.curriculum_id
      where a.active
        and ($1::text is null or exists (
              select 1 from assessment_groups ag where ag.assessment_id = a.assessment_id and ag.group_id = $1))
      order by a.assessed_on desc, a.created_at desc`,
    [cleanText(groupId)],
  )
  return rows.map((row) => AssessmentPaperSummarySchema.parse(row))
}

export async function getAssessment(assessmentId: string): Promise<AssessmentPaper> {
  return withDbClient((client) => readPaper(client, assessmentId))
}

export async function getPupilResult(assessmentId: string, pupilId: string): Promise<AssessmentPupilResult> {
  return withDbClient((client) => readPupilResult(client, assessmentId, pupilId))
}

export async function createAssessment(input: CreateAssessmentInput): Promise<AssessmentPaper> {
  const title = cleanText(input.title)
  if (!title) throw new Error('A title is required')

  const assessedOn = input.assessedOn?.trim() ?? ''
  const parsedDate = new Date(`${assessedOn}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessedOn) || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== assessedOn) {
    throw new Error(`assessed_on must be a valid date in YYYY-MM-DD form, got "${input.assessedOn}"`)
  }

  const groupIds = [...new Set((input.groupIds ?? []).map((g) => cleanText(g)).filter((g): g is string => g !== null))]
  if (groupIds.length === 0) throw new Error('At least one group is required')

  return inTransaction(async (client) => {
    const { rows: curricula } = await client.query('select 1 from curricula where curriculum_id = $1 and active is not false', [input.curriculumId])
    if (!curricula[0]) throw new Error(`Curriculum ${input.curriculumId} not found`)

    const { rows: groups } = await client.query<{ group_id: string }>(
      'select group_id from groups where group_id = any($1::text[]) and active is not false',
      [groupIds],
    )
    const found = new Set(groups.map((g) => g.group_id))
    const missing = groupIds.filter((g) => !found.has(g))
    if (missing.length > 0) throw new Error(`Group(s) not found: ${missing.join(', ')}`)

    const objectives = await resolveObjectives(client, input.curriculumId, input.objectives)

    const { rows } = await client.query<{ assessment_id: string }>(
      `insert into assessments (title, assessed_on, curriculum_id)
       values ($1, $2, $3) returning assessment_id::text as assessment_id`,
      [title, assessedOn, input.curriculumId],
    )
    const assessmentId = rows[0].assessment_id

    await client.query(
      'insert into assessment_groups (assessment_id, group_id) select $1, unnest($2::text[])',
      [assessmentId, groupIds],
    )
    for (const [index, objective] of objectives.entries()) {
      await client.query(
        `insert into assessment_learning_objectives (assessment_id, code, position, title, learning_objective_id)
         values ($1, $2, $3, $4, $5)`,
        [assessmentId, objective.code, index + 1, objective.title, objective.learningObjectiveId],
      )
    }
    return readPaper(client, assessmentId)
  })
}

export async function setAssessmentObjectives(
  assessmentId: string,
  objectives: AssessmentObjectiveInput[],
): Promise<AssessmentPaper> {
  return inTransaction(async (client) => {
    const paper = await loadPaper(client, assessmentId, 'update')
    const stored = await loadObjectives(client, paper.assessment_id)
    const resolved = await resolveObjectives(
      client,
      paper.curriculum_id,
      objectives,
      new Map(stored.map((o) => [o.code, o])),
    )

    const keep = new Set(resolved.map((o) => o.code))
    const removed = stored.filter((o) => !keep.has(o.code))
    if (removed.length > 0) {
      const { rows: used } = await client.query<{ code: string; labels: string[] }>(
        `select alo.code, array_agg(q.label order by q.position) as labels
           from assessment_learning_objectives alo
           join assessment_questions q on q.assessment_lo_id = alo.assessment_lo_id
          where alo.assessment_id = $1 and alo.code = any($2::text[])
          group by alo.code`,
        [paper.assessment_id, removed.map((o) => o.code)],
      )
      if (used.length > 0) {
        throw new Error(
          `Cannot remove objective(s) still used by questions: ${used.map((u) => `${u.code} (${u.labels.join(', ')})`).join('; ')}. Reassign those questions first.`,
        )
      }
      await client.query(
        'delete from assessment_learning_objectives where assessment_id = $1 and code = any($2::text[])',
        [paper.assessment_id, removed.map((o) => o.code)],
      )
    }

    // Clear links first so swapping two objectives' links in one call does not
    // trip the per-paper uniqueness constraint halfway through.
    await client.query(
      'update assessment_learning_objectives set learning_objective_id = null where assessment_id = $1',
      [paper.assessment_id],
    )
    for (const [index, objective] of resolved.entries()) {
      await client.query(
        `insert into assessment_learning_objectives (assessment_id, code, position, title, learning_objective_id)
         values ($1, $2, $3, $4, $5)
         on conflict (assessment_id, code) do update
           set position = excluded.position, title = excluded.title,
               learning_objective_id = excluded.learning_objective_id`,
        [paper.assessment_id, objective.code, index + 1, objective.title, objective.learningObjectiveId],
      )
    }
    await client.query('update assessments set updated_at = now() where assessment_id = $1', [paper.assessment_id])
    return readPaper(client, paper.assessment_id)
  })
}

export async function mapAssessmentObjective(
  assessmentId: string,
  code: string,
  learningObjectiveId: string | null,
): Promise<AssessmentPaper> {
  return inTransaction(async (client) => {
    const paper = await loadPaper(client, assessmentId, 'update')
    const stored = await loadObjectives(client, paper.assessment_id)
    const target = stored.find((o) => o.code === code?.trim())
    if (!target) {
      throw new Error(`Objective ${code} not found on this paper (codes: ${stored.map((o) => o.code).join(', ') || 'none'})`)
    }

    const loId = cleanText(learningObjectiveId)
    if (loId) {
      const { rows } = await client.query<{ title: string; curriculum_id: string | null }>(
        `select lo.title, ao.curriculum_id
           from learning_objectives lo
           join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
          where lo.learning_objective_id = $1`,
        [loId],
      )
      if (!rows[0]) throw new Error(`Learning objective ${loId} not found`)
      if (rows[0].curriculum_id !== paper.curriculum_id) {
        throw new Error(`Learning objective ${loId} ("${rows[0].title}") is not in this paper's curriculum`)
      }
      const other = stored.find((o) => o.learning_objective_id === loId && o.code !== target.code)
      if (other) throw new Error(`Learning objective ${loId} is already linked to ${other.code} on this paper`)
    }

    await client.query(
      'update assessment_learning_objectives set learning_objective_id = $2 where assessment_lo_id = $1',
      [target.assessment_lo_id, loId],
    )
    await client.query('update assessments set updated_at = now() where assessment_id = $1', [paper.assessment_id])
    return readPaper(client, paper.assessment_id)
  })
}

export async function setAssessmentQuestions(
  assessmentId: string,
  questions: AssessmentQuestionInput[],
): Promise<AssessmentPaper> {
  return inTransaction(async (client) => {
    const paper = await loadPaper(client, assessmentId, 'update')
    const objectives = await loadObjectives(client, paper.assessment_id)
    const loIdByCode = new Map(objectives.map((o) => [o.code, o.assessment_lo_id]))

    const seen = new Set<string>()
    const problems: string[] = []
    const cleaned = (questions ?? []).map((q, index) => {
      const label = cleanText(q.label)
      if (!label) {
        problems.push(`question ${index + 1} has no label`)
        return null
      }
      if (seen.has(label)) problems.push(`${label} appears more than once`)
      seen.add(label)
      if (!Number.isInteger(q.maxMarks) || q.maxMarks < 1) {
        problems.push(`${label}: max_marks must be a whole number of at least 1, got ${q.maxMarks}`)
      }
      const loId = loIdByCode.get(cleanText(q.objectiveCode) ?? '')
      if (!loId) {
        problems.push(`${label}: objective ${q.objectiveCode} is not on this paper (codes: ${[...loIdByCode.keys()].join(', ')})`)
      }
      return { label, maxMarks: q.maxMarks, loId: loId ?? '', correctAnswer: q.correctAnswer }
    })
    if (problems.length > 0) throw new Error(`Questions rejected, nothing saved: ${problems.join('; ')}`)
    const list = cleaned.filter((q): q is NonNullable<typeof q> => q !== null)

    const { rows: storedRows } = await client.query<{ label: string; max_awarded: number | null }>(
      `select q.label, max(m.awarded) as max_awarded
         from assessment_questions q
         left join assessment_question_marks m on m.question_id = q.question_id
        where q.assessment_id = $1
        group by q.label`,
      [paper.assessment_id],
    )
    const removed = storedRows.filter((r) => !seen.has(r.label))
    const removedWithMarks = removed.filter((r) => r.max_awarded !== null)
    if (removedWithMarks.length > 0) {
      throw new Error(
        `Cannot remove question(s) that already have marks: ${removedWithMarks.map((r) => r.label).join(', ')}. Include them in the list.`,
      )
    }
    const maxAwarded = new Map(storedRows.map((r) => [r.label, r.max_awarded]))
    const tooLow = list.filter((q) => (maxAwarded.get(q.label) ?? 0) > q.maxMarks)
    if (tooLow.length > 0) {
      throw new Error(
        `Cannot lower max_marks below a mark already awarded: ${tooLow.map((q) => `${q.label} (new max ${q.maxMarks}, highest awarded ${maxAwarded.get(q.label)})`).join('; ')}`,
      )
    }

    if (removed.length > 0) {
      await client.query(
        'delete from assessment_questions where assessment_id = $1 and label = any($2::text[])',
        [paper.assessment_id, removed.map((r) => r.label)],
      )
    }
    for (const [index, q] of list.entries()) {
      // An omitted correct_answer keeps the stored one; null or "" clears it.
      await client.query(
        `insert into assessment_questions (assessment_id, label, position, max_marks, assessment_lo_id, correct_answer)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (assessment_id, label) do update
           set position = excluded.position, max_marks = excluded.max_marks,
               assessment_lo_id = excluded.assessment_lo_id,
               correct_answer = case when $7 then excluded.correct_answer else assessment_questions.correct_answer end`,
        [paper.assessment_id, q.label, index + 1, q.maxMarks, q.loId, cleanText(q.correctAnswer), q.correctAnswer !== undefined],
      )
    }
    await client.query('update assessments set updated_at = now() where assessment_id = $1', [paper.assessment_id])
    return readPaper(client, paper.assessment_id)
  })
}

export async function listGroupPupils(groupId: string): Promise<GroupPupil[]> {
  return withDbClient(async (client) => {
    const { rows: groups } = await client.query('select 1 from groups where group_id = $1 and active is not false', [groupId])
    if (!groups[0]) throw new Error(`Group ${groupId} not found`)
    const { rows } = await client.query(
      `select distinct p.user_id as pupil_id, p.first_name, p.last_name, p.email
         from group_membership gm
         join profiles p on p.user_id = gm.user_id
        where gm.group_id = $1 and ${pupilMembershipSql('gm')}
        order by p.last_name nulls last, p.first_name nulls last`,
      [groupId],
    )
    return rows.map((row) => GroupPupilSchema.parse(row))
  })
}

export async function recordPupilResult(input: RecordPupilResultInput): Promise<RecordAssessmentResult> {
  return inTransaction(async (client) => {
    const paper = await loadPaper(client, input.assessmentId, 'share')
    const pupil = await loadMembership(client, paper.assessment_id, input.pupilId)
    if (!pupil) throw new Error(`Pupil ${input.pupilId} not found`)
    const name = `${pupil.first_name ?? ''} ${pupil.last_name ?? ''}`.trim() || input.pupilId
    if (!pupil.member) {
      throw new Error(`${name} (${input.pupilId}) is not a pupil in this paper's groups (${paper.group_ids.join(', ')})`)
    }

    const questions = await loadQuestions(client, paper.assessment_id)
    const byLabel = new Map(questions.map((q) => [q.label, q]))
    const seen = new Set<string>()
    const problems: string[] = []
    for (const mark of input.marks ?? []) {
      const label = mark.label?.trim() ?? ''
      const question = byLabel.get(label)
      if (seen.has(label)) problems.push(`${label} appears more than once`)
      seen.add(label)
      if (!question) {
        problems.push(`unknown question label "${label}"`)
        continue
      }
      if (!Number.isInteger(mark.awarded) || mark.awarded < 0 || mark.awarded > question.max_marks) {
        problems.push(`${label}: awarded must be a whole number from 0 to ${question.max_marks}, got ${mark.awarded}`)
      }
    }
    if (problems.length > 0) {
      throw new Error(
        `Result rejected, nothing saved: ${problems.join('; ')}. Paper labels: ${questions.map((q) => q.label).join(', ')}`,
      )
    }

    let written = 0
    const skipped: string[] = []
    for (const mark of input.marks ?? []) {
      const question = byLabel.get(mark.label.trim())!
      const { rowCount } = await client.query(
        `insert into assessment_question_marks
           (assessment_id, question_id, pupil_id, awarded, why_not_awarded, how_to_improve, provenance, marked_at)
         values ($1, $2, $3, $4, $5, $6, 'ai', now())
         on conflict (question_id, pupil_id) do update
           set awarded = excluded.awarded, why_not_awarded = excluded.why_not_awarded,
               how_to_improve = excluded.how_to_improve, marked_at = now()
         where assessment_question_marks.provenance = 'ai'`,
        [paper.assessment_id, question.question_id, input.pupilId, mark.awarded, cleanText(mark.whyNotAwarded), cleanText(mark.howToImprove)],
      )
      if ((rowCount ?? 0) > 0) written += 1
      else skipped.push(question.label)
    }

    let feedbackSkipped = false
    if (input.wentWell !== undefined || input.targets !== undefined) {
      const { rowCount } = await client.query(
        `insert into assessment_pupil_feedback (assessment_id, pupil_id, went_well, targets, provenance, updated_at)
         values ($1, $2, coalesce($3::text[], '{}'), coalesce($4::text[], '{}'), 'ai', now())
         on conflict (assessment_id, pupil_id) do update
           set went_well = coalesce($3::text[], assessment_pupil_feedback.went_well),
               targets = coalesce($4::text[], assessment_pupil_feedback.targets),
               updated_at = now()
         where assessment_pupil_feedback.provenance = 'ai'`,
        [
          paper.assessment_id,
          input.pupilId,
          input.wentWell === undefined ? null : cleanList(input.wentWell),
          input.targets === undefined ? null : cleanList(input.targets),
        ],
      )
      feedbackSkipped = (rowCount ?? 0) === 0
    }

    const stored = new Set((await loadMarks(client, paper.assessment_id, input.pupilId)).map((m) => m.question_id))
    const missing = questions.filter((q) => !stored.has(q.question_id)).map((q) => q.label)

    return RecordAssessmentResultSchema.parse({
      written,
      skipped_teacher_edited: skipped,
      feedback_skipped_teacher_edited: feedbackSkipped,
      missing_labels: missing,
      result: await readPupilResult(client, paper.assessment_id, input.pupilId),
    })
  })
}

export async function attachAssessmentFile(
  assessmentId: string,
  fileName: string,
  base64Content: string,
  contentType?: string | null,
): Promise<AssessmentFile> {
  const name = fileName?.trim() ?? ''
  if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new Error(`Invalid file name "${fileName}": it must not contain / or \\ or be . or ..`)
  }
  // Buffer.from silently skips characters outside the alphabet, so a corrupted
  // upload would be stored truncated. Normalise, then demand a round trip.
  const normalised = (base64Content ?? '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const buffer = Buffer.from(normalised, 'base64')
  if (buffer.byteLength === 0) throw new Error('File content is empty')
  if (buffer.toString('base64').replace(/=+$/, '') !== normalised) {
    throw new Error('File content is not valid base64')
  }
  if (buffer.byteLength > FILES_MAX_BYTES) {
    throw new Error(`File exceeds the 5 MB limit (${buffer.byteLength} bytes)`)
  }

  const paper = await withDbClient((client) => loadPaper(client, assessmentId))
  const fullPath = `${paper.assessment_id}/${name}`
  const storage = createLocalStorageClient(FILES_BUCKET)
  const { error } = await storage.upload(fullPath, buffer, {
    contentType: contentType ?? 'application/octet-stream',
    originalPath: fullPath,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  return AssessmentFileSchema.parse({
    assessment_id: paper.assessment_id,
    file_name: name,
    size_bytes: buffer.byteLength,
    path: `/api/files/${[FILES_BUCKET, paper.assessment_id, name].map(encodeURIComponent).join('/')}`,
  })
}
