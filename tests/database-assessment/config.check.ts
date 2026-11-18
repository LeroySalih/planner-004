import { randomUUID } from 'node:crypto'

import { query, withDbClient } from '@/lib/db'
import {
  AI_MARKED_ACTIVITY_TYPES,
  isAssessmentPaperType,
  isDatabaseAssessmentType,
  isPowerPointAssessmentType,
  isPracticalAssessmentType,
  isQuestionMarkedActivityType,
  isScorableActivityType,
  PRACTICAL_ASSESSMENT_TYPES,
} from '@/dino.config'
import { defaultPowerPointAssessmentBody, QUESTION_EVIDENCE_SOURCES } from '@/lib/powerpoint-assessment/evidence-spec'
import {
  defaultDatabaseAssessmentBody,
  PRACTICAL_TYPE_CONFIGS,
  practicalBodySchema,
  practicalTypeConfig,
} from '@/lib/practical-assessment/types'
import { DatabaseAssessmentActivityBodySchema, PowerPointAssessmentActivityBodySchema } from '@/types'

// The database assessment type's registration: the type predicates, the
// practical type registry, the database body schema's refusals (with their
// exact messages), the PowerPoint schema still refusing an accdb slot, and
// the SQL side of migration 146 (type functions, the model route, the
// evidence kind). The evidence kind is tried inside a transaction that is
// rolled back, so nothing is left behind. No model is called and no file is
// stored.
// Run with DATABASE_URL set:
//   npx tsx tests/database-assessment/config.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

function issues(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.message)
}

const DB_SLOT = { key: 'database', label: 'Database', kind: 'accdb', required: true }
const DOC_SLOT = { key: 'evidence', label: 'Evidence document', kind: 'docx', required: true }

