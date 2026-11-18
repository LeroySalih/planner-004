import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { checkAccessDatabase } from '@/lib/accdb/check'
import { DATABASE_MESSAGES, UnreadableDatabaseError } from '@/lib/accdb/errors'
import { readAccessDatabase } from '@/lib/accdb/read'
import type { DatabaseSnapshot } from '@/lib/accdb/types'

// The Access database reader on the teacher's Palm Grove Vets files: the
// model answer (tables, field types and sizes, records, table sort, lookups,
// relationships, both query designs, forms and reports) and the starting
// database (no queries, forms or reports; fewer records). Then refusals
// (random bytes, a truncated file, an .mdb header, a lock file, a .docx named
// .accdb), the temp directories removed, and mdbtools missing reported as a
// plain Error. No database connection, no network, no model; needs mdbtools.
//   npx tsx tests/database-assessment/reader.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

async function refused(run: () => Promise<unknown>, message: string): Promise<[boolean, string]> {
  try {
    await run()
    return [false, 'not refused']
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return [error instanceof UnreadableDatabaseError && text === message, `${error?.constructor?.name}: ${text}`]
  }
}

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'database')

async function accdbTempDirs() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('dino-accdb-'))
}

function table(snapshot: DatabaseSnapshot, name: string) {
  return snapshot.tables.find((t) => t.name === name)
}

function field(snapshot: DatabaseSnapshot, tableName: string, fieldName: string) {
  return table(snapshot, tableName)?.fields.find((f) => f.name === fieldName)
}

