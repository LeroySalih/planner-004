import { randomUUID } from 'node:crypto'

import { query } from '@/lib/db'
import { readPlannerUnitOverview } from '@/lib/teacher-planner/unit-overview'

// The weekly planner's lesson dropdown: grouping by sub unit, unit order, which
// lessons appear, and the latest date each is planned for one class. Creates its own
// units, sub units, lessons, classes and planner rows, and removes them.
// Run with DATABASE_URL set: npx tsx tests/teacher-planner/unit-overview.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const tag = randomUUID().slice(0, 8)
const UNIT = `ov-check-unit-${tag}`
const FLAT_UNIT = `ov-check-flat-${tag}`
const GROUP = `ov-check-group-${tag}`
const OTHER_GROUP = `ov-check-other-${tag}`
const SU_A = `ov-check-su-a-${tag}`
const SU_B = `ov-check-su-b-${tag}`
const L = (name: string) => `ov-check-${name}-${tag}`

async function setUp() {
  const { rows: [{ subject }] } = await query<{ subject: string }>('select subject from subjects limit 1')
  await query("insert into units (unit_id, title, subject) values ($1, 'Overview check', $2), ($3, 'Flat check', $2)", [UNIT, subject, FLAT_UNIT])
  await query('insert into groups (group_id, subject) values ($1, $3), ($2, $3)', [GROUP, OTHER_GROUP, subject])
  // A is created first, but B's lessons come first in the unit: the dropdown
  // follows the unit's lesson order, as the unit page does.
  await query("insert into sub_units (sub_unit_id, unit_id, title, created_at) values ($1, $3, 'Part A', now() - interval '1 day'), ($2, $3, 'Part B', now())", [SU_A, SU_B, UNIT])
  const lessons: [string, string, number, string | null, string, boolean][] = [
    // id, title, order_by (from 1: the insert trigger renumbers 0), sub unit, kind, active
    [L('b1'), 'Zeta opener', 1, SU_B, 'standard', true],
    [L('b2'), 'Beta tie', 2, SU_B, 'standard', true],
    [L('b3'), 'Alpha tie', 2, SU_B, 'standard', true],
    [L('a1'), 'Part A lesson', 3, SU_A, 'standard', true],
    [L('a2'), 'Inactive lesson', 4, SU_A, 'standard', false],
    [L('o1'), 'Loose lesson', 5, null, 'standard', true],
    [L('i1'), 'Intervention lesson', 6, null, 'intervention', true],
  ]
  for (const [id, title, order, subUnit, kind, active] of lessons) {
    await query(
      'insert into lessons (lesson_id, unit_id, title, order_by, sub_unit_id, kind, active) values ($1, $2, $3, $4, $5, $6, $7)',
      [id, UNIT, title, order, subUnit, kind, active],
    )
  }
  await query("insert into lessons (lesson_id, unit_id, title, order_by) values ($1, $2, 'Flat lesson', 1)", [L('f1'), FLAT_UNIT])

  const plan: [string, string, string, string, number][] = [
    // group, lesson, week (Sunday), day, period
    [GROUP, L('b1'), '2026-01-04', 'tuesday', 1], // 06-01-2026
    [GROUP, L('b1'), '2025-12-28', 'thursday', 2], // 01-01-2026
    [GROUP, L('b1'), '2026-01-11', 'sunday', 3], // 11-01-2026, the latest
    [GROUP, L('b3'), '2026-02-01', 'monday', 4], // 02-02-2026
    [OTHER_GROUP, L('a1'), '2026-01-04', 'sunday', 1], // another class only
    [OTHER_GROUP, L('b3'), '2026-03-01', 'sunday', 1], // later, but another class
  ]
  for (const [group, lesson, week, day, period] of plan) {
    await query(
      'insert into planner_assignments (group_id, lesson_id, week_start_date, day, period) values ($1, $2, $3, $4, $5)',
      [group, lesson, week, day, period],
    )
  }
}

async function tearDown() {
  await query('delete from planner_assignments where group_id in ($1, $2)', [GROUP, OTHER_GROUP])
  await query('delete from lessons where unit_id in ($1, $2)', [UNIT, FLAT_UNIT])
  await query('delete from units where unit_id in ($1, $2)', [UNIT, FLAT_UNIT])
  await query('delete from groups where group_id in ($1, $2)', [GROUP, OTHER_GROUP])
}

