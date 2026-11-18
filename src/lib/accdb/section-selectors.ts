// The parts of a database report an evidence source can ask for. Shared by
// describe.ts and the evidence spec; no imports, so the lesson editor can load
// it in the browser.

// "records" is every table's records, "records:OWNERS" one table's.
// "queries" is the list of saved queries and every query's design;
// "query:MICROCHIP REMINDER" is one query's design (a name is required).
export const DATABASE_SECTION_KEYS = Object.freeze([
  "tables",
  "fields",
  "relationships",
  "lookups",
  "table-sort",
  "records",
  "changes",
  "queries",
  "query",
  "objects",
  "warnings",
] as const)

export type DatabaseSectionKey = (typeof DATABASE_SECTION_KEYS)[number]

/** What a source with no sections gets: everything but the records and single queries. */
export const DEFAULT_DATABASE_SECTIONS: readonly DatabaseSectionKey[] = Object.freeze(
  DATABASE_SECTION_KEYS.filter((key) => key !== "records" && key !== "query"),
)

/** A parsed selector. `name` is a table (records) or a query (query), else null. */
export type DatabaseSectionSelector = {
  key: DatabaseSectionKey
  name: string | null
}

const NAMED_KEYS: ReadonlySet<string> = new Set(["records", "query"])
const MAX_NAME_LENGTH = 64

/**
 * "Query: MICROCHIP REMINDER" -> { key: "query", name: "MICROCHIP REMINDER" }.
 * The key is lower-cased, the name trimmed and its case kept. Only records
 * and query take a name; query needs one. Null for anything else.
 */
export function parseDatabaseSection(text: string): DatabaseSectionSelector | null {
  const colon = text.indexOf(":")
  const key = (colon === -1 ? text : text.slice(0, colon)).trim().toLowerCase()
  if (!(DATABASE_SECTION_KEYS as readonly string[]).includes(key)) return null
  if (colon === -1) {
    return key === "query" ? null : { key: key as DatabaseSectionKey, name: null }
  }
  if (!NAMED_KEYS.has(key)) return null
  const name = text.slice(colon + 1).trim()
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) return null
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return null
  return { key: key as DatabaseSectionKey, name }
}

/** The canonical selector text: "tables", "records:OWNERS", "query:MICROCHIP REMINDER". */
export function formatDatabaseSection(selector: DatabaseSectionSelector): string {
  return selector.name === null ? selector.key : `${selector.key}:${selector.name}`
}

/** How names are compared: Access names ignore case, so NFKC, upper case, single spaces. */
export function databaseNameKey(name: string): string {
  return name.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim()
}

export function isDatabaseSectionSelector(selector: string): boolean {
  return parseDatabaseSection(selector) !== null
}
