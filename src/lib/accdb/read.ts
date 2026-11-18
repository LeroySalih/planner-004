import { DATABASE_MESSAGES, UnreadableDatabaseError } from "@/lib/accdb/errors"
import { type MdbTool, readBudget, runMdb, withTempDatabase } from "@/lib/accdb/mdbtools"
import type {
  DatabaseField,
  DatabaseFormOrReport,
  DatabaseLookup,
  DatabaseQuery,
  DatabaseRelationship,
  DatabaseSnapshot,
  DatabaseTable,
} from "@/lib/accdb/types"

// A pupil's Access database (.accdb) read into a DatabaseSnapshot with
// mdbtools: tables, fields, lookups, sort, records, relationships, saved
// query designs, and forms and reports with their base tables where those can
// be read. Form and report design is not decoded. The file is checked by its
// header before any process runs.

export const MAX_ROWS_PER_TABLE = 1000

// mdb-json's formats: dates DD-MM-YYYY; a midnight time is removed after.
const DATE_FORMAT = "%d-%m-%Y"
const DATETIME_FORMAT = "%d-%m-%Y %H:%M:%S"

// MSysObjects.Type values.
const OBJECT_TYPE_QUERY = 5
const OBJECT_TYPE_FORM = -32768
const OBJECT_TYPE_REPORT = -32764

// MSysQueries.Attribute values.
const QUERY_ATTR_TYPE = 1
const QUERY_ATTR_TABLE = 5
const QUERY_ATTR_OUTPUT = 6
const QUERY_ATTR_JOIN = 7
const QUERY_ATTR_WHERE = 8
const QUERY_ATTR_GROUP_BY = 9
const QUERY_ATTR_HAVING = 10
const QUERY_ATTR_ORDER_BY = 11

const DISPLAY_CONTROLS: Record<string, string> = {
  "106": "Check Box",
  "109": "Text Box",
  "110": "List Box",
  "111": "Combo Box",
}

/**
 * Refuses a file that is not an Access 2007+ database by its header, before
 * any process runs: bytes 4..18 read "Standard ACE DB" in an .accdb and
 * "Standard Jet DB" in an older .mdb.
 */
export function sniffAccessHeader(bytes: Buffer): void {
  const signature = bytes.length >= 19 ? bytes.subarray(4, 19).toString("latin1") : ""
  if (signature === "Standard ACE DB") return
  if (signature === "Standard Jet DB") throw new UnreadableDatabaseError(DATABASE_MESSAGES.mdb)
  throw new UnreadableDatabaseError(DATABASE_MESSAGES.notAccess)
}

/**
 * Reads the database. Throws UnreadableDatabaseError (the pupil's message)
 * when the file is not an .accdb or mdbtools cannot list its tables or schema,
 * and a plain Error when mdbtools could not run or took too long. Anything
 * else that cannot be read becomes a warning and those parts are left empty.
 */
