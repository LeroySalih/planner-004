import type { PoolClient } from 'pg'

import { query, withDbClient } from '@/lib/db'
import { SCORABLE_ACTIVITY_TYPES } from '@/dino.config'
import { assertLoAllowedForLesson } from '@/lib/curriculum/unit-curriculum-guard'
import { STAFF_ROLE_IDS } from '@/lib/roles/pupil-membership'

// Intervention lessons (migration 108): an ordinary lesson with kind =
// 'intervention', assigned to one pupil through intervention_assignments.
//
// Status and score are derived from the pupil's submissions on every read —
// nothing about progress is stored, so it cannot disagree with the work.
//
//   assigned     no submission on any activity yet
//   in_progress  at least one submission
//   completed    every active scorable activity has a submission
//   cancelled    a teacher cancelled it (the only stored state)
//
// An intervention with no scorable activities never reaches completed: there
// is nothing to finish.

export const INTERVENTION_STATUSES = ['assigned', 'in_progress', 'completed', 'cancelled'] as const
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number]

export type InterventionSummary = {
  intervention_id: string
  lesson_id: string
  lesson_title: string
  unit_id: string
  unit_title: string
  subject: string | null
  pupil_id: string
  pupil_name: string
  group_id: string | null
  set_by: string | null
  set_by_name: string | null
  set_at: string
  due_date: string | null
  reason: string
  source_assessment_id: string | null
  source_assessment_title: string | null
  status: InterventionStatus
  overdue: boolean
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  scorable_activities: number
  submitted_activities: number
  scored_activities: number
  /** Mean of the scored activities' scores, 0–1; null until one is scored. */
  score: number | null
  learning_objectives: Array<{ learning_objective_id: string; title: string }>
}

export type InterventionFilter = {
  interventionId?: string
  lessonId?: string
  pupilId?: string
  groupId?: string
  statuses?: InterventionStatus[]
}

const isoOrNull = (value: unknown) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value))

