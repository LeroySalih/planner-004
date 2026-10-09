'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAuthenticatedProfile, requireRole } from '@/lib/auth'
import {
  INTERVENTION_STATUSES,
  deactivateInterventions,
  readInterventions,
  type InterventionStatus,
  type InterventionSummary,
} from '@/lib/interventions/store'

/**
 * Interventions are created and edited through MCP; the app reads them and
 * lets a teacher delete them. Teachers see every intervention. A pupil sees their own, except cancelled
 * ones, which disappear from their list.
 */

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error')

export async function readInterventionsAction(filter: {
  pupilId?: string
  groupId?: string
  statuses?: string[]
} = {}): Promise<{ data: InterventionSummary[] | null; error: string | null }> {
  await requireRole('teacher')
  try {
    const statuses = (filter.statuses ?? []).filter((s): s is InterventionStatus =>
      (INTERVENTION_STATUSES as readonly string[]).includes(s),
    )
    const data = await readInterventions({
      pupilId: filter.pupilId || undefined,
      groupId: filter.groupId || undefined,
      statuses,
    })
    return { data, error: null }
  } catch (error) {
    return { data: null, error: errorMessage(error) }
  }
}

export type MyIntervention = Pick<
  InterventionSummary,
  | 'intervention_id'
  | 'pupil_id'
  | 'lesson_id'
  | 'lesson_title'
  | 'unit_title'
  | 'set_at'
  | 'due_date'
  | 'status'
  | 'overdue'
  | 'scorable_activities'
  | 'submitted_activities'
  | 'score'
>

export async function readMyInterventionsAction(): Promise<{ data: MyIntervention[] | null; error: string | null }> {
  const profile = await requireAuthenticatedProfile()
  try {
    const rows = await readInterventions({ pupilId: profile.userId, statuses: ['assigned', 'in_progress', 'completed'] })
    // The reason and who set it are notes for teachers, not the pupil.
    const data = rows.map((row) => ({
      intervention_id: row.intervention_id,
      pupil_id: row.pupil_id,
      lesson_id: row.lesson_id,
      lesson_title: row.lesson_title,
      unit_title: row.unit_title,
      set_at: row.set_at,
      due_date: row.due_date,
      status: row.status,
      overdue: row.overdue,
      scorable_activities: row.scorable_activities,
      submitted_activities: row.submitted_activities,
      score: row.score,
    }))
    return { data, error: null }
  } catch (error) {
    return { data: null, error: errorMessage(error) }
  }
}

const DeleteInput = z.array(z.string().uuid()).min(1).max(500)

/** Soft-deletes the selected interventions (see deactivateInterventions). */
export async function deleteInterventionsAction(
  interventionIds: string[],
): Promise<{ data: { deleted: number } | null; error: string | null }> {
  const profile = await requireRole('teacher')
  const parsed = DeleteInput.safeParse(interventionIds)
  if (!parsed.success) return { data: null, error: 'Select at least one intervention.' }
  try {
    const deleted = await deactivateInterventions(parsed.data, profile.userId)
    revalidatePath('/interventions')
    return { data: { deleted }, error: null }
  } catch (error) {
    return { data: null, error: errorMessage(error) }
  }
}