async function main() {
  await setUp()
  try {
    const overview = await readPlannerUnitOverview(UNIT, GROUP)
    check('found', overview !== null)
    if (!overview) throw new Error('no overview')
    check('unit title', overview.unitTitle === 'Overview check', overview.unitTitle)

    const headings = overview.groups.map((g) => g.title)
    check('sub units in lesson order, ungrouped last', JSON.stringify(headings) === JSON.stringify(['Part B', 'Part A', 'Other lessons']), JSON.stringify(headings))

    const titles = overview.groups.map((g) => g.lessons.map((l) => l.title))
    check('lessons by order_by then title', JSON.stringify(titles[0]) === JSON.stringify(['Zeta opener', 'Alpha tie', 'Beta tie']), JSON.stringify(titles[0]))

    const all = overview.groups.flatMap((g) => g.lessons)
    check('inactive lesson left out', !all.some((l) => l.lessonId === L('a2')))
    check('intervention lesson left out', !all.some((l) => l.lessonId === L('i1')))
    check('ungrouped lesson under Other lessons', titles[2]?.length === 1 && titles[2][0] === 'Loose lesson', JSON.stringify(titles[2]))

    const byId = new Map(all.map((l) => [l.lessonId, l]))
    const b1 = byId.get(L('b1'))
    check('latest of several planned dates, from the day', b1?.latestDate === '2026-01-11', b1?.latestDate ?? 'null')
    check('occurrences counted', b1?.occurrences === 3, String(b1?.occurrences))
    const b3 = byId.get(L('b3'))
    check('planned date is week start + day', b3?.latestDate === '2026-02-02' && b3.occurrences === 1, `${b3?.latestDate} ${b3?.occurrences}`)
    const a1 = byId.get(L('a1'))
    check("another class's plan not shown", a1?.latestDate === null && a1.occurrences === 0, `${a1?.latestDate} ${a1?.occurrences}`)
    const b2 = byId.get(L('b2'))
    check('unplanned lesson has no date', b2?.latestDate === null && b2.occurrences === 0)

    // lesson_assignments is a view over planner_assignments, so it can never
    // date a lesson the planner has not: no separate fallback is needed.
    const { rows: assigned } = await query<{ lesson_id: string; start_date: string }>(
      'select lesson_id, start_date::text as start_date from lesson_assignments where group_id = $1',
      [GROUP],
    )
    const datedIds = all.filter((l) => l.latestDate).map((l) => l.lessonId).sort()
    check(
      'lesson_assignments dates exactly the planned lessons',
      JSON.stringify(assigned.map((r) => r.lesson_id).sort()) === JSON.stringify(datedIds),
      JSON.stringify(assigned),
    )
    check(
      'lesson_assignments start_date is the planned week',
      assigned.every((r) => r.start_date <= (byId.get(r.lesson_id)?.latestDate ?? '')),
    )

    const otherView = await readPlannerUnitOverview(UNIT, OTHER_GROUP)
    const otherB3 = otherView?.groups.flatMap((g) => g.lessons).find((l) => l.lessonId === L('b3'))
    check('dates follow the class asked for', otherB3?.latestDate === '2026-03-01', otherB3?.latestDate ?? 'null')

    const flat = await readPlannerUnitOverview(FLAT_UNIT, GROUP)
    check('unit with no sub units: one group, no heading', flat?.groups.length === 1 && flat.groups[0].title === null && flat.groups[0].lessons.length === 1)

    check('unknown unit is null', (await readPlannerUnitOverview(`ov-check-missing-${tag}`, GROUP)) === null)
  } finally {
    await tearDown()
  }

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from units where unit_id in ($1, $2)) + (select count(*) from groups where group_id in ($3, $4))
          + (select count(*) from lessons where lesson_id like $5) + (select count(*) from sub_units where sub_unit_id like $5)
          + (select count(*) from planner_assignments where group_id in ($3, $4)) as left`,
    [UNIT, FLAT_UNIT, GROUP, OTHER_GROUP, `ov-check-%-${tag}`],
  )
  check('cleaned up', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  tearDown().finally(() => process.exit(1))
})