async function main() {
  // Predicates.
  check('database-assessment is practical', isPracticalAssessmentType('database-assessment'))
  check('powerpoint-assessment is practical', isPracticalAssessmentType('powerpoint-assessment'))
  check('assessment-paper is not practical', !isPracticalAssessmentType('assessment-paper'))
  check('upload-file is not practical', !isPracticalAssessmentType('upload-file'))
  check('practical predicate normalises', isPracticalAssessmentType(' Database-Assessment '))
  check('isDatabaseAssessmentType', isDatabaseAssessmentType('database-assessment') && !isDatabaseAssessmentType('powerpoint-assessment'))
  check('isPowerPointAssessmentType unchanged', isPowerPointAssessmentType('powerpoint-assessment') && !isPowerPointAssessmentType('database-assessment'))
  check('database is not an assessment paper', !isAssessmentPaperType('database-assessment'))
  check('database is question-marked', isQuestionMarkedActivityType('database-assessment'))
  check('database is scorable', isScorableActivityType('database-assessment'))
  check('database is AI-marked', AI_MARKED_ACTIVITY_TYPES.includes('database-assessment'))
  check(
    'PRACTICAL_ASSESSMENT_TYPES',
    JSON.stringify(PRACTICAL_ASSESSMENT_TYPES) === JSON.stringify(['powerpoint-assessment', 'database-assessment']),
  )

  // Registry.
  const ppt = practicalTypeConfig('powerpoint-assessment')
  const db = practicalTypeConfig('database-assessment')
  check('registry has every practical type', PRACTICAL_ASSESSMENT_TYPES.every((type) => PRACTICAL_TYPE_CONFIGS[type as keyof typeof PRACTICAL_TYPE_CONFIGS]?.type === type))
  check('PowerPoint sources unchanged', JSON.stringify(ppt.sources) === JSON.stringify(['presentation', 'slide_images', 'file', 'evidence_section', 'reference_file']), JSON.stringify(ppt.sources))
  check('every type\'s sources are parseable sources', [ppt, db].every((config) => config.sources.every((source) => QUESTION_EVIDENCE_SOURCES.includes(source))))
  check('database sources', JSON.stringify(db.sources) === JSON.stringify(['database', 'evidence_section', 'file', 'reference_file']), JSON.stringify(db.sources))
  check('PowerPoint slot kinds', JSON.stringify(ppt.slotKinds) === JSON.stringify(['pptx', 'pdf', 'docx']))
  check('database slot kinds', JSON.stringify(db.slotKinds) === JSON.stringify(['accdb', 'pdf', 'docx']))
  check('main kinds', ppt.mainKind === 'pptx' && db.mainKind === 'accdb')
  check('supplied images PowerPoint only', ppt.hasSuppliedImages && !db.hasSuppliedImages)
  check('starting database database only', !ppt.hasStartingDatabase && db.hasStartingDatabase)
  check('labels', ppt.label === 'PowerPoint assessment' && db.label === 'Database assessment' && db.labelLower === 'database assessment')
  check('practicalBodySchema', practicalBodySchema('database-assessment') === DatabaseAssessmentActivityBodySchema
    && practicalBodySchema('powerpoint-assessment') === PowerPointAssessmentActivityBodySchema)
  check('PowerPoint default body unchanged', JSON.stringify(ppt.defaultBody()) === JSON.stringify(defaultPowerPointAssessmentBody()))
  check('PowerPoint default body parses', PowerPointAssessmentActivityBodySchema.safeParse(ppt.defaultBody()).success)
  check('database default body', JSON.stringify(db.defaultBody()) === JSON.stringify({ uploadSlots: [DB_SLOT, DOC_SLOT] }), JSON.stringify(db.defaultBody()))
  check('database default body parses', DatabaseAssessmentActivityBodySchema.safeParse(defaultDatabaseAssessmentBody()).success)
  let threw = false
  try {
    practicalTypeConfig('assessment-paper')
  } catch {
    threw = true
  }
  check('practicalTypeConfig throws for a non-practical type', threw)

  // Database body schema.
  const full = DatabaseAssessmentActivityBodySchema.safeParse({
    instructions: 'Build the database.',
    uploadSlots: [DB_SLOT, DOC_SLOT, { key: 'printout', label: 'Printout', kind: 'pdf', required: false, hint: 'A PDF.' }],
    evidenceTemplateFile: 'EVIDENCE.docx',
    startingDatabaseFile: 'PALM GROVE VETS.accdb',
    questionPaperPath: 'x/paper.pdf',
    markSchemePath: 'x/scheme.pdf',
    showMarkSchemeToPupils: false,
    extra: 'kept',
  })
  check('full body parses and passes extra fields through', full.success && (full.data as Record<string, unknown>).extra === 'kept', issues(full).join('; '))

  const cases: [string, unknown, string][] = [
    ['no accdb slot', { uploadSlots: [DOC_SLOT] }, 'a database assessment needs exactly one accdb slot (the database), not 0'],
    ['two accdb slots', { uploadSlots: [DB_SLOT, { ...DB_SLOT, key: 'second' }] }, 'a database assessment needs exactly one accdb slot (the database), not 2'],
    ['accdb slot not required', { uploadSlots: [{ ...DB_SLOT, required: false }, DOC_SLOT] }, 'the accdb slot (the database) must be required'],
    ['duplicate keys', { uploadSlots: [DB_SLOT, { ...DOC_SLOT, key: 'database' }] }, 'the slot key "database" is used twice; slot keys must be unique'],
    ['no slots', { uploadSlots: [] }, 'a database assessment needs at least one upload slot'],
    ['nine slots', { uploadSlots: [DB_SLOT, ...Array.from({ length: 8 }, (_, i) => ({ ...DOC_SLOT, key: `e${i}`, required: false }))] }, 'a database assessment has at most 8 upload slots'],
    ['starting database not accdb', { uploadSlots: [DB_SLOT], startingDatabaseFile: 'start.mdb' }, 'the starting database must be an .accdb file'],
    ['starting database with a folder', { uploadSlots: [DB_SLOT], startingDatabaseFile: 'a/start.accdb' }, 'the starting database is an activity file name, with no folders'],
  ]
  for (const [name, body, message] of cases) {
    const result = DatabaseAssessmentActivityBodySchema.safeParse(body)
    check(`database body refuses ${name}`, !result.success && issues(result).includes(message), issues(result).join('; ') || 'accepted')
  }
  const pptxInDb = DatabaseAssessmentActivityBodySchema.safeParse({ uploadSlots: [DB_SLOT, { key: 'p', label: 'P', kind: 'pptx', required: false }] })
  check('database body refuses a pptx slot', !pptxInDb.success && pptxInDb.error.issues.some((issue) => issue.path.join('.') === 'uploadSlots.1.kind'), issues(pptxInDb).join('; ') || 'accepted')

  // PowerPoint body schema: unchanged, refuses accdb.
  const accdbInPpt = PowerPointAssessmentActivityBodySchema.safeParse({
    uploadSlots: [{ key: 'presentation', label: 'Presentation', kind: 'pptx', required: true }, DB_SLOT],
  })
  check('PowerPoint body refuses an accdb slot', !accdbInPpt.success && accdbInPpt.error.issues.some((issue) => issue.path.join('.') === 'uploadSlots.1.kind'), issues(accdbInPpt).join('; ') || 'accepted')
  const noPptx = PowerPointAssessmentActivityBodySchema.safeParse({ uploadSlots: [DOC_SLOT] })
  check('PowerPoint messages unchanged', issues(noPptx).includes('a PowerPoint assessment needs exactly one pptx slot (the presentation), not 0'), issues(noPptx).join('; '))

  // SQL parity.
  const { rows: [sql] } = await query<{ qm: boolean; sc: boolean; route: boolean }>(
    `select is_question_marked_activity_type('database-assessment') as qm,
            is_scorable_activity_type('database-assessment') as sc,
            exists (select 1 from ai_model_routes where activity_type = 'database-assessment' and sc_type is null) as route`,
  )
  check('SQL is_question_marked_activity_type', sql.qm === true)
  check('SQL is_scorable_activity_type', sql.sc === true)
  check('database route row', sql.route === true)
  const { rows: [{ ppt_qm }] } = await query<{ ppt_qm: boolean }>(
    "select is_question_marked_activity_type('powerpoint-assessment') and is_scorable_activity_type('powerpoint-assessment') as ppt_qm",
  )
  check('SQL still knows the PowerPoint type', ppt_qm === true)

  // The evidence kind, in a transaction that is rolled back.
  const tag = randomUUID().slice(0, 8)
  const kinds = await withDbClient(async (client) => {
    await client.query('begin')
    try {
      const { rows: [{ subject }] } = await client.query<{ subject: string }>('select subject from subjects limit 1')
      const unit = `db-config-check-unit-${tag}`
      const lesson = `db-config-check-lesson-${tag}`
      const activity = randomUUID()
      const pupil = `db-config-check-pupil-${tag}`
      await client.query("insert into profiles (user_id, first_name, last_name) values ($1, 'Ann', 'Aaa')", [pupil])
      await client.query('insert into units (unit_id, title, subject) values ($1, $2, $3)', [unit, `Database config ${tag}`, subject])
      await client.query(
        "insert into lessons (lesson_id, unit_id, title, order_by, kind) values ($1, $2, 'Database config check', 0, 'standard')",
        [lesson, unit],
      )
      await client.query(
        "insert into activities (activity_id, lesson_id, type, title, body_data, order_by) values ($1, $2, 'database-assessment', 'Database task', $3::jsonb, 0)",
        [activity, lesson, JSON.stringify(defaultDatabaseAssessmentBody())],
      )
      const { rows: [{ submission_id }] } = await client.query<{ submission_id: string }>(
        "insert into submissions (activity_id, user_id, body, attempt_number) values ($1, $2, '{}'::jsonb, 1) returning submission_id",
        [activity, pupil],
      )
      const { rows: [{ file_id }] } = await client.query<{ file_id: string }>(
        `insert into practical_submission_files (activity_id, pupil_id, submission_id, slot_key, original_name, storage_path, bytes, sha256)
         values ($1, $2, $3, 'database', 'x.accdb', 'x/original.accdb', 0, 'x') returning file_id`,
        [activity, pupil, submission_id],
      )
      const insertEvidence = (kind: string) =>
        client.query(
          `insert into practical_submission_evidence (file_id, submission_id, slot_key, kind, status, cache_key)
           values ($1, $2, 'database', $3, 'ok', 'k')`,
          [file_id, submission_id, kind],
        )
      await client.query('savepoint evidence')
      let database = true
      try {
        await insertEvidence('database')
      } catch {
        database = false
      }
      await client.query('rollback to savepoint evidence')
      let bogus = true
      try {
        await insertEvidence('bogus')
      } catch {
        bogus = false
      }
      return { database, bogus }
    } finally {
      await client.query('rollback')
    }
  })
  check("evidence kind accepts 'database'", kinds.database)
  check('evidence kind still refuses an unknown kind', !kinds.bogus)

  const { rows: [{ left }] } = await query<{ left: number }>(
    `select (select count(*) from units where unit_id = $1) + (select count(*) from profiles where user_id = $2) as left`,
    [`db-config-check-unit-${tag}`, `db-config-check-pupil-${tag}`],
  )
  check('nothing left behind', Number(left) === 0, String(left))

  console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
