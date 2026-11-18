import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  describeDatabase,
  describeDatabaseSections,
  filterDatabaseSections,
  findDatabaseSection,
  type DatabaseReport,
} from '@/lib/accdb/describe'
import { diffDatabases } from '@/lib/accdb/diff'
import { readAccessDatabase } from '@/lib/accdb/read'
import {
  DEFAULT_DATABASE_SECTIONS,
  databaseNameKey,
  formatDatabaseSection,
  parseDatabaseSection,
} from '@/lib/accdb/section-selectors'
import type { DatabaseSnapshot } from '@/lib/accdb/types'

// The database description, its section selectors and the diff against the
// starting database, on the teacher's Palm Grove Vets files: the model answer
// diffed against the start lists exactly the expected changes; query blocks,
// record dates, named sections (found case-insensitively, or absent with the
// names that do exist); then doctored copies of the snapshot (sort flipped,
// sort removed, a record changed, no starting database). No database
// connection, no model; needs mdbtools.
//   npx tsx tests/database-assessment/describe.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'database')
const START = { fileName: 'palm-grove-start.accdb' }

function clone(snapshot: DatabaseSnapshot): DatabaseSnapshot {
  return structuredClone(snapshot)
}

function report(snapshot: DatabaseSnapshot, start: DatabaseSnapshot | null): DatabaseReport {
  return { snapshot, changes: start ? diffDatabases(start, snapshot) : null, startingDatabase: start ? START : null }
}

function sectionText(r: DatabaseReport, selector: string) {
  return describeDatabaseSections(r).find((s) => s.selector === selector)?.text ?? ''
}

