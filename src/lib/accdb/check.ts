import { DATABASE_MESSAGES, UnreadableDatabaseError } from "@/lib/accdb/errors"
import { runMdb, withTempDatabase } from "@/lib/accdb/mdbtools"
import { sniffAccessHeader } from "@/lib/accdb/read"

// The light open used when a database is uploaded: the right kind of file,
// and mdbtools can open it and list its tables. The full read happens later.

const CHECK_TIMEOUT_MS = 15_000

/**
 * Throws UnreadableDatabaseError with the pupil's message when the file is a
 * lock file, an .mdb, not named .accdb, not an Access database, or cannot be
 * opened (a password or damage); a plain Error when mdbtools could not run.
 */
export async function checkAccessDatabase(
  bytes: Buffer,
  originalName: string,
): Promise<{ version: string; tables: string[] }> {
  const name = originalName.trim().toLowerCase()
  if (name.endsWith(".laccdb")) throw new UnreadableDatabaseError(DATABASE_MESSAGES.lockFile)
  if (name.endsWith(".mdb")) throw new UnreadableDatabaseError(DATABASE_MESSAGES.mdb)
  if (!name.endsWith(".accdb")) throw new UnreadableDatabaseError(DATABASE_MESSAGES.notThisType)
  sniffAccessHeader(bytes)
  return withTempDatabase(bytes, async (file) => {
    const version = (await runMdb("mdb-ver", ["--", file], { timeoutMs: CHECK_TIMEOUT_MS })).trim()
    const tables = (await runMdb("mdb-tables", ["-1", "--", file], { timeoutMs: CHECK_TIMEOUT_MS }))
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length > 0)
    return { version, tables }
  })
}
