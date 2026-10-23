import { z } from 'zod'

import type { Queryable } from '@/lib/curriculum/unit-curriculum-guard'

// Unit audits (migration 123). The status is derived from two timestamps:
// a unit is audited when its last audit is newer than its last change to the
// unit or its lessons, which database triggers record. Nothing here has to
// reset the status when content changes.

export type UnitAuditStatus = 'audited' | 'failed' | 'not_audited'

export type UnitAuditAction = {
  action: string
  lessonId: string | null
  lessonTitle: string | null
}

export type UnitAudit = {
  unitId: string
  unitTitle: string
  subject: string
  status: UnitAuditStatus
  /** The last audit's result, even when content has changed since. */
  lastResult: 'passed' | 'failed' | null
  auditedAt: string | null
  auditedBy: string | null
  changedAt: string | null
  /** From the last failed audit; kept after a change, as the to-do list. */
  actions: UnitAuditAction[]
}

export class UnitAuditError extends Error {}

export const MAX_AUDIT_ACTIONS = 100

export const AuditActionInputSchema = z.object({
  action: z.string().trim().min(1).max(2000),
  lesson_id: z.string().trim().min(1).nullish(),
})

export const RecordUnitAuditSchema = z.object({
  unitId: z.string().trim().min(1),
  result: z.enum(['passed', 'failed']),
  actions: z.array(AuditActionInputSchema).max(MAX_AUDIT_ACTIONS).default([]),
  /** When the auditor started reading the unit; a change after it leaves the unit not audited. */
  startedAt: z.string().datetime({ offset: true }).nullish(),
}).superRefine((input, ctx) => {
  if (input.result === 'failed' && input.actions.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['actions'], message: 'A failed audit needs at least one action saying what to fix.' })
  }
  if (input.result === 'passed' && input.actions.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['actions'], message: 'A passed audit has no actions; record it as failed if anything needs fixing.' })
  }
})

export type RecordUnitAuditInput = z.input<typeof RecordUnitAuditSchema>

const AUDIT_SELECT = `
  select u.unit_id, u.title as unit_title, u.subject,
         a.result, a.audited_at, a.changed_at,
         nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as audited_by,
         case
           when a.audited_at is null or a.changed_at > a.audited_at then 'not_audited'
           when a.result = 'passed' then 'audited'
           else 'failed'
         end as status,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'action', item->>'action',
                    'lessonId', item->>'lesson_id',
                    'lessonTitle', l.title) order by ord)
             from jsonb_array_elements(a.actions) with ordinality as x(item, ord)
             left join lessons l on l.lesson_id = item->>'lesson_id'
         ), '[]'::jsonb) as actions
    from units u
    left join unit_audits a on a.unit_id = u.unit_id
    left join profiles p on p.user_id = a.audited_by`

type AuditRow = {
  unit_id: string
  unit_title: string | null
  subject: string
  result: 'passed' | 'failed' | null
  audited_at: Date | null
  changed_at: Date | null
  audited_by: string | null
  status: UnitAuditStatus
  actions: UnitAuditAction[]
}

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null)

function toAudit(row: AuditRow): UnitAudit {
  return {
    unitId: row.unit_id,
    unitTitle: row.unit_title ?? row.unit_id,
    subject: row.subject,
    status: row.status,
    lastResult: row.result,
    auditedAt: iso(row.audited_at),
    auditedBy: row.audited_by,
    changedAt: iso(row.changed_at),
    actions: row.actions,
  }
}

export async function readUnitAudit(db: Queryable, unitId: string): Promise<UnitAudit | null> {
  const { rows } = await db.query<AuditRow>(`${AUDIT_SELECT} where u.unit_id = $1`, [unitId])
  return rows[0] ? toAudit(rows[0]) : null
}

/** Active units, optionally narrowed; each with its derived audit status. */
export async function listUnitAudits(
  db: Queryable,
  filter: { subject?: string | null; curriculumId?: string | null; status?: UnitAuditStatus | null } = {},
): Promise<UnitAudit[]> {
  const { rows } = await db.query<AuditRow>(
    `select * from (${AUDIT_SELECT}
       where u.active is not false
         and ($1::text is null or u.subject = $1)
         and ($2::text is null or u.curriculum_id = $2)) audits
      where $3::text is null or status = $3
      order by subject, unit_title`,
    [filter.subject ?? null, filter.curriculumId ?? null, filter.status ?? null],
  )
  return rows.map(toAudit)
}

/**
 * Records an audit of a unit. Every action naming a lesson must name one of
 * the unit's own lessons. `startedAt` stamps the audit at the moment the
 * auditor began reading, so an edit made while it worked is not hidden by it.
 */
export async function recordUnitAudit(
  db: Queryable,
  rawInput: RecordUnitAuditInput,
  recordedBy: { userId: string | null; clientId: string | null },
): Promise<UnitAudit> {
  const parsed = RecordUnitAuditSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new UnitAuditError(parsed.error.issues.map((issue) => issue.message).join(' '))
  }
  const input = parsed.data

  const { rows: units } = await db.query<{ unit_id: string }>('select unit_id from units where unit_id = $1', [input.unitId])
  if (!units[0]) throw new UnitAuditError(`Unit ${input.unitId} was not found.`)

  if (input.startedAt) {
    const started = new Date(input.startedAt).getTime()
    const now = Date.now()
    if (started > now + 60_000) throw new UnitAuditError('started_at is in the future.')
    if (started < now - 24 * 60 * 60_000) throw new UnitAuditError('started_at is more than a day ago; audit the unit again.')
  }

  const lessonIds = [...new Set(input.actions.map((item) => item.lesson_id).filter((id): id is string => Boolean(id)))]
  if (lessonIds.length > 0) {
    const { rows } = await db.query<{ lesson_id: string }>(
      `select lesson_id from lessons where unit_id = $1 and kind = 'standard' and lesson_id = any($2::text[])`,
      [input.unitId, lessonIds],
    )
    const found = new Set(rows.map((row) => row.lesson_id))
    const missing = lessonIds.filter((id) => !found.has(id))
    if (missing.length > 0) {
      throw new UnitAuditError(`Not lessons of unit ${input.unitId}: ${missing.join(', ')}.`)
    }
  }

  const actions = input.actions.map((item) => ({ action: item.action, lesson_id: item.lesson_id ?? null }))
  await db.query(
    `insert into unit_audits (unit_id, result, audited_at, audited_by, audited_by_client, actions)
     values ($1, $2, coalesce($3::timestamptz, clock_timestamp()), $4, $5, $6::jsonb)
     on conflict (unit_id) do update set
       result = excluded.result,
       audited_at = excluded.audited_at,
       audited_by = excluded.audited_by,
       audited_by_client = excluded.audited_by_client,
       actions = excluded.actions`,
    [input.unitId, input.result, input.startedAt ?? null, recordedBy.userId, recordedBy.clientId, JSON.stringify(actions)],
  )

  const audit = await readUnitAudit(db, input.unitId)
  if (!audit) throw new UnitAuditError(`Unit ${input.unitId} was not found.`)
  return audit
}
