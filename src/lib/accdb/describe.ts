// The database reader's snapshot (and its changes from the starting
// database) in plain English, for an AI marker or a teacher. Facts only: it
// never says whether a mark is earned. Pure, so it can run anywhere.

import { describeLookup, isRequired, type DatabaseChanges, type DatabaseRow, type DatabaseSort } from "./diff"
import {
  databaseNameKey,
  DEFAULT_DATABASE_SECTIONS,
  formatDatabaseSection,
  parseDatabaseSection,
  type DatabaseSectionSelector,
} from "./section-selectors"
import type { DatabaseField, DatabaseFormOrReport, DatabaseQuery, DatabaseSnapshot } from "./types"

/** At most this many records are written per table (and per list of changed records). */
export const RECORDS_SHOWN_MAX = 200

export type DatabaseReport = {
  snapshot: DatabaseSnapshot
  // Null when there is no starting database, or it could not be read.
  changes: DatabaseChanges | null
  startingDatabase: { fileName: string } | null
}

// One section of the description. `selector` is the section's own selector
// ("tables", "records:OWNERS", "query:UNPAID TREATMENTS"); `text` starts with
// the title line. `absent` is set only on the block filterDatabaseSections
// writes for a named table or query the database does not have.
export type DatabaseSection = {
  selector: string
  title: string
  text: string
  absent?: { kind: "table" | "query"; name: string }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "<#1/1/2020#" -> "<#1/1/2020# (1 January 2020)": Access writes criteria dates month first. */
export function withDatesInWords(criteria: string): string {
  return criteria.replace(/#(\d{1,2})\/(\d{1,2})\/(\d{4})#/g, (match, m: string, d: string, y: string) => {
    const month = Number(m)
    const day = Number(d)
    if (month < 1 || month > 12 || day < 1 || day > 31) return match
    return `${match} (${day} ${MONTHS[month - 1]} ${y})`
  })
}

function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ka = databaseNameKey(a.name)
    const kb = databaseNameKey(b.name)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

function quote(text: string) {
  return `"${text}"`
}

function record(row: DatabaseRow): string {
  return Object.entries(row).map(([field, value]) => `${field} ${value === null || value === "" ? "(blank)" : value}`).join(", ")
}

function sort(s: DatabaseSort | null): string {
  if (!s) return "no saved sort"
  const on = s.orderByOn === null ? "on/off not stored" : s.orderByOn ? "on" : "off"
  return `${s.orderBy} (${on})`
}

function field(f: DatabaseField): string {
  const parts = [`${f.type}${f.size !== null ? `, size ${f.size}` : ""}`]
  if (isRequired(f)) parts.push("required")
  if (f.format !== null) parts.push(`format ${f.format}`)
  if (f.inputMask !== null) parts.push(`input mask ${f.inputMask}`)
  if (f.defaultValue !== null) parts.push(`default value ${f.defaultValue}`)
  if (f.validationRule !== null) parts.push(`validation rule ${f.validationRule}`)
  if (f.validationText !== null) parts.push(`validation text ${quote(f.validationText)}`)
  if (f.caption !== null) parts.push(`caption ${quote(f.caption)}`)
  if (f.lookup) parts.push("lookup (see LOOKUPS)")
  return `${f.name}: ${parts.join("; ")}`
}

function joinKind(kind: DatabaseQuery["joins"][number]["kind"]) {
  return kind === "unknown" ? "join of unknown type" : `${kind} join`
}

function queryLines(q: DatabaseQuery): string[] {
  const lines = [`QUERY ${quote(q.name)} (${q.type === "select" ? "select query" : "not a select query"})`]
  lines.push(`  Tables: ${q.tables.length ? q.tables.map((t) => (t.alias ? `${t.name} AS ${t.alias}` : t.name)).join(", ") : "none"}`)
  lines.push(q.joins.length ? "  Joins:" : "  Joins: none")
  for (const j of q.joins) lines.push(`    ${j.left} ${joinKind(j.kind)} ${j.right} on ${j.on}`)
  lines.push(`  Fields shown, in order: ${q.outputs.length ? q.outputs.map((o) => (o.alias ? `${o.expression} AS ${o.alias}` : o.expression)).join(", ") : "none"}`)
  lines.push(`  Used for criteria or sort but not shown: ${q.hiddenFields.length ? q.hiddenFields.join(", ") : "none"}`)
  lines.push(`  Criteria (as Access stores them; dates are month/day/year): ${q.where ? withDatesInWords(q.where) : "none"}`)
  if (q.groupBy.length) lines.push(`  Grouped by: ${q.groupBy.join(", ")}`)
  if (q.having) lines.push(`  Group criteria (HAVING): ${withDatesInWords(q.having)}`)
  lines.push(`  Sort: ${q.orderBy.length ? q.orderBy.map((o) => `${o.expression} ${o.descending ? "descending" : "ascending"}`).join(", ") : "none"}`)
  lines.push(`  SQL: ${q.sql ?? "not read"}`)
  if (q.joins.length && q.sql) lines.push("  (Access's SQL text here leaves out the joins; they are listed above.)")
  return lines
}

