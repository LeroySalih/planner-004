"use server"

import { z } from "zod"

import { requireRole, requireTeacherProfile, type AuthenticatedProfile } from "@/lib/auth"
import { query, withDbClient } from "@/lib/db"

const TeacherSubjectsResult = z.object({
  data: z.array(z.string()).nullable(),
  error: z.string().nullable(),
})

const AllTeacherSubjectsResult = z.object({
  data: z
    .array(
      z.object({
        userId: z.string(),
        subject: z.string(),
      }),
    )
    .nullable(),
  error: z.string().nullable(),
})

const TeacherSubjectsWriteResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

export async function readTeacherSubjectsAction(options?: {
  userId?: string
  currentProfile?: AuthenticatedProfile | null
}): Promise<z.infer<typeof TeacherSubjectsResult>> {
  try {
    const profile = options?.currentProfile ?? (await requireTeacherProfile())
    const targetUserId = options?.userId ?? profile.userId

    const { rows } = await query<{ subject: string }>(
      `SELECT subject FROM teacher_subjects WHERE user_id = $1 ORDER BY subject ASC`,
      [targetUserId],
    )

    return TeacherSubjectsResult.parse({ data: rows.map((r) => r.subject), error: null })
  } catch (e) {
    return TeacherSubjectsResult.parse({ data: null, error: String(e) })
  }
}

export async function readAllTeacherSubjectsAction(): Promise<z.infer<typeof AllTeacherSubjectsResult>> {
  try {
    await requireRole("admin")

    const { rows } = await query<{ user_id: string; subject: string }>(
      `SELECT user_id, subject FROM teacher_subjects ORDER BY user_id ASC, subject ASC`,
    )

    return AllTeacherSubjectsResult.parse({
      data: rows.map((r) => ({ userId: r.user_id, subject: r.subject })),
      error: null,
    })
  } catch (e) {
    return AllTeacherSubjectsResult.parse({ data: null, error: String(e) })
  }
}

export async function updateTeacherSubjectsAction(
  userId: string,
  subjects: string[],
): Promise<z.infer<typeof TeacherSubjectsWriteResult>> {
  try {
    await requireRole("admin")

    if (!userId.trim()) {
      return TeacherSubjectsWriteResult.parse({ data: null, error: "A teacher must be specified." })
    }

    await withDbClient(async (client) => {
      await client.query("BEGIN")
      try {
        await client.query(`DELETE FROM teacher_subjects WHERE user_id = $1`, [userId])

        for (const subject of subjects) {
          await client.query(
            `INSERT INTO teacher_subjects (user_id, subject) VALUES ($1, $2)`,
            [userId, subject],
          )
        }

        await client.query("COMMIT")
      } catch (innerError) {
        await client.query("ROLLBACK")
        throw innerError
      }
    })

    return TeacherSubjectsWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return TeacherSubjectsWriteResult.parse({ data: null, error: String(e) })
  }
}