export async function readAccessDatabase(
  bytes: Buffer,
  options: { maxRowsPerTable?: number } = {},
): Promise<DatabaseSnapshot> {
  sniffAccessHeader(bytes)
  const maxRows = options.maxRowsPerTable ?? MAX_ROWS_PER_TABLE
  const timeout = readBudget()
  const warnings: string[] = []

  return withTempDatabase(bytes, async (file) => {
    const run = (tool: MdbTool, args: string[]) => runMdb(tool, args, { timeoutMs: timeout() })
    // A part of the file that cannot be read is a warning; the reader failing
    // to run is still thrown.
    const soft = async (tool: MdbTool, args: string[], warning: string): Promise<string | null> => {
      try {
        return await run(tool, args)
      } catch (error) {
        if (!(error instanceof UnreadableDatabaseError)) throw error
        warnings.push(warning)
        return null
      }
    }

    const version = (await run("mdb-ver", ["--", file])).trim()
    const tableNames = lines(await run("mdb-tables", ["-1", "--", file]))
    const schema = parseSchema(
      await run("mdb-schema", ["--no-relations", "--no-indexes", "--no-default-values", "--", file]),
    )

    const tables: DatabaseTable[] = []
    for (const name of tableNames) {
      const columns = schema.get(name)
      if (!columns) {
        warnings.push(`The design of table ${name} could not be read.`)
        continue
      }
      const props = parseProps((await soft("mdb-prop", ["--", file, name], `The properties of table ${name} could not be read.`)) ?? "")
      const json = await soft(
        "mdb-json",
        ["-D", DATE_FORMAT, "-T", DATETIME_FORMAT, "--", file, name],
        `The records of table ${name} could not be read.`,
      )
      tables.push(buildTable(name, columns, props, json ?? "", maxRows, warnings))
    }

    const objects = parseJsonLines(
      await soft("mdb-json", ["--", file, "MSysObjects"], "The database's list of objects could not be read; queries, forms and reports are not reported."),
      "MSysObjects",
      warnings,
    ).map((row) => ({ id: row.Id, name: typeof row.Name === "string" ? row.Name : "", type: row.Type }))

    const queryRows = objects.some((object) => object.type === OBJECT_TYPE_QUERY)
      ? parseJsonLines(
          await soft("mdb-json", ["--", file, "MSysQueries"], "The query designs could not be read."),
          "MSysQueries",
          warnings,
        )
      : []
    const queryRowsByObject = new Map<unknown, JsonRow[]>()
    for (const row of queryRows) {
      const list = queryRowsByObject.get(row.ObjectId) ?? []
      list.push(row)
      queryRowsByObject.set(row.ObjectId, list)
    }

    const queries: DatabaseQuery[] = []
    for (const object of byName(objects.filter((o) => o.type === OBJECT_TYPE_QUERY && o.name && !o.name.startsWith("~")))) {
      const sqlText = await soft("mdb-queries", ["--", file, object.name], `The SQL of query ${object.name} could not be read.`)
      queries.push(buildQuery(object.name, queryRowsByObject.get(object.id) ?? [], sqlText))
    }

    // A form's or report's record source is saved as a hidden query named
    // ~sq_f<form> / ~sq_r<report>; its tables are the object's base tables.
    const baseTables = (prefix: string, name: string): string[] | null => {
      const hidden = objects.find((o) => o.type === OBJECT_TYPE_QUERY && o.name === `${prefix}${name}`)
      if (!hidden) return null
      return (queryRowsByObject.get(hidden.id) ?? [])
        .filter((row) => row.Attribute === QUERY_ATTR_TABLE && typeof row.Name1 === "string")
        .map((row) => row.Name1 as string)
    }
    const formsAndReports = (type: number, prefix: string): DatabaseFormOrReport[] =>
      byName(objects.filter((o) => o.type === type && o.name)).map((o) => ({ name: o.name, baseTables: baseTables(prefix, o.name) }))

    const relationships = buildRelationships(
      parseJsonLines(
        await soft("mdb-json", ["--", file, "MSysRelationships"], "The relationships could not be read."),
        "MSysRelationships",
        warnings,
      ),
    )

    return {
      version,
      tables,
      relationships,
      queries,
      forms: formsAndReports(OBJECT_TYPE_FORM, "~sq_f"),
      reports: formsAndReports(OBJECT_TYPE_REPORT, "~sq_r"),
      warnings,
    }
  })
}

type JsonRow = Record<string, unknown>
type SchemaColumn = { name: string; type: string; size: number | null; notNull: boolean }

function lines(text: string): string[] {
  return text.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.length > 0)
}

function byName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

/** mdb-json's output, one object per line; a line that does not parse is counted as a warning. */
function parseJsonLines(text: string | null, source: string, warnings: string[]): JsonRow[] {
  const rows: JsonRow[] = []
  let bad = 0
  for (const line of lines(text ?? "")) {
    try {
      const row = JSON.parse(line) as JsonRow
      // Binary columns are never used; drop them straight away.
      delete row.LvProp
      delete row.Lv
      delete row.Owner
      delete row.LvExtra
      rows.push(row)
    } catch {
      bad += 1
    }
  }
  if (bad > 0) warnings.push(`${bad} ${bad === 1 ? "row" : "rows"} of ${source} could not be read.`)
  return rows
}

/** mdb-schema's CREATE TABLE blocks: each field's name, type, Text size and NOT NULL. */
function parseSchema(text: string): Map<string, SchemaColumn[]> {
  const tables = new Map<string, SchemaColumn[]>()
  let current: SchemaColumn[] | null = null
  for (const line of lines(text)) {
    const create = line.match(/^CREATE TABLE \[(.+)\]\s*$/)
    if (create) {
      current = []
      tables.set(create[1], current)
      continue
    }
    if (!current) continue
    if (/^\s*\);\s*$/.test(line)) {
      current = null
      continue
    }
    const field = line.match(/^\s*\[(.+?)\]\s+(.*?)\s*,?\s*$/)
    if (!field) continue
    const notNull = /\bNOT NULL\b/.test(field[2])
    const typeText = field[2].replace(/\s+NOT NULL\b.*$/, "").replace(/\s+DEFAULT\b.*$/, "").trim()
    const sized = typeText.match(/^(.*?)\s*\((\d+)\)$/)
    const isText = sized?.[1] === "Text"
    current.push({
      name: field[1],
      type: isText ? "Text" : typeText,
      size: isText ? Number.parseInt(sized![2], 10) : null,
      notNull,
    })
  }
  return tables
}