export async function readInterventions(filter: InterventionFilter = {}): Promise<InterventionSummary[]> {
  const { rows } = await query(
    `with ia as (
       select ia.*, l.title as lesson_title, l.unit_id, u.title as unit_title, u.subject
         from intervention_assignments ia
         join lessons l on l.lesson_id = ia.lesson_id
         join units u on u.unit_id = l.unit_id
        where ia.active -- deleted interventions are out of every view
          and ($1::uuid is null or ia.intervention_id = $1::uuid)
          and ($2::text is null or ia.lesson_id = $2)
          and ($3::text is null or ia.pupil_id = $3)
          and ($4::text is null or ia.group_id = $4)
     ),
     acts as (
       select a.activity_id, a.lesson_id, a.type, a.max_marks,
              a.type = any($5::text[]) as scorable
         from activities a
         join ia on ia.lesson_id = a.lesson_id
        where a.active is not false
     ),
     -- The pupil's current attempt on each activity.
     cur as (
       select distinct on (s.activity_id)
              s.activity_id, acts.lesson_id, acts.scorable,
              case when acts.scorable
                   then compute_submission_base_score(s.body::jsonb, acts.type, acts.max_marks) end as score
         from submissions s
         join acts on acts.activity_id = s.activity_id
         join ia on ia.lesson_id = acts.lesson_id and ia.pupil_id = s.user_id
        order by s.activity_id, s.attempt_number desc nulls last, s.submitted_at desc nulls last
     ),
     -- When each activity was first handed in, for started/completed times.
     firsts as (
       select s.activity_id, acts.lesson_id, acts.scorable, min(s.submitted_at) as first_at
         from submissions s
         join acts on acts.activity_id = s.activity_id
         join ia on ia.lesson_id = acts.lesson_id and ia.pupil_id = s.user_id
        group by s.activity_id, acts.lesson_id, acts.scorable
     )
     select ia.intervention_id::text as intervention_id, ia.lesson_id, ia.lesson_title, ia.unit_id, ia.unit_title,
            ia.subject, ia.pupil_id, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) as pupil_name,
            ia.group_id, ia.set_by,
            nullif(trim(coalesce(sb.first_name, '') || ' ' || coalesce(sb.last_name, '')), '') as set_by_name,
            ia.set_at, to_char(ia.due_date, 'YYYY-MM-DD') as due_date, ia.reason,
            ia.source_assessment_id::text as source_assessment_id, asm.title as source_assessment_title,
            ia.cancelled_at,
            (select count(*) from acts where acts.lesson_id = ia.lesson_id and acts.scorable)::int as scorable_activities,
            (select count(*) from cur where cur.lesson_id = ia.lesson_id and cur.scorable)::int as submitted_activities,
            (select count(cur.score) from cur where cur.lesson_id = ia.lesson_id)::int as scored_activities,
            (select avg(cur.score) from cur where cur.lesson_id = ia.lesson_id)::float8 as score,
            (select min(first_at) from firsts where firsts.lesson_id = ia.lesson_id) as started_at,
            (select max(first_at) from firsts where firsts.lesson_id = ia.lesson_id and firsts.scorable) as last_scorable_at,
            coalesce((
              select json_agg(json_build_object('learning_objective_id', llo.learning_objective_id,
                                                'title', coalesce(lo.title, llo.title, ''))
                              order by llo.order_by nulls last)
                from lessons_learning_objective llo
                left join learning_objectives lo on lo.learning_objective_id = llo.learning_objective_id
               where llo.lesson_id = ia.lesson_id and llo.active is not false
            ), '[]'::json) as learning_objectives
       from ia
       join profiles p on p.user_id = ia.pupil_id
       left join profiles sb on sb.user_id = ia.set_by
       left join assessments asm on asm.assessment_id = ia.source_assessment_id
      order by ia.set_at desc`,
    [
      filter.interventionId ?? null,
      filter.lessonId ?? null,
      filter.pupilId ?? null,
      filter.groupId ?? null,
      [...SCORABLE_ACTIVITY_TYPES],
    ],
  )

  const today = new Date().toISOString().slice(0, 10)
  const summaries = rows.map((row): InterventionSummary => {
    const scorable = Number(row.scorable_activities)
    const submitted = Number(row.submitted_activities)
    const startedAt = isoOrNull(row.started_at)
    const completed = scorable > 0 && submitted >= scorable
    const status: InterventionStatus = row.cancelled_at
      ? 'cancelled'
      : completed ? 'completed' : startedAt ? 'in_progress' : 'assigned'
    const dueDate = (row.due_date as string | null) ?? null
    return {
      intervention_id: String(row.intervention_id),
      lesson_id: String(row.lesson_id),
      lesson_title: String(row.lesson_title ?? ''),
      unit_id: String(row.unit_id),
      unit_title: String(row.unit_title ?? ''),
      subject: (row.subject as string | null) ?? null,
      pupil_id: String(row.pupil_id),
      pupil_name: String(row.pupil_name ?? ''),
      group_id: (row.group_id as string | null) ?? null,
      set_by: (row.set_by as string | null) ?? null,
      set_by_name: (row.set_by_name as string | null) ?? null,
      set_at: isoOrNull(row.set_at) ?? '',
      due_date: dueDate,
      reason: String(row.reason ?? ''),
      source_assessment_id: (row.source_assessment_id as string | null) ?? null,
      source_assessment_title: (row.source_assessment_title as string | null) ?? null,
      status,
      overdue: (status === 'assigned' || status === 'in_progress') && dueDate !== null && dueDate < today,
      started_at: startedAt,
      completed_at: completed ? isoOrNull(row.last_scorable_at) : null,
      cancelled_at: isoOrNull(row.cancelled_at),
      scorable_activities: scorable,
      submitted_activities: submitted,
      scored_activities: Number(row.scored_activities),
      score: row.score == null ? null : Number(row.score),
      learning_objectives: (row.learning_objectives as InterventionSummary['learning_objectives']) ?? [],
    }
  })

  return filter.statuses?.length ? summaries.filter((s) => filter.statuses!.includes(s.status)) : summaries
}

/**
 * Whether a pupil may open a lesson, as far as interventions are concerned:
 * any standard lesson passes; an intervention lesson only for its own pupil,
 * and not once cancelled. Teachers are not checked here.
 *
 * Deliberately throws rather than failing open — an error must not show one
 * pupil's intervention to another.
 */
