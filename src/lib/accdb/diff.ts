// What a pupil changed in the database they were given: the starting
// database diffed against the one they handed in. Pure; facts only.
//
// Tables, fields, queries, forms and reports are matched by name the way
// Access compares names (databaseNameKey: case and spacing ignored).
// Relationships are matched by what they join (tables and fields), not by
// their name, which Access makes up.
//
// Records are paired by the starting table's FIRST field (in these databases
// the ID). A pupil row whose first-field value is not in the start is
// "added"; a start row whose value is gone is "removed"; a row in both whose
// other values differ is "changed", listing each field from -> to; a row in
// both and identical is unchanged. Repeated first-field values pair in the
// order they appear. Only fields in both tables are compared (a field added
// or removed is reported as such). When the pupil's table no longer has that
// first field, its records are not compared.

import { databaseNameKey } from "./section-selectors"
import type { DatabaseField, DatabaseLookup, DatabaseRelationship, DatabaseSnapshot, DatabaseTable } from "./types"

export type DatabaseRow = Record<string, string | null>

export type DatabaseSort = { orderBy: string; orderByOn: boolean | null }

export type DatabaseFieldChange = {
  table: string
  field: string
  what: "type" | "size" | "required" | "lookup"
  from: string | null
  to: string | null
}

export type DatabaseRecordChanges = {
  table: string
  // The field records were paired by, or null when they could not be compared.
  keyField: string | null
  added: DatabaseRow[]
  removed: DatabaseRow[]
  changed: Array<{ key: string | null; fields: Array<{ field: string; from: string | null; to: string | null }> }>
  // Either file held more records than the reader keeps, so only those were compared.
  partial: boolean
}

export type DatabaseRelationshipChange = {
  join: string
  from: boolean | null
  to: boolean | null
}

export type DatabaseChanges = {
  tablesAdded: string[]
  tablesRemoved: string[]
  fieldsAdded: Array<{ table: string; field: string; type: string; size: number | null }>
  fieldsRemoved: Array<{ table: string; field: string }>
  fieldChanges: DatabaseFieldChange[]
  sortChanges: Array<{ table: string; from: DatabaseSort | null; to: DatabaseSort | null }>
  // Tables in both files with at least one record added, removed or changed.
  records: DatabaseRecordChanges[]
  queriesAdded: string[]
  queriesRemoved: string[]
  queriesChanged: string[]
  formsAdded: string[]
  formsRemoved: string[]
  reportsAdded: string[]
  reportsRemoved: string[]
  // "OWNERS.[OWNER ID] to PETS.[OWNER ID]", with whether it is enforced.
  relationshipsAdded: Array<{ join: string; enforced: boolean | null }>
  relationshipsRemoved: Array<{ join: string; enforced: boolean | null }>
  relationshipsChanged: DatabaseRelationshipChange[]
}

function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ka = databaseNameKey(a.name)
    const kb = databaseNameKey(b.name)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

function index<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [databaseNameKey(item.name), item]))
}

function namesOnlyIn<T extends { name: string }>(these: readonly T[], others: readonly T[]): string[] {
  const other = index(others)
  return byName(these).filter((item) => !other.has(databaseNameKey(item.name))).map((item) => item.name)
}

export function describeLookup(lookup: DatabaseLookup | null): string | null {
  if (!lookup) return null
  const parts = [lookup.displayControl ?? "display control not set"]
  parts.push(`${lookup.rowSourceType ?? "row source type not set"}${lookup.rowSource !== null ? ` ${lookup.rowSource}` : ""}`)
  if (lookup.limitToList !== null) parts.push(`limit to list ${lookup.limitToList ? "yes" : "no"}`)
  if (lookup.boundColumn !== null) parts.push(`bound column ${lookup.boundColumn}`)
  if (lookup.columnCount !== null) parts.push(`column count ${lookup.columnCount}`)
  return parts.join(", ")
}

/**
 * The field's Required property. When Access stored none, mdb-schema's NOT
 * NULL stands in for it, except on Yes/No fields, which mdb-schema always
 * writes NOT NULL (Access booleans are never null) whatever Required says.
 */
export function isRequired(field: DatabaseField): boolean {
  return field.required ?? (field.notNull && field.type !== "Boolean")
}

function fieldChanges(table: string, start: DatabaseField, pupil: DatabaseField): DatabaseFieldChange[] {
  const changes: DatabaseFieldChange[] = []
  const base = { table, field: pupil.name }
  if (start.type !== pupil.type) changes.push({ ...base, what: "type", from: start.type, to: pupil.type })
  if (start.size !== pupil.size) {
    changes.push({ ...base, what: "size", from: start.size === null ? null : String(start.size), to: pupil.size === null ? null : String(pupil.size) })
  }
  if (isRequired(start) !== isRequired(pupil)) {
    changes.push({ ...base, what: "required", from: isRequired(start) ? "Yes" : "No", to: isRequired(pupil) ? "Yes" : "No" })
  }
  const lookupFrom = describeLookup(start.lookup)
  const lookupTo = describeLookup(pupil.lookup)
  if (lookupFrom !== lookupTo) changes.push({ ...base, what: "lookup", from: lookupFrom, to: lookupTo })
  return changes
}

function sortOf(table: DatabaseTable): DatabaseSort | null {
  return table.sort.orderBy ? { orderBy: table.sort.orderBy, orderByOn: table.sort.orderByOn } : null
}

function sameSort(a: DatabaseSort | null, b: DatabaseSort | null): boolean {
  if (!a || !b) return a === b
  return a.orderBy === b.orderBy && a.orderByOn === b.orderByOn
}