function objectList(items: DatabaseFormOrReport[]) {
  if (items.length === 0) return "none"
  return byName(items)
    .map((o) => `${o.name} (${o.baseTables ? `based on ${o.baseTables.join(", ")}` : "its record source is not recorded where DINO can read it"})`)
    .join("; ")
}

function recordsList(out: string[], indent: string, rows: DatabaseRow[]) {
  for (const row of rows.slice(0, RECORDS_SHOWN_MAX)) out.push(`${indent}${record(row)}`)
  if (rows.length > RECORDS_SHOWN_MAX) out.push(`${indent}(${RECORDS_SHOWN_MAX} of ${rows.length} shown)`)
}

function rowsChanged(out: string[], table: string, verb: string, rows: DatabaseRow[]) {
  if (rows.length === 0) return
  if (rows.length === 1) {
    out.push(`  ${table}: 1 record ${verb}: ${record(rows[0])}.`)
    return
  }
  out.push(`  ${table}: ${rows.length} records ${verb}:`)
  recordsList(out, "    ", rows)
}

function changeLines(report: DatabaseReport): string[] {
  const c = report.changes
  if (!c) {
    if (!report.startingDatabase) return ["  No starting database is set for this activity, so changes cannot be listed."]
    return [`  The starting database ${quote(report.startingDatabase.fileName)} could not be read, so changes cannot be listed.`]
  }
  const out: string[] = []
  const list = (label: string, names: string[]) => {
    if (names.length) out.push(`  ${label}: ${names.join(", ")}`)
  }
  list("Tables added", c.tablesAdded)
  list("Tables removed", c.tablesRemoved)
  for (const f of c.fieldsAdded) out.push(`  ${f.table}: field ${f.field} added (${f.type}${f.size !== null ? `, size ${f.size}` : ""})`)
  for (const f of c.fieldsRemoved) out.push(`  ${f.table}: field ${f.field} removed`)
  for (const f of c.fieldChanges) {
    if (f.what === "required") out.push(`  ${f.table}: field ${f.field} ${f.to === "Yes" ? "is now required" : "is no longer required"}`)
    else out.push(`  ${f.table}: field ${f.field} ${f.what} changed from ${f.from ?? "none"} to ${f.to ?? "none"}`)
  }
  for (const r of c.records) {
    if (r.keyField === null) {
      out.push(`  ${r.table}: records not compared, because the table no longer has the starting table's first field`)
      continue
    }
    rowsChanged(out, r.table, "added", r.added)
    rowsChanged(out, r.table, "removed", r.removed)
    if (r.changed.length) {
      out.push(`  ${r.table}: ${plural(r.changed.length, "record")} changed:`)
      for (const row of r.changed.slice(0, RECORDS_SHOWN_MAX)) {
        out.push(`    ${r.keyField} ${row.key ?? "(blank)"}: ${row.fields.map((f) => `${f.field} ${f.from ?? "(blank)"} → ${f.to ?? "(blank)"}`).join(", ")}`)
      }
      if (r.changed.length > RECORDS_SHOWN_MAX) out.push(`    (${RECORDS_SHOWN_MAX} of ${r.changed.length} shown)`)
    }
    if (r.partial) out.push(`  ${r.table}: only the records DINO reads were compared; the table holds more`)
  }
  for (const s of c.sortChanges) {
    if (!s.from) out.push(`  ${s.table}: sort set to ${sort(s.to)}`)
    else if (!s.to) out.push(`  ${s.table}: sort removed (was ${sort(s.from)})`)
    else out.push(`  ${s.table}: sort changed from ${sort(s.from)} to ${sort(s.to)}`)
  }
  list("Queries added", c.queriesAdded)
  list("Queries removed", c.queriesRemoved)
  list("Queries changed", c.queriesChanged)
  list("Forms added", c.formsAdded)
  list("Forms removed", c.formsRemoved)
  list("Reports added", c.reportsAdded)
  list("Reports removed", c.reportsRemoved)
  const enforced = (value: boolean | null) => (value === null ? "enforcement not known" : value ? "enforced" : "not enforced")
  for (const r of c.relationshipsAdded) out.push(`  Relationship added: ${r.join} (${enforced(r.enforced)})`)
  for (const r of c.relationshipsRemoved) out.push(`  Relationship removed: ${r.join}`)
  for (const r of c.relationshipsChanged) out.push(`  Relationship ${r.join}: referential integrity changed from ${enforced(r.from)} to ${enforced(r.to)}`)
  if (out.length === 0) out.push("  No changes.")
  else out.push("  (Records are matched by each table's first field.)")
  return out
}

