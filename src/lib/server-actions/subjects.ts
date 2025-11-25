"use server"

import { z } from "zod"

import { SubjectsSchema } from "@/types"
import { Client } from "pg"
import { requireTeacherProfile, type AuthenticatedProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"

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
        process.env.POSTSQL_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? null

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