async function main() {
  const tempBefore = await accdbTempDirs()
  const model = await readFile(path.join(FIXTURES, 'palm-grove-model-answer.accdb'))
  const start = await readFile(path.join(FIXTURES, 'palm-grove-start.accdb'))
  const docx = await readFile(path.join(FIXTURES, 'palm-grove-evidence-template.docx'))

  // --- Model answer
  const snapshot = await readAccessDatabase(model)
  check('version is ACE14', snapshot.version === 'ACE14', snapshot.version)
  check(
    'tables APPOINTMENTS, OWNERS, PETS',
    JSON.stringify(snapshot.tables.map((t) => t.name).sort()) === JSON.stringify(['APPOINTMENTS', 'OWNERS', 'PETS']),
    snapshot.tables.map((t) => t.name).join(', '),
  )
  check('no warnings on the model answer', snapshot.warnings.length === 0, snapshot.warnings.join(' | '))

  const mobile = field(snapshot, 'OWNERS', 'MOBILE')
  check('OWNERS.MOBILE is Text size 10', mobile?.type === 'Text' && mobile.size === 10, JSON.stringify(mobile))
  const chipped = field(snapshot, 'PETS', 'MICROCHIPPED')
  check('PETS.MICROCHIPPED is Boolean, NOT NULL', chipped?.type === 'Boolean' && chipped.notNull && chipped.size === null, JSON.stringify(chipped))
  const appointmentFields = table(snapshot, 'APPOINTMENTS')?.fields.map((f) => `${f.name}:${f.type}${f.size === null ? '' : `(${f.size})`}`)
  check(
    'APPOINTMENTS field types and sizes in order',
    JSON.stringify(appointmentFields) ===
      JSON.stringify([
        'APPOINTMENT ID:Long Integer',
        'PET ID:Long Integer',
        'APPOINTMENT DATE:DateTime',
        'REASON:Text(20)',
        'VET:Text(20)',
        'COST:Currency',
        'PAID:Boolean',
      ]),
    JSON.stringify(appointmentFields),
  )
  const ownerFields = table(snapshot, 'OWNERS')?.fields.map((f) => `${f.name}:${f.type}${f.size === null ? '' : `(${f.size})`}`)
  check(
    'OWNERS field types and sizes in order',
    JSON.stringify(ownerFields) ===
      JSON.stringify(['OWNER ID:Text(4)', 'FIRST NAME:Text(30)', 'SURNAME:Text(30)', 'MOBILE:Text(10)', 'AREA:Text(30)']),
    JSON.stringify(ownerFields),
  )
  check('APPOINTMENT DATE format Short Date', field(snapshot, 'APPOINTMENTS', 'APPOINTMENT DATE')?.format === 'Short Date')
  check('COST format Currency', field(snapshot, 'APPOINTMENTS', 'COST')?.format === 'Currency')

  check('OWNERS has 26 records', table(snapshot, 'OWNERS')?.rowCount === 26, String(table(snapshot, 'OWNERS')?.rowCount))
  check('APPOINTMENTS has 61 records', table(snapshot, 'APPOINTMENTS')?.rowCount === 61, String(table(snapshot, 'APPOINTMENTS')?.rowCount))
  check('PETS has 30 records', table(snapshot, 'PETS')?.rowCount === 30, String(table(snapshot, 'PETS')?.rowCount))
  check('no table truncated', snapshot.tables.every((t) => !t.rowsTruncated && t.rows.length === t.rowCount))
  const last = table(snapshot, 'APPOINTMENTS')?.rows.at(-1)
  check(
    'last appointment: 22-03-2027, PAID No, COST 450',
    last?.['APPOINTMENT DATE'] === '22-03-2027' && last?.PAID === 'No' && last?.COST === '450',
    JSON.stringify(last),
  )
  check('record keys in field order', JSON.stringify(Object.keys(last ?? {})) === JSON.stringify(table(snapshot, 'APPOINTMENTS')?.fields.map((f) => f.name)))
  check('a paid appointment reads Yes', table(snapshot, 'APPOINTMENTS')?.rows[0]?.PAID === 'Yes', JSON.stringify(table(snapshot, 'APPOINTMENTS')?.rows[0]))
  check('pet date of birth DD-MM-YYYY', table(snapshot, 'PETS')?.rows[0]?.['DATE OF BIRTH'] === '13-08-2018', JSON.stringify(table(snapshot, 'PETS')?.rows[0]))

  const ownersSort = table(snapshot, 'OWNERS')?.sort
  check('OWNERS sorted by [OWNERS].[SURNAME], on', ownersSort?.orderBy === '[OWNERS].[SURNAME]' && ownersSort.orderByOn === true, JSON.stringify(ownersSort))
  check('APPOINTMENTS has no saved sort', table(snapshot, 'APPOINTMENTS')?.sort.orderBy === null)

  const reason = field(snapshot, 'APPOINTMENTS', 'REASON')?.lookup
  check(
    'REASON lookup: value list, limit to list',
    reason?.rowSourceType === 'Value List' &&
      reason.rowSource === '"Check-up";"Vaccination";"Dental";"Surgery";"Grooming"' &&
      reason.limitToList === true &&
      reason.displayControl === 'Combo Box' &&
      reason.boundColumn === 1 &&
      reason.columnCount === 1,
    JSON.stringify(reason),
  )
  const vet = field(snapshot, 'APPOINTMENTS', 'VET')?.lookup
  check('VET lookup', vet?.rowSource === '"Dr Saleh";"Dr Patel";"Dr Mansour"' && vet.limitToList === true, JSON.stringify(vet))
  const species = field(snapshot, 'PETS', 'SPECIES')?.lookup
  check('SPECIES lookup', species?.rowSource === '"Cat";"Dog";"Rabbit";"Bird";"Tortoise"' && species.limitToList === true, JSON.stringify(species))
  check('a Yes/No field is not a lookup', field(snapshot, 'APPOINTMENTS', 'PAID')?.lookup === null)
  check('a plain Text field is not a lookup', field(snapshot, 'OWNERS', 'MOBILE')?.lookup === null)

  const relationships = snapshot.relationships.map((r) => `${r.name}:${r.referencedTable}.${r.referencedFields.join('+')}->${r.table}.${r.fields.join('+')}:${r.enforced}`)
  check(
    'relationships OWNERSPETS and PETSAPPOINTMENTS, both enforced',
    JSON.stringify(relationships) ===
      JSON.stringify(['OWNERSPETS:OWNERS.OWNER ID->PETS.OWNER ID:true', 'PETSAPPOINTMENTS:PETS.PET ID->APPOINTMENTS.PET ID:true']),
    JSON.stringify(relationships),
  )
  check('no cascades', snapshot.relationships.every((r) => r.cascadeDelete === false && r.cascadeUpdate === false && r.grbit === 0))

  check('queries: MICROCHIP REMINDER, UNPAID TREATMENTS', JSON.stringify(snapshot.queries.map((q) => q.name)) === JSON.stringify(['MICROCHIP REMINDER', 'UNPAID TREATMENTS']), snapshot.queries.map((q) => q.name).join(', '))
  check('no ~sq_ names among the queries', snapshot.queries.every((q) => !q.name.startsWith('~')))

  const microchip = snapshot.queries.find((q) => q.name === 'MICROCHIP REMINDER')
  check('MICROCHIP REMINDER is a select query', microchip?.type === 'select')
  check('MICROCHIP REMINDER table PETS', JSON.stringify(microchip?.tables) === JSON.stringify([{ name: 'PETS', alias: null }]), JSON.stringify(microchip?.tables))
  check(
    'MICROCHIP REMINDER outputs PET ID, PET NAME, OWNER ID in order',
    JSON.stringify(microchip?.outputs.map((o) => o.expression)) === JSON.stringify(['PETS.[PET ID]', 'PETS.[PET NAME]', 'PETS.[OWNER ID]']),
    JSON.stringify(microchip?.outputs),
  )
  check('MICROCHIP REMINDER hides DATE OF BIRTH', microchip?.hiddenFields.includes('PETS.[DATE OF BIRTH]') === true, JSON.stringify(microchip?.hiddenFields))
  check(
    'MICROCHIP REMINDER hidden fields are the WHERE/ORDER BY fields not shown',
    JSON.stringify(microchip?.hiddenFields) === JSON.stringify(['PETS.[DATE OF BIRTH]', 'PETS.[SPECIES]', 'PETS.[MICROCHIPPED]']),
    JSON.stringify(microchip?.hiddenFields),
  )
  check(
    'MICROCHIP REMINDER WHERE',
    !!microchip?.where && microchip.where.includes('<#1/1/2020#') && microchip.where.includes('="Dog"') && microchip.where.includes('=No'),
    microchip?.where ?? 'null',
  )
  check(
    'MICROCHIP REMINDER ORDER BY DATE OF BIRTH ascending',
    JSON.stringify(microchip?.orderBy) === JSON.stringify([{ expression: 'PETS.[DATE OF BIRTH]', descending: false }]),
    JSON.stringify(microchip?.orderBy),
  )
  check('MICROCHIP REMINDER has its SQL', microchip?.sql?.startsWith('SELECT PETS.[PET ID]') === true, microchip?.sql ?? 'null')
  check('MICROCHIP REMINDER has no joins', microchip?.joins.length === 0)

  const unpaid = snapshot.queries.find((q) => q.name === 'UNPAID TREATMENTS')
  check('UNPAID TREATMENTS has 3 tables', JSON.stringify(unpaid?.tables.map((t) => t.name)) === JSON.stringify(['OWNERS', 'PETS', 'APPOINTMENTS']), JSON.stringify(unpaid?.tables))
  check(
    'UNPAID TREATMENTS has 2 inner joins',
    JSON.stringify(unpaid?.joins) ===
      JSON.stringify([
        { left: 'OWNERS', right: 'PETS', on: 'OWNERS.[OWNER ID] = PETS.[OWNER ID]', kind: 'inner' },
        { left: 'PETS', right: 'APPOINTMENTS', on: 'PETS.[PET ID] = APPOINTMENTS.[PET ID]', kind: 'inner' },
      ]),
    JSON.stringify(unpaid?.joins),
  )
  check(
    'UNPAID TREATMENTS 7 outputs in order',
    JSON.stringify(unpaid?.outputs.map((o) => o.expression)) ===
      JSON.stringify([
        'OWNERS.[FIRST NAME]',
        'OWNERS.SURNAME',
        'OWNERS.MOBILE',
        'PETS.[PET NAME]',
        'APPOINTMENTS.[APPOINTMENT DATE]',
        'APPOINTMENTS.REASON',
        'APPOINTMENTS.COST',
      ]),
    JSON.stringify(unpaid?.outputs),
  )
  check(
    'UNPAID TREATMENTS WHERE',
    !!unpaid?.where &&
      unpaid.where.includes('Between #2/1/2027# And #3/31/2027#') &&
      unpaid.where.includes('"Dental" Or') &&
      unpaid.where.includes('>150'),
    unpaid?.where ?? 'null',
  )
  check(
    'UNPAID TREATMENTS ORDER BY COST descending',
    JSON.stringify(unpaid?.orderBy) === JSON.stringify([{ expression: 'APPOINTMENTS.COST', descending: true }]),
    JSON.stringify(unpaid?.orderBy),
  )
  check('UNPAID TREATMENTS hides only PAID', JSON.stringify(unpaid?.hiddenFields) === JSON.stringify(['APPOINTMENTS.[PAID]']), JSON.stringify(unpaid?.hiddenFields))

  check(
    'forms APPOINTMENT FORM (APPOINTMENTS) and PETS LIST FORM (PETS)',
    JSON.stringify(snapshot.forms) ===
      JSON.stringify([
        { name: 'APPOINTMENT FORM', baseTables: ['APPOINTMENTS'] },
        { name: 'PETS LIST FORM', baseTables: ['PETS'] },
      ]),
    JSON.stringify(snapshot.forms),
  )
  // The reports' record sources are saved queries, not hidden ~sq_r queries,
  // so the reader has no base table to read for them.
  check(
    'reports MICROCHIP REMINDER REPORT and UNPAID TREATMENTS REPORT, base unknown',
    JSON.stringify(snapshot.reports) ===
      JSON.stringify([
        { name: 'MICROCHIP REMINDER REPORT', baseTables: null },
        { name: 'UNPAID TREATMENTS REPORT', baseTables: null },
      ]),
    JSON.stringify(snapshot.reports),
  )

  // --- Starting database
  const startSnapshot = await readAccessDatabase(start)
  check('start: no queries, forms or reports', startSnapshot.queries.length === 0 && startSnapshot.forms.length === 0 && startSnapshot.reports.length === 0)
  check('start: OWNERS 25 records', table(startSnapshot, 'OWNERS')?.rowCount === 25, String(table(startSnapshot, 'OWNERS')?.rowCount))
  check('start: APPOINTMENTS 60 records', table(startSnapshot, 'APPOINTMENTS')?.rowCount === 60, String(table(startSnapshot, 'APPOINTMENTS')?.rowCount))
  check('start: OWNERS has no saved sort', table(startSnapshot, 'OWNERS')?.sort.orderBy === null, JSON.stringify(table(startSnapshot, 'OWNERS')?.sort))
  check('start: same relationships', startSnapshot.relationships.length === 2)
  check('start: no warnings', startSnapshot.warnings.length === 0, startSnapshot.warnings.join(' | '))

  // --- Row cap
  const capped = await readAccessDatabase(model, { maxRowsPerTable: 10 })
  const cappedAppointments = table(capped, 'APPOINTMENTS')
  check('row cap keeps the count and marks truncation', cappedAppointments?.rows.length === 10 && cappedAppointments.rowCount === 61 && cappedAppointments.rowsTruncated)

  // --- Refusals
  const random = Buffer.alloc(8192)
  for (let i = 0; i < random.length; i += 1) random[i] = (i * 7919 + 13) % 256
  let [ok, detail] = await refused(() => readAccessDatabase(random), DATABASE_MESSAGES.notAccess)
  check('random bytes refused as not Access', ok, detail)
  ;[ok, detail] = await refused(() => readAccessDatabase(model.subarray(0, 4096)), DATABASE_MESSAGES.unopenable)
  check('a truncated database refused as unopenable', ok, detail)
  const jet = Buffer.from(model)
  jet.write('Standard Jet DB', 4, 'latin1')
  ;[ok, detail] = await refused(() => readAccessDatabase(jet), DATABASE_MESSAGES.mdb)
  check('a Jet header refused as .mdb', ok, detail)
  ;[ok, detail] = await refused(() => checkAccessDatabase(model, 'x.laccdb'), DATABASE_MESSAGES.lockFile)
  check('a .laccdb name refused as a lock file', ok, detail)
  ;[ok, detail] = await refused(() => checkAccessDatabase(model, 'Palm Grove.mdb'), DATABASE_MESSAGES.mdb)
  check('a .mdb name refused as .mdb', ok, detail)
  ;[ok, detail] = await refused(() => checkAccessDatabase(model, 'Palm Grove.xlsx'), DATABASE_MESSAGES.notThisType)
  check('another extension refused', ok, detail)
  ;[ok, detail] = await refused(() => checkAccessDatabase(docx, 'database.accdb'), DATABASE_MESSAGES.notAccess)
  check('a .docx named .accdb refused as not Access', ok, detail)
  ;[ok, detail] = await refused(() => checkAccessDatabase(model.subarray(0, 4096), 'database.accdb'), DATABASE_MESSAGES.unopenable)
  check('upload check refuses a truncated database', ok, detail)
  const checked = await checkAccessDatabase(model, 'PALM GROVE VETS.ACCDB')
  check('upload check opens the model answer', checked.version === 'ACE14' && checked.tables.length === 3, JSON.stringify(checked))

  // --- mdbtools missing: a plain Error, so the job retries
  const emptyDir = await mkdtemp(path.join(tmpdir(), 'dino-empty-path-'))
  const savedPath = process.env.PATH
  process.env.PATH = emptyDir
  let missing: unknown = null
  try {
    await readAccessDatabase(model)
  } catch (error) {
    missing = error
  } finally {
    process.env.PATH = savedPath
    await rm(emptyDir, { recursive: true, force: true })
  }
  check(
    'mdbtools missing is a plain Error',
    missing instanceof Error && !(missing instanceof UnreadableDatabaseError),
    missing instanceof Error ? `${missing.constructor.name}: ${missing.message}` : String(missing),
  )

  // --- Temp directories
  const tempAfter = await accdbTempDirs()
  check('no dino-accdb-* directory left behind', tempAfter.filter((d) => !tempBefore.includes(d)).length === 0, tempAfter.join(', '))

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