/** mdb-prop's blocks: "name: X" then tab-indented "Key: value" lines. "(none)" is the object itself. */
function parseProps(text: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>()
  let current: Record<string, string> | null = null
  for (const line of lines(text)) {
    const name = line.match(/^name: (.*)$/)
    if (name) {
      current = blocks.get(name[1]) ?? {}
      blocks.set(name[1], current)
      continue
    }
    const prop = line.match(/^\t([^:]+): ?(.*)$/)
    if (prop && current) current[prop[1]] = prop[2]
  }
  return blocks
}

function yesNo(value: string | undefined): boolean | null {
  if (value === undefined) return null
  const lower = value.trim().toLowerCase()
  if (lower === "yes" || lower === "true" || lower === "1" || lower === "-1") return true
  if (lower === "no" || lower === "false" || lower === "0") return false
  return null
}

function integer(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

function text(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value
}

function buildLookup(props: Record<string, string>): DatabaseLookup | null {
  const control = props.DisplayControl
  const listControl = control === "110" || control === "111"
  if (props.RowSourceType === undefined && props.RowSource === undefined && !listControl) return null
  return {
    rowSourceType: text(props.RowSourceType),
    rowSource: text(props.RowSource),
    limitToList: yesNo(props.LimitToList),
    boundColumn: integer(props.BoundColumn),
    columnCount: integer(props.ColumnCount),
    displayControl: control === undefined ? null : (DISPLAY_CONTROLS[control] ?? control),
  }
}

/** One record value as text: dates without a midnight time, Yes/No, numbers without trailing zeros. */
function cellText(value: unknown, type: string | undefined): string | null {
  if (value === null || value === undefined) return null
  if (type === "Boolean") {
    if (value === 1 || value === -1 || value === true || value === "1") return "Yes"
    if (value === 0 || value === false || value === "0") return "No"
  }
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return type === "DateTime" ? value.replace(/ 00:00:00$/, "") : value
  return String(value)
}

function buildTable(
  name: string,
  columns: SchemaColumn[],
  props: Map<string, Record<string, string>>,
  json: string,
  maxRows: number,
  warnings: string[],
): DatabaseTable {
  const fields: DatabaseField[] = columns.map((column) => {
    const own = props.get(column.name) ?? {}
    return {
      name: column.name,
      type: column.type,
      size: column.size,
      required: yesNo(own.Required),
      notNull: column.notNull,
      validationRule: text(own.ValidationRule),
      validationText: text(own.ValidationText),
      defaultValue: text(own.DefaultValue),
      inputMask: text(own.InputMask),
      format: text(own.Format),
      caption: text(own.Caption),
      lookup: buildLookup(own),
    }
  })
  const types = new Map(columns.map((column) => [column.name, column.type]))

  const rows: Array<Record<string, string | null>> = []
  let rowCount = 0
  let bad = 0
  for (const line of lines(json)) {
    rowCount += 1
    let parsed: JsonRow
    try {
      parsed = JSON.parse(line) as JsonRow
    } catch {
      bad += 1
      continue
    }
    if (rows.length >= maxRows) continue
    // mdb-json leaves out empty fields; every field is given, in field order.
    // No prototype: a field the pupil named __proto__ is kept like any other.
    const row: Record<string, string | null> = Object.create(null)
    for (const column of columns) row[column.name] = cellText(parsed[column.name], column.type)
    for (const [key, value] of Object.entries(parsed)) {
      if (!Object.hasOwn(row, key)) row[key] = cellText(value, types.get(key))
    }
    rows.push(row)
  }
  if (bad > 0) warnings.push(`${bad} ${bad === 1 ? "record" : "records"} of table ${name} could not be read.`)

  const table = props.get("(none)") ?? {}
  return {
    name,
    fields,
    sort: { orderBy: text(table.OrderBy), orderByOn: yesNo(table.OrderByOn) },
    filter: text(table.Filter),
    rowCount,
    rows,
    rowsTruncated: rowCount - bad > rows.length,
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

const JOIN_KINDS: Record<number, "inner" | "left" | "right"> = { 1: "inner", 2: "left", 3: "right" }

function buildQuery(name: string, rows: JsonRow[], sqlText: string | null): DatabaseQuery {
  const at = (attribute: number) => rows.filter((row) => row.Attribute === attribute)
  const typeRow = at(QUERY_ATTR_TYPE)[0]
  const outputs = at(QUERY_ATTR_OUTPUT)
    .filter((row) => str(row.Expression))
    .map((row) => ({ expression: row.Expression as string, alias: str(row.Name1) }))
  const where = str(at(QUERY_ATTR_WHERE)[0]?.Expression)
  const orderBy = at(QUERY_ATTR_ORDER_BY)
    .filter((row) => str(row.Expression))
    .map((row) => ({ expression: row.Expression as string, descending: row.Name1 === "D" }))
  const sql = sqlText?.trim() ?? ""

  return {
    name,
    type: typeRow?.Flag === 1 ? "select" : "other",
    // mdb-queries prints a message, and exits 0, for a query it cannot find.
    sql: sql === "" || sql.startsWith("Couldn't locate") ? null : sql,
    tables: at(QUERY_ATTR_TABLE)
      .filter((row) => str(row.Name1))
      .map((row) => ({ name: row.Name1 as string, alias: str(row.Name2) })),
    joins: at(QUERY_ATTR_JOIN).map((row) => ({
      left: str(row.Name1) ?? "",
      right: str(row.Name2) ?? "",
      on: str(row.Expression) ?? "",
      kind: (typeof row.Flag === "number" ? JOIN_KINDS[row.Flag] : undefined) ?? "unknown",
    })),
    outputs,
    hiddenFields: hiddenFields(outputs.map((o) => o.expression), [where ?? "", ...orderBy.map((o) => o.expression)]),
    where,
    groupBy: at(QUERY_ATTR_GROUP_BY).map((row) => str(row.Expression)).filter((e): e is string => e !== null),
    having: str(at(QUERY_ATTR_HAVING)[0]?.Expression),
    orderBy,
  }
}

type FieldRef = { table: string; field: string; key: string }

/**
 * The Table.Field references in an expression, normalised to Table.[Field]
 * (Access writes PETS.SPECIES and PETS.[DATE OF BIRTH] alike). Text in
 * quotes and #dates# are skipped first.
 */
function fieldRefs(expression: string): FieldRef[] {
  const bare = expression.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/#[^#]*#/g, "##")
  const refs: FieldRef[] = []
  // Unbracketed names may be in any script (Arabic as well as English).
  const pattern = /(?:\[([^\]]+)\]|([\p{L}_][\p{L}\p{N}_]*))\.(?:\[([^\]]+)\]|([\p{L}_][\p{L}\p{N}_]*|\*))/gu
  for (const match of bare.matchAll(pattern)) {
    const table = match[1] ?? match[2]
    const field = match[3] ?? match[4]
    refs.push({ table, field, key: `${table}.${field}`.toUpperCase() })
  }
  return refs
}

/** Fields named in WHERE or ORDER BY that no output shows, as Table.[Field], in order. */
function hiddenFields(outputs: string[], used: string[]): string[] {
  const shown = new Set<string>()
  const allOf = new Set<string>()
  for (const ref of outputs.flatMap(fieldRefs)) {
    if (ref.field === "*") allOf.add(ref.table.toUpperCase())
    else shown.add(ref.key)
  }
  const hidden: string[] = []
  const seen = new Set<string>()
  for (const ref of used.flatMap(fieldRefs)) {
    if (ref.field === "*" || shown.has(ref.key) || allOf.has(ref.table.toUpperCase()) || seen.has(ref.key)) continue
    seen.add(ref.key)
    hidden.push(`${ref.table}.[${ref.field}]`)
  }
  return hidden
}

// grbit is DAO's RelationAttributeEnum: dbRelationDontEnforce = 2,
// dbRelationUpdateCascade = 256, dbRelationDeleteCascade = 4096.
const RELATION_DONT_ENFORCE = 2
const RELATION_UPDATE_CASCADE = 256
const RELATION_DELETE_CASCADE = 4096

function buildRelationships(rows: JsonRow[]): DatabaseRelationship[] {
  const groups = new Map<string, JsonRow[]>()
  for (const row of rows) {
    const name = str(row.szRelationship)
    if (!name) continue
    const list = groups.get(name) ?? []
    list.push(row)
    groups.set(name, list)
  }
  const relationships: DatabaseRelationship[] = []
  for (const [name, group] of groups) {
    const columns = [...group].sort((a, b) => Number(a.icolumn ?? 0) - Number(b.icolumn ?? 0))
    const first = columns[0]
    const table = str(first.szObject) ?? ""
    const referencedTable = str(first.szReferencedObject) ?? ""
    if (table.startsWith("MSys") || referencedTable.startsWith("MSys")) continue
    const grbit = typeof first.grbit === "number" ? first.grbit : null
    relationships.push({
      name,
      table,
      fields: columns.map((row) => str(row.szColumn) ?? ""),
      referencedTable,
      referencedFields: columns.map((row) => str(row.szReferencedColumn) ?? ""),
      enforced: grbit === null ? null : (grbit & RELATION_DONT_ENFORCE) === 0,
      cascadeUpdate: grbit === null ? null : (grbit & RELATION_UPDATE_CASCADE) !== 0,
      cascadeDelete: grbit === null ? null : (grbit & RELATION_DELETE_CASCADE) !== 0,
      grbit,
    })
  }
  return byName(relationships)
}