/**
 * The description section by section. Selectors, in order: "tables",
 * "fields", "relationships", "lookups", "table-sort", "records:<TABLE>" per
 * table, "changes", "queries", "query:<NAME>" per query, "objects", and
 * "warnings" (only when there are any).
 */
export function describeDatabaseSections(report: DatabaseReport): DatabaseSection[] {
  const sections: { selector: string; title: string; lines: string[] }[] = []
  let out: string[] = []
  const start = (selector: string, title: string) => {
    out = [title]
    sections.push({ selector, title, lines: out })
  }
  const s = report.snapshot
  const tables = byName(s.tables)
  const queries = byName(s.queries)

  start("tables", `TABLES (Access database, ${s.version})`)
  for (const t of tables) out.push(`  ${t.name}: ${plural(t.fields.length, "field")}, ${plural(t.rowCount, "record")}`)
  if (tables.length === 0) out.push("  none")

  start("fields", "FIELDS (in design order)")
  for (const t of tables) {
    out.push(`  ${t.name}`)
    for (const f of t.fields) out.push(`    ${field(f)}`)
  }

  start("relationships", "RELATIONSHIPS (referential integrity as stored in the relationship's flags)")
  for (const r of byName(s.relationships)) {
    const side = (table: string, fields: string[]) => `${table}.${fields.map((f) => `[${f}]`).join(" + ")}`
    const ri = r.enforced === null ? "referential integrity not known" : r.enforced ? "referential integrity enforced" : "referential integrity NOT enforced"
    const cascade = (value: boolean | null) => (value === null ? "not known" : value ? "on" : "off")
    out.push(`  ${r.name}: ${side(r.referencedTable, r.referencedFields)} (primary table) to ${side(r.table, r.fields)} (related table); ${ri}; cascade update ${cascade(r.cascadeUpdate)}; cascade delete ${cascade(r.cascadeDelete)}`)
  }
  if (s.relationships.length === 0) out.push("  none")

  start("lookups", "LOOKUPS")
  let lookups = 0
  for (const t of tables) {
    for (const f of t.fields) {
      if (!f.lookup) continue
      lookups += 1
      out.push(`  ${t.name}.${f.name}: ${describeLookup(f.lookup)}`)
    }
  }
  if (lookups === 0) out.push("  none")

  start("table-sort", "TABLE SORT (each table's saved sort; ascending unless DESC is written)")
  for (const t of tables) {
    const saved = t.sort.orderBy ? sort({ orderBy: t.sort.orderBy, orderByOn: t.sort.orderByOn }) : "no saved sort"
    out.push(`  ${t.name}: ${saved}${t.filter ? `; saved filter ${t.filter}` : ""}`)
  }

  for (const t of tables) {
    const count = t.rowCount > RECORDS_SHOWN_MAX ? `${RECORDS_SHOWN_MAX} of ${t.rowCount} shown` : plural(t.rowCount, "record")
    start(`records:${t.name}`, `RECORDS IN ${t.name} (${count}, in the order stored in the file; dates are day-month-year)`)
    for (const row of t.rows.slice(0, RECORDS_SHOWN_MAX)) out.push(`  ${record(row)}`)
    if (t.rows.length === 0) out.push("  none")
  }

  start("changes", report.startingDatabase ? `CHANGES (compared with the starting database ${quote(report.startingDatabase.fileName)})` : "CHANGES")
  out.push(...changeLines(report))

  start("queries", `SAVED QUERIES: ${queries.length ? `${queries.length} (${queries.map((q) => q.name).join(", ")})` : "none"}`)
  for (const q of queries) {
    const [title, ...lines] = queryLines(q)
    start(`query:${q.name}`, title)
    out.push(...lines)
  }

  start("objects", "FORMS AND REPORTS")
  out.push(`  Forms: ${objectList(s.forms)}`)
  out.push(`  Reports: ${objectList(s.reports)}`)
  out.push("  The database file does not record form or report design (fonts, sizes, borders, positions, colours); judge those from screenshots.")

  if (s.warnings.length) {
    start("warnings", "WARNINGS")
    for (const w of s.warnings) out.push(`  ${w}`)
  }
  return sections.map((section) => ({ selector: section.selector, title: section.title, text: section.lines.join("\n") }))
}