async function main() {
  const model = await readAccessDatabase(await readFile(path.join(FIXTURES, 'palm-grove-model-answer.accdb')))
  const start = await readAccessDatabase(await readFile(path.join(FIXTURES, 'palm-grove-start.accdb')))

  // --- Selectors
  check('selectors: defaults leave out records and query', JSON.stringify(DEFAULT_DATABASE_SECTIONS) === JSON.stringify(['tables', 'fields', 'relationships', 'lookups', 'table-sort', 'changes', 'queries', 'objects', 'warnings']))
  check('parse "Query: MICROCHIP REMINDER "', JSON.stringify(parseDatabaseSection('Query: MICROCHIP REMINDER ')) === JSON.stringify({ key: 'query', name: 'MICROCHIP REMINDER' }))
  check('parse "records:owners" keeps the name case', formatDatabaseSection(parseDatabaseSection('RECORDS:owners')!) === 'records:owners')
  check('parse bare "records" (every table)', JSON.stringify(parseDatabaseSection('records')) === JSON.stringify({ key: 'records', name: null }))
  check('parse "TABLES" lower-cases the key', parseDatabaseSection('TABLES')?.key === 'tables')
  check('refuse bare "query", "records:", "tables:X", unknown, control chars, 65 chars', [
    'query', 'records:', 'records:  ', 'tables:OWNERS', 'nope', 'query:A\u0007B', `query:${'x'.repeat(65)}`,
  ].every((text) => parseDatabaseSection(text) === null))
  check('64-character name accepted', parseDatabaseSection(`query:${'x'.repeat(64)}`)?.name?.length === 64)
  check('databaseNameKey: case, NFKC, spaces', databaseNameKey(' microchip   Reminder ') === 'MICROCHIP REMINDER' && databaseNameKey('ＡＢ') === 'AB')

  // --- The model answer against the start
  const full = report(model, start)
  const changes = full.changes!
  const ownersAdded = changes.records.find((r) => r.table === 'OWNERS')?.added ?? []
  const lastOwner = model.tables.find((t) => t.name === 'OWNERS')!.rows.at(-1)!
  check('OWNERS: the one record added is the model answer\'s O026', ownersAdded.length === 1 && JSON.stringify(ownersAdded[0]) === JSON.stringify(lastOwner), JSON.stringify(ownersAdded))
  check('O026 is Huda Al-Dosari, 0559123456, Al Rakah', JSON.stringify(lastOwner) === JSON.stringify({ 'OWNER ID': 'O026', 'FIRST NAME': 'Huda', SURNAME: 'Al-Dosari', MOBILE: '0559123456', AREA: 'Al Rakah' }), JSON.stringify(lastOwner))

  const changeText = sectionText(full, 'changes')
  const expected = [
    'CHANGES (compared with the starting database "palm-grove-start.accdb")',
    '  APPOINTMENTS: 1 record added: APPOINTMENT ID 61, PET ID 12, APPOINTMENT DATE 22-03-2027, REASON Dental, VET Dr Patel, COST 450, PAID No.',
    '  OWNERS: 1 record added: OWNER ID O026, FIRST NAME Huda, SURNAME Al-Dosari, MOBILE 0559123456, AREA Al Rakah.',
    '  OWNERS: sort set to [OWNERS].[SURNAME] (on)',
    '  Queries added: MICROCHIP REMINDER, UNPAID TREATMENTS',
    '  Forms added: APPOINTMENT FORM, PETS LIST FORM',
    '  Reports added: MICROCHIP REMINDER REPORT, UNPAID TREATMENTS REPORT',
    "  (Records are matched by each table's first field.)",
  ].join('\n')
  check('changes text is exactly the expected list', changeText === expected, `\n${changeText}`)
  check(
    'nothing else changed',
    changes.tablesAdded.length + changes.tablesRemoved.length + changes.fieldsAdded.length + changes.fieldsRemoved.length +
      changes.fieldChanges.length + changes.queriesRemoved.length + changes.queriesChanged.length + changes.formsRemoved.length +
      changes.reportsRemoved.length + changes.relationshipsAdded.length + changes.relationshipsRemoved.length + changes.relationshipsChanged.length === 0 &&
      changes.records.length === 2 &&
      changes.records.every((r) => r.removed.length === 0 && r.changed.length === 0 && r.added.length === 1 && !r.partial) &&
      changes.sortChanges.length === 1,
    JSON.stringify(changes),
  )
  check('a database against itself: no changes', sectionText(report(model, model), 'changes').endsWith('\n  No changes.'))

  // --- Section list
  const sections = describeDatabaseSections(full)
  check(
    'section selectors in order',
    JSON.stringify(sections.map((s) => s.selector)) === JSON.stringify([
      'tables', 'fields', 'relationships', 'lookups', 'table-sort',
      'records:APPOINTMENTS', 'records:OWNERS', 'records:PETS',
      'changes', 'queries', 'query:MICROCHIP REMINDER', 'query:UNPAID TREATMENTS', 'objects',
    ]),
    sections.map((s) => s.selector).join(', '),
  )
  check('every section text starts with its title', sections.every((s) => s.text.startsWith(s.title)))
  check('no markup in the text', !/\*\*|`|^\s*#|<\/?[a-z]+>/im.test(describeDatabase(full)))
  check('describeDatabase is every section', describeDatabase(full) === sections.map((s) => s.text).join('\n\n'))

  // --- Query blocks
  const microchip = sectionText(full, 'query:MICROCHIP REMINDER')
  for (const line of [
    'QUERY "MICROCHIP REMINDER" (select query)',
    '  Tables: PETS',
    '  Joins: none',
    '  Fields shown, in order: PETS.[PET ID], PETS.[PET NAME], PETS.[OWNER ID]',
    '  Used for criteria or sort but not shown: PETS.[DATE OF BIRTH], PETS.[SPECIES], PETS.[MICROCHIPPED]',
    '  Sort: PETS.[DATE OF BIRTH] ascending',
  ]) check(`MICROCHIP REMINDER: ${line.trim()}`, microchip.split('\n').includes(line), `\n${microchip}`)
  check('MICROCHIP REMINDER criteria keep #1/1/2020# with the date in words', microchip.includes('Criteria (as Access stores them; dates are month/day/year): (((PETS.[DATE OF BIRTH])<#1/1/2020# (1 January 2020))'), microchip)
  check('MICROCHIP REMINDER criteria: ="Dog" and =No', microchip.includes('=\"Dog\"') && microchip.includes('=No'))
  check('MICROCHIP REMINDER SQL line', microchip.includes('  SQL: SELECT PETS.[PET ID]'))

  const unpaid = sectionText(full, 'query:UNPAID TREATMENTS')
  check('UNPAID TREATMENTS: tables', unpaid.includes('  Tables: OWNERS, PETS, APPOINTMENTS'), unpaid)
  check('UNPAID TREATMENTS: two inner joins', unpaid.includes('    OWNERS inner join PETS on OWNERS.[OWNER ID] = PETS.[OWNER ID]') && unpaid.includes('    PETS inner join APPOINTMENTS on PETS.[PET ID] = APPOINTMENTS.[PET ID]'), unpaid)
  check('UNPAID TREATMENTS: seven fields in order', unpaid.includes('  Fields shown, in order: OWNERS.[FIRST NAME], OWNERS.SURNAME, OWNERS.MOBILE, PETS.[PET NAME], APPOINTMENTS.[APPOINTMENT DATE], APPOINTMENTS.REASON, APPOINTMENTS.COST'), unpaid)
  check('UNPAID TREATMENTS: dates in words', unpaid.includes('Between #2/1/2027# (1 February 2027) And #3/31/2027# (31 March 2027)'), unpaid)
  check('UNPAID TREATMENTS: PAID used but not shown', unpaid.includes('  Used for criteria or sort but not shown: APPOINTMENTS.[PAID]'))
  check('UNPAID TREATMENTS: Sort: COST descending', unpaid.includes('  Sort: APPOINTMENTS.COST descending'))
  check('UNPAID TREATMENTS: notes the SQL has no joins', unpaid.includes("leaves out the joins"))
  check('queries heading lists both', sectionText(full, 'queries') === 'SAVED QUERIES: 2 (MICROCHIP REMINDER, UNPAID TREATMENTS)')

  // --- Other sections
  const records = sectionText(full, 'records:APPOINTMENTS')
  check('records: dates DD-MM-YYYY', records.includes('APPOINTMENT ID 61, PET ID 12, APPOINTMENT DATE 22-03-2027, REASON Dental, VET Dr Patel, COST 450, PAID No'), records.split('\n').at(-1))
  check('records: no month-first or ISO dates', !/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(records))
  const owners = filterDatabaseSections(sections, ['records:OWNERS'])
  check('records:OWNERS lists 26 rows', owners.length === 1 && owners[0].text.split('\n').length === 27 && owners[0].title.startsWith('RECORDS IN OWNERS (26 records'), owners[0]?.title)
  check('table-sort: OWNERS sort on', sectionText(full, 'table-sort').includes('  OWNERS: [OWNERS].[SURNAME] (on)'))
  check('table-sort: APPOINTMENTS none', sectionText(full, 'table-sort').includes('  APPOINTMENTS: no saved sort'))
  check('lookups: REASON', sectionText(full, 'lookups').includes('  APPOINTMENTS.REASON: Combo Box, Value List "Check-up";"Vaccination";"Dental";"Surgery";"Grooming", limit to list yes, bound column 1, column count 1'), sectionText(full, 'lookups'))
  check('fields: MOBILE Text size 10', sectionText(full, 'fields').includes('    MOBILE: Text, size 10'))
  check('relationships: OWNERSPETS enforced', sectionText(full, 'relationships').includes('  OWNERSPETS: OWNERS.[OWNER ID] (primary table) to PETS.[OWNER ID] (related table); referential integrity enforced'), sectionText(full, 'relationships'))
  const objects = sectionText(full, 'objects')
  check('objects: forms with base tables', objects.includes('  Forms: APPOINTMENT FORM (based on APPOINTMENTS); PETS LIST FORM (based on PETS)'), objects)
  check('objects: reports listed, base not recorded', objects.includes('  Reports: MICROCHIP REMINDER REPORT (its record source is not recorded'), objects)
  check('objects: design is not in the file', objects.includes('judge those from screenshots'))

  // --- Filtering
  const defaults = filterDatabaseSections(sections, null)
  check('default selection: no records, every query', !defaults.some((s) => s.selector.startsWith('records:')) && defaults.filter((s) => s.selector.startsWith('query:')).length === 2 && defaults.some((s) => s.selector === 'queries'))
  const found = filterDatabaseSections(sections, ['query:microchip reminder'])
  check('query:microchip reminder found (case-insensitive)', found.length === 1 && found[0].selector === 'query:MICROCHIP REMINDER' && !found[0].absent)
  const nope = findDatabaseSection(sections, 'query:NOPE')
  check(
    'query:NOPE is absent, naming the queries that exist',
    nope.length === 1 && nope[0].absent?.kind === 'query' && nope[0].absent.name === 'NOPE' &&
      nope[0].text.includes('There is no saved query called NOPE in this database. Its saved queries are: MICROCHIP REMINDER, UNPAID TREATMENTS.'),
    JSON.stringify(nope),
  )
  const noTable = findDatabaseSection(sections, 'records:VETS')
  check('records:VETS is absent, naming the tables', noTable[0]?.absent?.kind === 'table' && noTable[0].text.includes('Its tables are: APPOINTMENTS, OWNERS, PETS.'), JSON.stringify(noTable))
  const mixed = filterDatabaseSections(sections, ['table-sort', 'records:owners', 'query:NOPE', 'query:nope'])
  check('mixed selection: in description order, absent last, never repeated', JSON.stringify(mixed.map((s) => s.selector)) === JSON.stringify(['table-sort', 'records:OWNERS', 'query:NOPE']), mixed.map((s) => s.selector).join(', '))
  check('records (every table)', filterDatabaseSections(sections, ['records']).length === 3)
  check('an unparsable selector selects nothing', findDatabaseSection(sections, 'slides').length === 0)
  const startQueries = findDatabaseSection(describeDatabaseSections(report(start, null)), 'query:MICROCHIP REMINDER')
  check('start file: a named query is absent, "It has no saved queries."', startQueries[0]?.text.includes('It has no saved queries.') === true, startQueries[0]?.text)

  // --- Doctored snapshots
  const flipped = clone(model)
  flipped.queries.find((q) => q.name === 'MICROCHIP REMINDER')!.orderBy[0].descending = true
  check('ORDER BY flipped: text says descending', sectionText(report(flipped, start), 'query:MICROCHIP REMINDER').includes('  Sort: PETS.[DATE OF BIRTH] descending'))

  const unsorted = clone(model)
  unsorted.tables.find((t) => t.name === 'OWNERS')!.sort = { orderBy: null, orderByOn: null }
  const unsortedReport = report(unsorted, start)
  check('OWNERS sort removed: table-sort says none', sectionText(unsortedReport, 'table-sort').includes('  OWNERS: no saved sort'))
  check('OWNERS sort removed: changes list no sort', !sectionText(unsortedReport, 'changes').includes('sort'), sectionText(unsortedReport, 'changes'))

  const sortedOff = clone(start)
  sortedOff.tables.find((t) => t.name === 'OWNERS')!.sort = { orderBy: '[OWNERS].[SURNAME]', orderByOn: true }
  check('sort removed against a sorted start', sectionText(report(unsorted, sortedOff), 'changes').includes('  OWNERS: sort removed (was [OWNERS].[SURNAME] (on))'))

  const recosted = clone(model)
  recosted.tables.find((t) => t.name === 'APPOINTMENTS')!.rows[0].COST = '500'
  const recostedChanges = sectionText(report(recosted, start), 'changes')
  check(
    'a record changed: APPOINTMENT ID 1 COST 490 → 500',
    recostedChanges.includes('  APPOINTMENTS: 1 record changed:\n    APPOINTMENT ID 1: COST 490 → 500'),
    recostedChanges,
  )

  // mdb-schema writes NOT NULL on every Yes/No field; that is not Required.
  const toBoolean = clone(model)
  Object.assign(toBoolean.tables.find((t) => t.name === 'OWNERS')!.fields.find((f) => f.name === 'AREA')!, { type: 'Boolean', size: null, notNull: true, required: null })
  const toBooleanText = sectionText(report(toBoolean, start), 'changes')
  check(
    'a field made Yes/No: type change listed, not "now required"',
    toBooleanText.includes('  OWNERS: field AREA type changed from Text to Boolean') && !toBooleanText.includes('required') &&
      !sectionText(report(toBoolean, start), 'fields').includes('AREA: Boolean; required'),
    toBooleanText,
  )

  const removedRow = clone(model)
  removedRow.tables.find((t) => t.name === 'PETS')!.rows.splice(1, 1)
  const removedText = sectionText(report(removedRow, start), 'changes')
  check('a record removed: PET ID 2', /  PETS: 1 record removed: PET ID 2, /.test(removedText), removedText)

  check(
    'no starting database: the note',
    sectionText(report(model, null), 'changes') === 'CHANGES\n  No starting database is set for this activity, so changes cannot be listed.',
  )
  check(
    'starting database unreadable: says so',
    sectionText({ snapshot: model, changes: null, startingDatabase: START }, 'changes').includes('could not be read, so changes cannot be listed.'),
  )

  const warned = clone(model)
  warned.warnings = ['MSysQueries could not be read.']
  check('warnings section only when there are warnings', sectionText(report(warned, start), 'warnings') === 'WARNINGS\n  MSysQueries could not be read.' && !sections.some((s) => s.selector === 'warnings'))

  const many = clone(model)
  const appts = many.tables.find((t) => t.name === 'APPOINTMENTS')!
  appts.rows = Array.from({ length: 250 }, (_, i) => ({ ...appts.rows[0], 'APPOINTMENT ID': String(i + 1) }))
  appts.rowCount = 250
  const manyTitle = describeDatabaseSections(report(many, null)).find((s) => s.selector === 'records:APPOINTMENTS')!
  check('records over 200: "200 of 250 shown"', manyTitle.title.includes('200 of 250 shown') && manyTitle.text.split('\n').length === 201, manyTitle.title)

  if (failed) {
    console.log(`${failed} check(s) failed`)
    process.exit(1)
  }
  console.log('all checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
