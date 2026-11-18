import { query } from '@/lib/db'
import { isAiMarkedActivity, isQuestionMarkedActivityType } from '@/dino.config'
import { enqueueMarkingTasks, triggerQueueProcessor } from '@/lib/ai/marking-queue'
import {
  getActivityMarkingPrompt,
  setActivityMarkingPrompt,
  type ActivityMarkingPrompt,
  type MarkingPromptUpdate,
} from '@/lib/mcp/marking-prompts'

/** What set_activity_marking_prompt did about work marked against the old prompt. */
export type MarkingPromptRemarking = {
  remark: boolean
  /** Whether the prompt text changed. Nothing is re-marked when it did not. */
  prompt_changed: boolean
  /** Pupils' latest submissions sent to the marker again. */
  submissions_queued: number
  /** Latest submissions a teacher has marked on every criterion, left as they are. */
  skipped_teacher_marked: number
}

/**
 * Send every pupil's latest submission on a per-criterion AI-marked activity
 * to the marker again, after its marking prompt changed. Only work already
 * sent for marking (mark_status set) goes; a submission a teacher has marked
 * on every criterion is left. enqueueMarkingTasks does the rest as for any
 * re-mark: the marker's criterion rows are cleared, a teacher's survive (and
 * the marker never writes over them), a whole-activity override in the body
 * is untouched, and an open job for the same criterion is replaced, never
 * doubled. Nothing is queued unless the activity is AI-marked as it stands
 * (an upload-file with Mark with AI off is the teacher's).
 */
export async function remarkActivityAfterPromptChange(
  activityId: string,
): Promise<{ submissionsQueued: number; skippedTeacherMarked: number }> {
  const { rows: activityRows } = await query<{ type: string | null; body_data: unknown; lesson_id: string }>(
    'select type, body_data, lesson_id from activities where activity_id = $1',
    [activityId],
  )
  const activity = activityRows[0]
  if (!activity) throw new Error(`Activity ${activityId} not found`)
  if (isQuestionMarkedActivityType(activity.type) || !isAiMarkedActivity(activity.type ?? '', activity.body_data)) {
    return { submissionsQueued: 0, skippedTeacherMarked: 0 }
  }

  const { rows } = await query<{ submission_id: string; assignment_id: string; teacher_marked: boolean }>(
    `with latest as (
       select distinct on (s.user_id) s.submission_id, s.user_id, s.mark_status
         from submissions s
        where s.activity_id = $1
        order by s.user_id, s.attempt_number desc, s.submitted_at desc nulls last, s.submission_id desc
     )
     select l.submission_id,
            coalesce((select la.group_id || '__' || la.lesson_id
                        from lesson_assignments la
                        join group_membership gm on gm.group_id = la.group_id and gm.user_id = l.user_id
                       where la.lesson_id = $2
                       order by la.group_id
                       limit 1), 'self__' || $2) as assignment_id,
            exists (select 1 from activity_success_criteria c where c.activity_id = $1)
              and not exists (select 1 from activity_success_criteria c
                               where c.activity_id = $1
                                 and not exists (select 1 from submission_sc_marks m
                                                  where m.submission_id = l.submission_id
                                                    and m.success_criteria_id = c.success_criteria_id
                                                    and m.provenance = 'teacher')) as teacher_marked
       from latest l
      where l.mark_status is not null
      order by l.submission_id`,
    [activityId, activity.lesson_id],
  )

  const toQueue = rows.filter((row) => !row.teacher_marked)
  const byAssignment = new Map<string, Array<{ submissionId: string }>>()
  for (const row of toQueue) {
    const list = byAssignment.get(row.assignment_id) ?? []
    list.push({ submissionId: row.submission_id })
    byAssignment.set(row.assignment_id, list)
  }
  for (const [assignmentId, tasks] of byAssignment) await enqueueMarkingTasks(assignmentId, tasks)
  if (toQueue.length > 0) void triggerQueueProcessor()
  return { submissionsQueued: toQueue.length, skippedTeacherMarked: rows.length - toQueue.length }
}

/**
 * set_activity_marking_prompt: save through setActivityMarkingPrompt, then,
 * when `remark` (the default) and the prompt text changed, re-mark pupils'
 * latest work (remarkActivityAfterPromptChange). `remark: false` saves only:
 * existing marks and comments stay, and marking from now on uses the new
 * prompt. Teacher marks and comments are kept either way.
 */
export async function setActivityMarkingPromptAndRemark(
  activityId: string,
  update: MarkingPromptUpdate,
  options: { remark: boolean },
): Promise<{ prompt: ActivityMarkingPrompt; remarking: MarkingPromptRemarking }> {
  const before = await getActivityMarkingPrompt(activityId)
  const after = await setActivityMarkingPrompt(activityId, update)
  const remarking: MarkingPromptRemarking = {
    remark: options.remark,
    prompt_changed: (before.marking_prompt ?? '').trim() !== (after.marking_prompt ?? '').trim(),
    submissions_queued: 0,
    skipped_teacher_marked: 0,
  }
  if (options.remark && remarking.prompt_changed) {
    const done = await remarkActivityAfterPromptChange(activityId)
    remarking.submissions_queued = done.submissionsQueued
    remarking.skipped_teacher_marked = done.skippedTeacherMarked
  }
  return { prompt: after, remarking }
}

/** One line for the tool's text result. */
export function describeMarkingPromptRemarking(r: MarkingPromptRemarking): string {
  if (!r.prompt_changed) return 'The marking prompt did not change; nothing re-marked.'
  if (!r.remark) return 'Not re-marked: existing marks stay; new marking uses the new prompt.'
  return `Re-marking ${r.submissions_queued} submission${r.submissions_queued === 1 ? '' : 's'}; `
    + `${r.skipped_teacher_marked} skipped as teacher-marked.`
}
