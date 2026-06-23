"use server"

import { z } from "zod"

import { SubjectSchema, SubjectsSchema, type Subject } from "@/types"
import { Client } from "pg"
import { requireRole, requireTeacherProfile, type AuthenticatedProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"

const SubjectsReturnValue = z.object({
  data: SubjectsSchema.nullable(),
  error: z.string().nullable(),
})

export async function readSubjectsAction(options?: {
  authEndTime?: number | null
  routeTag?: string
  currentProfile?: AuthenticatedProfile | null
}) {
  const routeTag = options?.routeTag ?? "/subjects:readSubjects"

  const profile = options?.currentProfile ?? (await requireTeacherProfile())
  if (!profile.isTeacher) {
    return SubjectsReturnValue.parse({ data: null, error: "You do not have permission to view subjects." })
  }

  return withTelemetry(
    {
      routeTag,
      functionName: "readSubjectsAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading subjects:")

      let error: string | null = null

      const connectionString =
        process.env.DATABASE_URL ?? null

      if (!connectionString) {
        console.error("[v0] readSubjectsAction missing database connection string")
        return SubjectsReturnValue.parse({ data: null, error: "Database connection not configured." })
      }

      const client = new Client({
        connectionString,
        ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
      })

      try {
        await client.connect()
        const { rows } = await client.query("select subject, active from subjects where active = true order by subject asc;")
        console.log("[v0] Server action completed for reading subjects:", error)
        return SubjectsReturnValue.parse({ data: rows ?? [], error: null })
      } catch (readError) {
        error = readError instanceof Error ? readError.message : "Unable to load subjects."
        console.error("[v0] Failed to read subjects via direct PG client", readError)
        return SubjectsReturnValue.parse({ data: null, error })
      } finally {
        try {
          await client.end()
        } catch {
          // ignore
        }
      }
    },
  )
}

const SubjectsResult = z.object({
  data: z.array(SubjectSchema).nullable(),
  error: z.string().nullable(),
})

const SubjectWriteResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

export async function readAllSubjectsAction(): Promise<z.infer<typeof SubjectsResult>> {
  try {
    await requireRole("admin")
    const { rows } = await query<Record<string, unknown>>(
      `SELECT subject, active FROM subjects ORDER BY subject ASC`,
    )
    return SubjectsResult.parse({ data: rows.map((r) => SubjectSchema.parse(r)), error: null })
  } catch (e) {
    return SubjectsResult.parse({ data: null, error: String(e) })
  }
}

export async function createSubjectAction(subject: string): Promise<z.infer<typeof SubjectWriteResult>> {
  try {
    await requireRole("admin")
    const trimmed = subject.trim()
    if (!trimmed) {
      return SubjectWriteResult.parse({ data: null, error: "Subject name is required." })
    }
    const { rows: existing } = await query<{ subject: string }>(
      `SELECT subject FROM subjects WHERE lower(subject) = lower($1)`,
      [trimmed],
    )
    if (existing.length > 0) {
      return SubjectWriteResult.parse({ data: null, error: "This subject already exists." })
    }
    await query(`INSERT INTO subjects (subject, active) VALUES ($1, true)`, [trimmed])
    return SubjectWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return SubjectWriteResult.parse({ data: null, error: String(e) })
  }
}

export async function setSubjectActiveAction(
  subject: string,
  active: boolean,
): Promise<z.infer<typeof SubjectWriteResult>> {
  try {
    await requireRole("admin")
    await query(`UPDATE subjects SET active = $2 WHERE subject = $1`, [subject, active])
    return SubjectWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return SubjectWriteResult.parse({ data: null, error: String(e) })
  }
}
