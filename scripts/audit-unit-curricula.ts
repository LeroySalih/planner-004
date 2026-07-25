import * as dotenv from "dotenv"
dotenv.config()
import { Pool } from "pg"

// Audit + backfill for the unit↔curriculum link.
//
// For every unit it computes the DISTINCT set of curricula it currently touches,
// across all four assignment surfaces (a curriculum "counts" if any of these
// reference an AO belonging to it):
//   - success_criteria_units      (unit-level SC assignment)
//   - lessons_learning_objective  (LOs on the unit's lessons)
//   - lesson_success_criteria     (SCs on the unit's lessons)
//   - activity_success_criteria   (SCs on the unit's activities)
// Bespoke unit-owned AOs (assessment_objectives.curriculum_id is null) are ignored.
//
// Units touching exactly ONE curriculum get units.curriculum_id set (only when
// still null). Units touching MORE THAN ONE are reported for admin remediation.
// Pass --dry-run to report without writing.

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const UNIT_CURRICULA_SQL = `
  with unit_curr as (
    select u.unit_id, ao.curriculum_id
    from units u
    join success_criteria_units scu on scu.unit_id = u.unit_id
    join success_criteria sc on sc.success_criteria_id = scu.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id
    from lessons l
    join lessons_learning_objective llo on llo.lesson_id = l.lesson_id
    join learning_objectives lo on lo.learning_objective_id = llo.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id
    from lessons l
    join lesson_success_criteria lsc on lsc.lesson_id = l.lesson_id
    join success_criteria sc on sc.success_criteria_id = lsc.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
    union
    select l.unit_id, ao.curriculum_id
    from lessons l
    join activities a on a.lesson_id = l.lesson_id
    join activity_success_criteria asc2 on asc2.activity_id = a.activity_id
    join success_criteria sc on sc.success_criteria_id = asc2.success_criteria_id
    join learning_objectives lo on lo.learning_objective_id = sc.learning_objective_id
    join assessment_objectives ao on ao.assessment_objective_id = lo.assessment_objective_id
    where ao.curriculum_id is not null
  )
  select uc.unit_id,
         u.title,
         u.curriculum_id as current_curriculum_id,
         array_agg(distinct uc.curriculum_id) as curricula
  from unit_curr uc
  join units u on u.unit_id = uc.unit_id
  group by uc.unit_id, u.title, u.curriculum_id
  order by array_length(array_agg(distinct uc.curriculum_id), 1) desc, u.title asc
`

interface Row {
  unit_id: string
  title: string | null
  current_curriculum_id: string | null
  curricula: string[]
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  console.log(`\nUnit↔curriculum audit${dryRun ? " (dry run — no writes)" : ""}\n${"=".repeat(48)}`)

  const { rows } = await pool.query<Row>(UNIT_CURRICULA_SQL)

  const single = rows.filter((r) => r.curricula.length === 1)
  const multi = rows.filter((r) => r.curricula.length > 1)

  // Backfill single-curriculum units whose curriculum_id is still null.
  const toSet = single.filter((r) => !r.current_curriculum_id)
  let updated = 0
  if (!dryRun) {
    for (const r of toSet) {
      const res = await pool.query(
        `update units set curriculum_id = $2 where unit_id = $1 and curriculum_id is null`,
        [r.unit_id, r.curricula[0]],
      )
      updated += res.rowCount ?? 0
    }
  }

  console.log(`\nSingle-curriculum units: ${single.length}`)
  console.log(
    dryRun
      ? `  would set curriculum_id on ${toSet.length} (currently null)`
      : `  set curriculum_id on ${updated} unit(s)`,
  )

  console.log(`\n⚠  MULTI-curriculum units (need admin remediation): ${multi.length}`)
  for (const r of multi) {
    console.log(`  - ${r.unit_id}  "${r.title ?? ""}"  →  ${r.curricula.length} curricula: ${r.curricula.join(", ")}`)
  }

  // Units that touch NO curriculum at all (bespoke-only or empty) are simply
  // left with a null curriculum_id; report the count for visibility.
  const { rows: totalRows } = await pool.query<{ n: string }>(`select count(*)::text as n from units`)
  const touching = rows.length
  console.log(`\nUnits touching ≥1 curriculum: ${touching} of ${totalRows[0]?.n} total`)
  console.log("\nDone.\n")
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