/** The whole description, every section joined by a blank line: for the teacher and MCP. */
export function describeDatabase(report: DatabaseReport): string {
  return describeDatabaseSections(report).map((section) => section.text).join("\n\n")
}

function sectionName(section: DatabaseSection, key: "records" | "query"): string | null {
  return section.selector.startsWith(`${key}:`) ? section.selector.slice(key.length + 1) : null
}

function selects(selector: DatabaseSectionSelector, section: DatabaseSection): boolean {
  if (selector.key === "records" || selector.key === "query") {
    const name = sectionName(section, selector.key)
    if (name === null) return false
    return selector.name === null || databaseNameKey(name) === databaseNameKey(selector.name)
  }
  if (selector.key === "queries") return section.selector === "queries" || sectionName(section, "query") !== null
  return section.selector === selector.key
}

function absentBlock(sections: DatabaseSection[], selector: DatabaseSectionSelector): DatabaseSection {
  const name = selector.name ?? ""
  const kind = selector.key === "query" ? "query" : "table"
  const existing = sections.map((s) => sectionName(s, kind === "query" ? "query" : "records")).filter((n): n is string => n !== null)
  const title = kind === "query" ? `QUERY ${quote(name)}: not in this database` : `RECORDS IN ${name}: no such table`
  const text = kind === "query"
    ? `There is no saved query called ${name} in this database. ${existing.length ? `Its saved queries are: ${existing.join(", ")}.` : "It has no saved queries."}`
    : `There is no table called ${name} in this database. ${existing.length ? `Its tables are: ${existing.join(", ")}.` : "It has no tables."}`
  return { selector: formatDatabaseSection(selector), title, text: `${title}\n  ${text}`, absent: { kind, name } }
}

/**
 * The sections the selectors name, in description order (never repeated),
 * then a block of its own for each named table or query the database does
 * not have (marked `absent`). No selectors means DEFAULT_DATABASE_SECTIONS.
 * Selectors that do not parse select nothing.
 */
export function filterDatabaseSections(
  sections: DatabaseSection[],
  selectors?: readonly string[] | null,
): DatabaseSection[] {
  const chosen = (selectors && selectors.length > 0 ? selectors : DEFAULT_DATABASE_SECTIONS)
    .map((text) => parseDatabaseSection(text))
    .filter((selector): selector is DatabaseSectionSelector => selector !== null)
  const found = sections.filter((section) => chosen.some((selector) => selects(selector, section)))
  const missing = new Map<string, DatabaseSection>()
  for (const selector of chosen) {
    if (selector.name === null || sections.some((section) => selects(selector, section))) continue
    const key = `${selector.key}:${databaseNameKey(selector.name)}`
    if (!missing.has(key)) missing.set(key, absentBlock(sections, selector))
  }
  return [...found, ...missing.values()]
}

/**
 * One selector's sections. A named table or query the database does not
 * have gives the single `absent` block; a selector that does not parse gives
 * nothing.
 */
export function findDatabaseSection(sections: DatabaseSection[], selector: string): DatabaseSection[] {
  if (!parseDatabaseSection(selector)) return []
  return filterDatabaseSections(sections, [selector])
}