export async function interventionAllowsPupil(userId: string, lessonId: string): Promise<boolean> {
  const { rows } = await query<{ kind: string; own: boolean }>(
    `select l.kind,
            exists (select 1 from intervention_assignments ia
                     where ia.lesson_id = l.lesson_id and ia.pupil_id = $1
                       and ia.cancelled_at is null and ia.active) as own
       from lessons l where l.lesson_id = $2`,
    [userId, lessonId],
  )
  const row = rows[0]
  if (!row) return true // unknown lesson: the page's own not-found handling applies
  return row.kind !== 'intervention' || row.own
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

const STAFF_LIST = STAFF_ROLE_IDS.map((role) => `'${role}'`).join(', ')

/** A pupil is someone with the pupil role and no staff role (see pupil-membership.ts). */
async function assertIsPupil(client: PoolClient, pupilId: string) {
  const { rows } = await client.query<{ is_pupil: boolean }>(
    `select exists (select 1 from user_roles where user_id = $1 and lower(role_id) = 'pupil')
        and not exists (select 1 from user_roles where user_id = $1 and lower(role_id) in (${STAFF_LIST}))
        and not coalesce((select is_teacher from profiles where user_id = $1), false) as is_pupil,
            exists (select 1 from profiles where user_id = $1) as found`,
    [pupilId],
  )
  if (!(rows[0] as { found?: boolean } | undefined)?.found) throw new Error(`Pupil ${pupilId} not found`)
  if (!rows[0].is_pupil) throw new Error(`User ${pupilId} is not a pupil`)
}

/** The class an intervention is filed under: the one given, or the pupil's only class. */
async function resolveGroup(client: PoolClient, pupilId: string, groupId: string | null): Promise<string | null> {
  const { rows } = await client.query<{ group_id: string }>(
    `select gm.group_id from group_membership gm
       join groups g on g.group_id = gm.group_id
      where gm.user_id = $1 and g.active is not false`,
    [pupilId],
  )
  const groups = rows.map((r) => r.group_id)
  if (groupId) {
    if (!groups.includes(groupId)) throw new Error(`Pupil ${pupilId} is not in class ${groupId}`)
    return groupId
  }
  return groups.length === 1 ? groups[0] : null
}

export type CreateInterventionInput = {
  setBy: string | null
  unitId: string
  pupilId: string
  title: string
  groupId?: string | null
  dueDate?: string | null
  reason?: string | null
  sourceAssessmentId?: string | null
  learningObjectiveIds?: string[]
}

export async function createIntervention(input: CreateInterventionInput): Promise<InterventionSummary> {
  const title = input.title.trim()
  if (!title) throw new Error('A title is required')

  const lessonId = await inTransaction(async (client) => {
    const { rows: units } = await client.query('select 1 from units where unit_id = $1', [input.unitId])
    if (!units[0]) throw new Error(`Unit ${input.unitId} not found`)
    await assertIsPupil(client, input.pupilId)
    const groupId = await resolveGroup(client, input.pupilId, input.groupId ?? null)

    if (input.sourceAssessmentId) {
      const { rows } = await client.query('select 1 from assessments where assessment_id::text = $1', [input.sourceAssessmentId])
      if (!rows[0]) throw new Error(`Assessment ${input.sourceAssessmentId} not found`)
    }

    const { rows: maxRows } = await client.query<{ order_by: number }>(
      'select order_by from lessons where unit_id = $1 order by order_by desc nulls last limit 1',
      [input.unitId],
    )
    const { rows: lessonRows } = await client.query<{ lesson_id: string }>(
      `insert into lessons (unit_id, title, active, order_by, kind, is_public)
       values ($1, $2, true, $3, 'intervention', false)
       returning lesson_id`,
      [input.unitId, title, (maxRows[0]?.order_by ?? -1) + 1],
    )
    const newLessonId = lessonRows[0].lesson_id

    const loIds = [...new Set(input.learningObjectiveIds ?? [])]
    for (const [index, loId] of loIds.entries()) {
      const { rows: los } = await client.query<{ title: string }>(
        'select title from learning_objectives where learning_objective_id = $1',
        [loId],
      )
      if (!los[0]) throw new Error(`Learning objective ${loId} not found`)
      await assertLoAllowedForLesson(client, newLessonId, loId)
      await client.query(
        `insert into lessons_learning_objective (lesson_id, learning_objective_id, order_by, title, active)
         values ($1, $2, $3, $4, true)`,
        [newLessonId, loId, index, los[0].title],
      )
    }

    await client.query(
      `insert into intervention_assignments
         (lesson_id, pupil_id, group_id, set_by, due_date, reason, source_assessment_id)
       values ($1, $2, $3, $4, $5::date, $6, $7::uuid)`,
      [
        newLessonId,
        input.pupilId,
        groupId,
        input.setBy,
        input.dueDate || null,
        input.reason?.trim() ?? '',
        input.sourceAssessmentId || null,
      ],
    )
    return newLessonId
  })

  const [created] = await readInterventions({ lessonId })
  return created
}

export type UpdateInterventionInput = {
  interventionId: string
  title?: string
  dueDate?: string | null
  reason?: string
  cancelled?: boolean
}

export async function updateIntervention(input: UpdateInterventionInput): Promise<InterventionSummary> {
  await inTransaction(async (client) => {
    const { rows } = await client.query<{ lesson_id: string }>(
      'select lesson_id from intervention_assignments where intervention_id::text = $1 and active for update',
      [input.interventionId],
    )
    if (!rows[0]) throw new Error(`Intervention ${input.interventionId} not found`)

    if (input.title !== undefined) {
      const title = input.title.trim()
      if (!title) throw new Error('A title cannot be blank')
      await client.query('update lessons set title = $1 where lesson_id = $2', [title, rows[0].lesson_id])
    }
    if (input.dueDate !== undefined) {
      await client.query('update intervention_assignments set due_date = $1::date where intervention_id::text = $2', [
        input.dueDate || null,
        input.interventionId,
      ])
    }
    if (input.reason !== undefined) {
      await client.query('update intervention_assignments set reason = $1 where intervention_id::text = $2', [
        input.reason.trim(),
        input.interventionId,
      ])
    }
    if (input.cancelled !== undefined) {
      await client.query(
        `update intervention_assignments
            set cancelled_at = case when $1 then coalesce(cancelled_at, now()) end
          where intervention_id::text = $2`,
        [input.cancelled, input.interventionId],
      )
    }
  })

  const [updated] = await readInterventions({ interventionId: input.interventionId })
  return updated
}

/**
 * Soft-deletes interventions: they leave every view and the pupil loses
 * access, but the lesson and the pupil's work are kept. Returns how many were
 * deleted (already-deleted or unknown ids are skipped).
 */
export async function deactivateInterventions(interventionIds: string[], deactivatedBy: string): Promise<number> {
  if (interventionIds.length === 0) return 0
  const { rowCount } = await query(
    `update intervention_assignments
        set active = false, deactivated_at = now(), deactivated_by = $2
      where intervention_id::text = any($1::text[]) and active`,
    [interventionIds, deactivatedBy],
  )
  return rowCount ?? 0
}

// ---------------------------------------------------------------------------
// A pupil's gaps: where they are scoring low, per learning objective.
//
// Two sources, reported separately because they measure different things:
//   lesson work  per-criterion marks (submission_sc_marks) on the pupil's
//                current attempt at each activity in standard lessons —
//                intervention work is excluded so it never hides the gap it
//                was set to close
//   assessments  written papers, through each paper objective's link to a
//                curriculum learning objective
// ---------------------------------------------------------------------------

export type PupilGapCriterion = {
  success_criteria_id: string
  description: string
  awarded: number
  available: number
  score: number
}

export type PupilGap = {
  learning_objective_id: string
  title: string
  curriculum_id: string | null
  lesson_work: { awarded: number; available: number; score: number; criteria: PupilGapCriterion[] } | null
  assessments: Array<{ assessment_id: string; title: string; assessed_on: string; awarded: number; available: number; score: number }>
  /** Lowest of the available scores, used to sort weakest first. */
  lowest_score: number
}

export async function getPupilGaps(
  pupilId: string,
  scope: { curriculumId?: string | null; unitId?: string | null } = {},
): Promise<PupilGap[]> {
  const { rows: found } = await query('select 1 from profiles where user_id = $1', [pupilId])
  if (!found[0]) throw new Error(`Pupil ${pupilId} not found`)

  const { rows: scRows } = await query(
    `with cur as (
       select distinct on (s.activity_id) s.submission_id
         from submissions s
         join activities a on a.activity_id = s.activity_id
         join lessons l on l.lesson_id = a.lesson_id
        where s.user_id = $1 and l.kind = 'standard' and a.active is not false
          and ($3::text is null or l.unit_id = $3)
        order by s.activity_id, s.attempt_number desc nulls last, s.submitted_at desc nulls last
     )
     select sc.success_criteria_id, coalesce(sc.description, '') as description,
            lo.learning_objective_id, lo.title as lo_title, ao.curriculum_id,
            sum(m.awarded)::int as awarded, sum(m.available)::int as available
       from cur
       join submission_sc_marks m on m.submission_id = cur.submission_id
       join success_criteria sc on sc.success_criteria_id = m.success_criteria_id
       join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
       left join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
      where m.provenance <> 'legacy'
        and ($2::text is null or ao.curriculum_id = $2)
      group by sc.success_criteria_id, sc.description, lo.learning_objective_id, lo.title, ao.curriculum_id`,
    [pupilId, scope.curriculumId ?? null, scope.unitId ?? null],
  )

  // A unit scope narrows lesson work only; papers are not tied to units.
  const { rows: paperRows } = scope.unitId
    ? { rows: [] as Record<string, unknown>[] }
    : await query(
        `select alo.learning_objective_id, lo.title as lo_title, a.curriculum_id,
                a.assessment_id::text as assessment_id, a.title, to_char(a.assessed_on, 'YYYY-MM-DD') as assessed_on,
                coalesce(sum(m.awarded), 0)::int as awarded, sum(q.max_marks)::int as available
           from assessment_question_marks m
           join assessment_questions q on q.question_id = m.question_id
           join assessment_learning_objectives alo on alo.assessment_lo_id = q.assessment_lo_id
           join assessments a on a.assessment_id = m.assessment_id
           join learning_objectives lo on lo.learning_objective_id = alo.learning_objective_id
          where m.pupil_id = $1 and a.active
            and ($2::text is null or a.curriculum_id = $2)
          group by alo.learning_objective_id, lo.title, a.curriculum_id, a.assessment_id, a.title, a.assessed_on
          order by a.assessed_on`,
        [pupilId, scope.curriculumId ?? null],
      )

  const gaps = new Map<string, PupilGap>()
  const gapFor = (loId: string, title: string, curriculumId: string | null) => {
    let gap = gaps.get(loId)
    if (!gap) {
      gap = { learning_objective_id: loId, title, curriculum_id: curriculumId, lesson_work: null, assessments: [], lowest_score: 1 }
      gaps.set(loId, gap)
    }
    return gap
  }
  const ratio = (awarded: number, available: number) => (available > 0 ? awarded / available : 0)

  for (const row of scRows) {
    const gap = gapFor(String(row.learning_objective_id), String(row.lo_title ?? ''), (row.curriculum_id as string | null) ?? null)
    const awarded = Number(row.awarded)
    const available = Number(row.available)
    gap.lesson_work ??= { awarded: 0, available: 0, score: 0, criteria: [] }
    gap.lesson_work.awarded += awarded
    gap.lesson_work.available += available
    gap.lesson_work.criteria.push({
      success_criteria_id: String(row.success_criteria_id),
      description: String(row.description),
      awarded,
      available,
      score: ratio(awarded, available),
    })
  }
  for (const row of paperRows) {
    const gap = gapFor(String(row.learning_objective_id), String(row.lo_title ?? ''), (row.curriculum_id as string | null) ?? null)
    const awarded = Number(row.awarded)
    const available = Number(row.available)
    gap.assessments.push({
      assessment_id: String(row.assessment_id),
      title: String(row.title),
      assessed_on: String(row.assessed_on),
      awarded,
      available,
      score: ratio(awarded, available),
    })
  }

  for (const gap of gaps.values()) {
    if (gap.lesson_work) {
      gap.lesson_work.score = ratio(gap.lesson_work.awarded, gap.lesson_work.available)
      gap.lesson_work.criteria.sort((a, b) => a.score - b.score)
    }
    gap.lowest_score = Math.min(gap.lesson_work?.score ?? 1, ...gap.assessments.map((a) => a.score))
  }
  return [...gaps.values()].sort((a, b) => a.lowest_score - b.lowest_score)
}
