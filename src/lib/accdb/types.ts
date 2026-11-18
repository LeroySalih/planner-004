// What the Access database reader (read.ts) reports about one .accdb file.
// Every value is as Access stores it, except: record dates are DD-MM-YYYY
// (with a time only when it is not midnight), Yes/No fields read "Yes"/"No",
// and numbers are written without trailing zeros (450.0000 reads "450").

export type DatabaseLookup = {
  rowSourceType: string | null
  rowSource: string | null
  limitToList: boolean | null
  boundColumn: number | null
  columnCount: number | null
  // "Combo Box", "List Box", "Text Box", "Check Box", or Access's own number.
  displayControl: string | null
}

export type DatabaseField = {
  name: string
  // mdb-schema's type without the size: "Text", "Long Integer", "DateTime",
  // "Currency", "Boolean", …
  type: string
  // A Text field's size; null for every other type.
  size: number | null
  // The field's Required property when Access stored one, else null.
  required: boolean | null
  notNull: boolean
  validationRule: string | null
  validationText: string | null
  defaultValue: string | null
  inputMask: string | null
  format: string | null
  caption: string | null
  lookup: DatabaseLookup | null
}

export type DatabaseTable = {
  name: string
  fields: DatabaseField[]
  // The table's saved sort, e.g. "[OWNERS].[SURNAME]".
  sort: { orderBy: string | null; orderByOn: boolean | null }
  filter: string | null
  rowCount: number
  // At most MAX_ROWS_PER_TABLE rows, keyed by field name, in field order.
  rows: Array<Record<string, string | null>>
  rowsTruncated: boolean
}

export type DatabaseRelationship = {
  name: string
  // The related (many) side.
  table: string
  fields: string[]
  // The primary (one) side.
  referencedTable: string
  referencedFields: string[]
  enforced: boolean | null
  cascadeUpdate: boolean | null
  cascadeDelete: boolean | null
  grbit: number | null
}

export type DatabaseQuery = {
  name: string
  type: "select" | "other"
  // mdb-queries' SQL text. It leaves out the joins; `joins` has them.
  sql: string | null
  tables: Array<{ name: string; alias: string | null }>
  joins: Array<{ left: string; right: string; on: string; kind: "inner" | "left" | "right" | "unknown" }>
  outputs: Array<{ expression: string; alias: string | null }>
  // Fields used in WHERE or ORDER BY that no output shows, as Table.[Field].
  hiddenFields: string[]
  where: string | null
  groupBy: string[]
  having: string | null
  orderBy: Array<{ expression: string; descending: boolean }>
}

export type DatabaseFormOrReport = {
  name: string
  // The tables of the object's hidden record source query (~sq_f… / ~sq_r…),
  // or null when there is none to read.
  baseTables: string[] | null
}

export type DatabaseSnapshot = {
  // mdb-ver's answer, e.g. "ACE14".
  version: string
  tables: DatabaseTable[]
  relationships: DatabaseRelationship[]
  // User queries only: no name starting with "~".
  queries: DatabaseQuery[]
  forms: DatabaseFormOrReport[]
  reports: DatabaseFormOrReport[]
  warnings: string[]
}