function recordChanges(start: DatabaseTable, pupil: DatabaseTable): DatabaseRecordChanges {
  const partial = start.rowsTruncated || pupil.rowsTruncated
  const keyField = start.fields[0]?.name ?? null
  const pupilFields = index(pupil.fields)
  const pupilKeyField = keyField === null ? undefined : pupilFields.get(databaseNameKey(keyField))
  if (keyField === null || !pupilKeyField) {
    return { table: pupil.name, keyField: null, added: [], removed: [], changed: [], partial }
  }
  // Fields in both tables, as [start name, pupil name], in the pupil's order.
  const startFields = index(start.fields)
  const shared = pupil.fields
    .map((f) => [startFields.get(databaseNameKey(f.name))?.name, f.name] as const)
    .filter((pair): pair is readonly [string, string] => pair[0] !== undefined)

  const unmatched = new Map<string, DatabaseRow[]>()
  for (const row of start.rows) {
    const key = JSON.stringify(row[keyField] ?? null)
    unmatched.set(key, [...(unmatched.get(key) ?? []), row])
  }
  const added: DatabaseRow[] = []
  const changed: DatabaseRecordChanges["changed"] = []
  for (const row of pupil.rows) {
    const key = JSON.stringify(row[pupilKeyField.name] ?? null)
    const candidates = unmatched.get(key)
    const before = candidates?.shift()
    if (!before) {
      added.push(row)
      continue
    }
    const fields = shared
      .filter(([startName, pupilName]) => (before[startName] ?? null) !== (row[pupilName] ?? null))
      .map(([startName, pupilName]) => ({ field: pupilName, from: before[startName] ?? null, to: row[pupilName] ?? null }))
    if (fields.length) changed.push({ key: row[pupilKeyField.name] ?? null, fields })
  }
  const removed = start.rows.filter((row) => unmatched.get(JSON.stringify(row[keyField] ?? null))?.includes(row))
  return { table: pupil.name, keyField: pupilKeyField.name, added, removed, changed, partial }
}

function normaliseSql(sql: string | null): string {
  return (sql ?? "").replace(/\s+/g, " ").trim()
}

function relationshipJoin(r: DatabaseRelationship): string {
  const side = (table: string, fields: string[]) => `${table}.${fields.map((f) => `[${f}]`).join(" + ")}`
  return `${side(r.referencedTable, r.referencedFields)} to ${side(r.table, r.fields)}`
}

/** Everything that differs from the starting database to the pupil's. */
export function diffDatabases(start: DatabaseSnapshot, pupil: DatabaseSnapshot): DatabaseChanges {
  const startTables = index(start.tables)
  const changes: DatabaseChanges = {
    tablesAdded: namesOnlyIn(pupil.tables, start.tables),
    tablesRemoved: namesOnlyIn(start.tables, pupil.tables),
    fieldsAdded: [],
    fieldsRemoved: [],
    fieldChanges: [],
    sortChanges: [],
    records: [],
    queriesAdded: namesOnlyIn(pupil.queries, start.queries),
    queriesRemoved: namesOnlyIn(start.queries, pupil.queries),
    queriesChanged: [],
    formsAdded: namesOnlyIn(pupil.forms, start.forms),
    formsRemoved: namesOnlyIn(start.forms, pupil.forms),
    reportsAdded: namesOnlyIn(pupil.reports, start.reports),
    reportsRemoved: namesOnlyIn(start.reports, pupil.reports),
    relationshipsAdded: [],
    relationshipsRemoved: [],
    relationshipsChanged: [],
  }

  for (const table of byName(pupil.tables)) {
    const before = startTables.get(databaseNameKey(table.name))
    if (!before) continue
    const beforeFields = index(before.fields)
    const afterFields = index(table.fields)
    for (const f of table.fields) {
      const old = beforeFields.get(databaseNameKey(f.name))
      if (!old) changes.fieldsAdded.push({ table: table.name, field: f.name, type: f.type, size: f.size })
      else changes.fieldChanges.push(...fieldChanges(table.name, old, f))
    }
    for (const f of before.fields) {
      if (!afterFields.has(databaseNameKey(f.name))) changes.fieldsRemoved.push({ table: table.name, field: f.name })
    }
    const from = sortOf(before)
    const to = sortOf(table)
    if (!sameSort(from, to)) changes.sortChanges.push({ table: table.name, from, to })
    const records = recordChanges(before, table)
    if (records.keyField === null || records.added.length || records.removed.length || records.changed.length) {
      changes.records.push(records)
    }
  }

  const startQueries = index(start.queries)
  for (const query of byName(pupil.queries)) {
    const before = startQueries.get(databaseNameKey(query.name))
    if (!before) continue
    // mdb-queries' SQL leaves out the joins, so they are compared as well.
    const differs = normaliseSql(before.sql) !== normaliseSql(query.sql) || JSON.stringify(before.joins) !== JSON.stringify(query.joins)
    if (differs) changes.queriesChanged.push(query.name)
  }

  const joinKey = (r: DatabaseRelationship) => databaseNameKey(relationshipJoin(r))
  const startRelationships = new Map(start.relationships.map((r) => [joinKey(r), r]))
  const pupilRelationships = new Map(pupil.relationships.map((r) => [joinKey(r), r]))
  for (const [key, r] of pupilRelationships) {
    const before = startRelationships.get(key)
    if (!before) changes.relationshipsAdded.push({ join: relationshipJoin(r), enforced: r.enforced })
    else if (before.enforced !== r.enforced) changes.relationshipsChanged.push({ join: relationshipJoin(r), from: before.enforced, to: r.enforced })
  }
  for (const [key, r] of startRelationships) {
    if (!pupilRelationships.has(key)) changes.relationshipsRemoved.push({ join: relationshipJoin(r), enforced: r.enforced })
  }
  return changes
}
