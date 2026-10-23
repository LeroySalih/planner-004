import { withDbClient } from '@/lib/db'
import { listUnitAudits, readUnitAudit, recordUnitAudit, type RecordUnitAuditInput } from '@/lib/unit-audits/store'

// Unit audits (migration 123) against a dev database, in one transaction that
// is rolled back: nothing is left behind.
// Run with DATABASE_URL set: npx tsx tests/unit-audits/unit-audits.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const by = { userId: null, clientId: 'unit-audit-check' }
const UNIT = 'audit-check-unit'
const OTHER_UNIT = 'audit-check-other'
const LESSON = 'audit-check-lesson'
const OTHER_LESSON = 'audit-check-other-lesson'

async function main() {
  await withDbClient(async (db) => {
    await db.query('begin')
    try {
      const status = async () => (await readUnitAudit(db, UNIT))?.status
      const record = (input: Omit<RecordUnitAuditInput, 'unitId'>) => recordUnitAudit(db, { unitId: UNIT, ...input }, by)
      const refuses = async (name: string, input: Omit<RecordUnitAuditInput, 'unitId'>, unitId = UNIT) => {
        await db.query('savepoint refuse')
        try {
          await recordUnitAudit(db, { unitId, ...input }, by)
          check(name, false, 'was accepted')
        } catch {
          check(name, true)
        }
        await db.query('rollback to savepoint refuse')
      }

      const { rows: [{ subject }] } = await db.query<{ subject: string }>('select subject from subjects limit 1')
      await db.query(`insert into units (unit_id, title, subject) values ($1, 'Audit check', $3), ($2, 'Other', $3)`, [UNIT, OTHER_UNIT, subject])
      await db.query(`insert into lessons (lesson_id, unit_id, title) values ($1, $2, 'Lesson one'), ($3, $4, 'Elsewhere')`, [LESSON, UNIT, OTHER_LESSON, OTHER_UNIT])

      const fresh = await readUnitAudit(db, UNIT)
      check('a new unit is not audited', fresh?.status === 'not_audited' && fresh.lastResult === null && fresh.actions.length === 0)

      await refuses('a fail needs actions', { result: 'failed', actions: [] })
      await refuses('a pass takes no actions', { result: 'passed', actions: [{ action: 'x' }] })
      await refuses('an action must name a lesson of the unit', { result: 'failed', actions: [{ action: 'x', lesson_id: OTHER_LESSON }] })
      await refuses('a blank action is refused', { result: 'failed', actions: [{ action: '   ' }] })
      await refuses('an unknown unit is refused', { result: 'passed' }, 'no-such-unit')
      await refuses('a future start time is refused', { result: 'passed', startedAt: new Date(Date.now() + 3_600_000).toISOString() })

      const passed = await record({ result: 'passed' })
      check('a pass marks the unit audited with a date', passed.status === 'audited' && Boolean(passed.auditedAt))

      await db.query('update lessons set hidden_from_pupils = true, is_public = false where lesson_id = $1', [LESSON])
      check('hiding a lesson from pupils is not a change', (await status()) === 'audited')

      await db.query(`update lessons set title = 'Lesson 1' where lesson_id = $1`, [LESSON])
      const stale = await readUnitAudit(db, UNIT)
      check('retitling a lesson makes it not audited', stale?.status === 'not_audited')
      check('the last result is kept after a change', stale?.lastResult === 'passed' && stale.auditedAt === passed.auditedAt)

      const failedAudit = await record({
        result: 'failed',
        actions: [{ action: 'Add an STQ for the LO', lesson_id: LESSON }, { action: 'Describe the unit' }],
      })
      check('a fail records its actions in order', failedAudit.status === 'failed'
        && failedAudit.actions.length === 2
        && failedAudit.actions[0].lessonId === LESSON && failedAudit.actions[0].lessonTitle === 'Lesson 1'
        && failedAudit.actions[1].lessonId === null && failedAudit.actions[1].action === 'Describe the unit')

      await db.query(`insert into activities (activity_id, lesson_id, title, type, order_by) values ('audit-check-act', $1, 'STQ', 'short-text-question', 0)`, [LESSON])
      const fixing = await readUnitAudit(db, UNIT)
      check('adding an activity makes it not audited', fixing?.status === 'not_audited')
      check('the failed actions stay as the to-do list', fixing?.actions.length === 2 && fixing.lastResult === 'failed')

      await record({ result: 'passed' })
      check('a later pass clears the actions', (await readUnitAudit(db, UNIT))?.actions.length === 0 && (await status()) === 'audited')

      await db.query(`update activities set title = 'STQ' where activity_id = 'audit-check-act'`)
      check('saving an activity unchanged is not a change', (await status()) === 'audited')

      await db.query(`insert into stored_files (bucket, scope_path, file_name, stored_path) values ('lessons', $1, 'work.png', 'x')`, [`${LESSON}/activities/audit-check-act/pupil@example.org`])
      check("a pupil's upload is not a change", (await status()) === 'audited')

      await db.query(`insert into lessons (lesson_id, unit_id, title, kind) values ('audit-check-intervention', $1, 'For one pupil', 'intervention')`, [UNIT])
      check('an intervention lesson is not a change', (await status()) === 'audited')

      await db.query(`insert into stored_files (bucket, scope_path, file_name, stored_path) values ('lessons', $1, 'slides.pdf', 'x')`, [LESSON])
      check('a lesson file is a change', (await status()) === 'not_audited')

      await record({ result: 'passed' })
      await db.query(`insert into stored_files (bucket, scope_path, file_name, stored_path) values ('lessons', $1, 'sheet.pdf', 'x')`, [`${LESSON}/activities/audit-check-act`])
      check('an activity file is a change', (await status()) === 'not_audited')

      await record({ result: 'passed' })
      await db.query(`insert into stored_files (bucket, scope_path, file_name, stored_path) values ('units', $1, 'plan.pdf', 'x')`, [UNIT])
      check('a unit file is a change', (await status()) === 'not_audited')

      const { rows: [criterion] } = await db.query<{ success_criteria_id: string }>('select success_criteria_id from success_criteria limit 1')
      if (criterion) {
        await record({ result: 'passed' })
        await db.query('insert into activity_success_criteria (activity_id, success_criteria_id) values ($1, $2)', ['audit-check-act', criterion.success_criteria_id])
        check('linking an SC to an activity is a change', (await status()) === 'not_audited')
      }

      await record({ result: 'passed' })
      await db.query(`insert into lesson_links (lesson_id, url) values ($1, 'https://example.org')`, [LESSON])
      check('adding a lesson link is a change', (await status()) === 'not_audited')

      await record({ result: 'passed' })
      await db.query(`update units set description = 'Now described' where unit_id = $1`, [UNIT])
      check('editing the unit is a change', (await status()) === 'not_audited')

      await record({ result: 'passed' })
      await db.query(`update lessons set unit_id = $2 where lesson_id = $1`, [OTHER_LESSON, UNIT])
      check('moving a lesson in is a change', (await status()) === 'not_audited')

      const startedAt = new Date().toISOString()
      await db.query(`update lessons set title = 'Edited mid-audit' where lesson_id = $1`, [LESSON])
      const late = await record({ result: 'passed', startedAt })
      check('a pass started before an edit stays not audited', late.status === 'not_audited' && late.lastResult === 'passed')

      await record({ result: 'failed', actions: [{ action: 'x' }] })
      const failing = await listUnitAudits(db, { status: 'failed', subject })
      check('the list filters by status', failing.some((a) => a.unitId === UNIT) && failing.every((a) => a.status === 'failed'))
      const notAudited = await listUnitAudits(db, { status: 'not_audited', subject })
      check('the other unit lists as not audited', notAudited.some((a) => a.unitId === OTHER_UNIT) && !notAudited.some((a) => a.unitId === UNIT))

      await db.query('delete from activity_success_criteria where activity_id = $1', ['audit-check-act'])
      await db.query(`delete from activities where activity_id = 'audit-check-act'`)
      await db.query('delete from units where unit_id = $1', [UNIT])
      check('deleting a unit with lessons still works', (await readUnitAudit(db, UNIT)) === null)
    } finally {
      await db.query('rollback')
    }
  })

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
