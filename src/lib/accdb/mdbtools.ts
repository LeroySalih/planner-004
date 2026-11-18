import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { DATABASE_MESSAGES, UnreadableDatabaseError } from "@/lib/accdb/errors"

// Access database facts via mdbtools (mdb-ver, mdb-tables, mdb-schema,
// mdb-prop, mdb-json, mdb-queries), run with execFile (never a shell) on a
// copy of the database in a temp directory that is always removed. Nothing in
// the database is run. Object names come from the pupil's file, so every
// command puts "--" before its positional arguments: a name starting with "-"
// is never taken as an option. (mdbtools' GLib parser then keeps the "--" as
// an argument, so the tool exits 1 on the argument count and that object is
// reported as unreadable: a warning, never an injected option.)

export type MdbTool = "mdb-ver" | "mdb-tables" | "mdb-schema" | "mdb-prop" | "mdb-json" | "mdb-queries"

export const MDB_TOOL_TIMEOUT_MS = 30_000
// A tool's output is read up to this many bytes; past it the call fails
// rather than filling memory.
export const MDB_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
// The whole read of one database, every command together.
export const READ_BUDGET_MS = 120_000

const execFileAsync = promisify(execFile)

/** Runs `use` with the database written to a temp file; the directory is always removed. */
export async function withTempDatabase<T>(bytes: Buffer, use: (dbPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "dino-accdb-"))
  const dbPath = path.join(dir, "db.accdb")
  try {
    await writeFile(dbPath, bytes)
    return await use(dbPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * The tool's failure: UnreadableDatabaseError when it ran and exited non-zero
 * (the file is bad), else a plain Error (the tool missing, a timeout, too much
 * output), as `toolFailure` in src/lib/pdf/poppler.ts.
 */
function toolFailure(tool: MdbTool, error: unknown): Error {
  const failure = error as { code?: unknown; killed?: boolean; signal?: unknown }
  const refused = typeof failure?.code === "number" && failure.code !== 0 && !failure.killed && !failure.signal
  return refused
    ? new UnreadableDatabaseError(DATABASE_MESSAGES.unopenable, { cause: error })
    : new Error(`The database reader (${tool}) failed: it may not be installed, or it took too long.`, { cause: error })
}

/** Runs one mdbtools command and returns its stdout. Throws as `toolFailure`. */
export async function runMdb(
  tool: MdbTool,
  args: string[],
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(tool, args, {
      timeout: options.timeoutMs ?? MDB_TOOL_TIMEOUT_MS,
      maxBuffer: options.maxBytes ?? MDB_MAX_OUTPUT_BYTES,
      // Only what mdbtools needs (NODE_ENV because Next's ProcessEnv type requires it).
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, LANG: "C.UTF-8", HOME: tmpdir() },
      encoding: "utf8",
    })
    return stdout
  } catch (error) {
    throw toolFailure(tool, error)
  }
}

/**
 * The time left of one read's budget. Each command gets the smaller of its
 * own timeout and what is left; a read that has used it all fails as a plain
 * Error (retried), never as the pupil's fault.
 */
export function readBudget(totalMs = READ_BUDGET_MS) {
  const deadline = Date.now() + totalMs
  return (timeoutMs = MDB_TOOL_TIMEOUT_MS): number => {
    const left = deadline - Date.now()
    if (left <= 0) throw new Error("The database reader took too long.")
    return Math.min(timeoutMs, left)
  }
}
