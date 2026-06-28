"use server"

import { z } from "zod"

import { MarkingGuidanceSchema } from "@/types"
import { requireRole, requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"

const MarkingGuidancesResult = z.object({
  data: z.array(MarkingGuidanceSchema).nullable(),
  error: z.string().nullable(),
})

const MarkingGuidanceWriteResult = z.object({
  data: z.null(),
  error: z.string().nullable(),
})

const MarkingGuidanceCreateResult = z.object({
  data: z.object({ id: z.string() }).nullable(),
  error: z.string().nullable(),
})

function toMarkingGuidance(row: Record<string, unknown>) {
  return MarkingGuidanceSchema.parse({
    id: row.id,
    subject: row.subject,
    title: row.title,
    content: row.content,
    active: row.active,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  })
}

export async function readMarkingGuidancesAction(
  subject?: string,
): Promise<z.infer<typeof MarkingGuidancesResult>> {
  try {
    await requireRole("admin")
    const { rows } = subject
      ? await query<Record<string, unknown>>(
          `SELECT id, subject, title, content, active, created_at FROM marking_guidances WHERE subject = $1 ORDER BY title ASC`,
          [subject],
        )
      : await query<Record<string, unknown>>(
          `SELECT id, subject, title, content, active, created_at FROM marking_guidances ORDER BY subject ASC, title ASC`,
        )
    return MarkingGuidancesResult.parse({ data: rows.map(toMarkingGuidance), error: null })
  } catch (e) {
    return MarkingGuidancesResult.parse({ data: null, error: String(e) })
  }
}

export async function readActiveMarkingGuidancesForSubjectAction(
  subject: string,
): Promise<z.infer<typeof MarkingGuidancesResult>> {
  try {
    await requireTeacherProfile()
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, subject, title, content, active, created_at FROM marking_guidances WHERE subject = $1 AND active = true ORDER BY title ASC`,
      [subject],
    )
    return MarkingGuidancesResult.parse({ data: rows.map(toMarkingGuidance), error: null })
  } catch (e) {
    return MarkingGuidancesResult.parse({ data: null, error: String(e) })
  }
}

export async function createMarkingGuidanceAction(input: {
  subject: string
  title: string
  content: string
}): Promise<z.infer<typeof MarkingGuidanceCreateResult>> {
  try {
    await requireRole("admin")
    const subject = input.subject.trim()
    const title = input.title.trim()
    const content = input.content.trim()
    if (!subject || !title || !content) {
      return MarkingGuidanceCreateResult.parse({ data: null, error: "Subject, title and content are required." })
    }
    const { rows } = await query<{ id: string }>(
      `INSERT INTO marking_guidances (subject, title, content, active) VALUES ($1, $2, $3, true) RETURNING id`,
      [subject, title, content],
    )
    return MarkingGuidanceCreateResult.parse({ data: { id: rows[0].id }, error: null })
  } catch (e) {
    return MarkingGuidanceCreateResult.parse({ data: null, error: String(e) })
  }
}

export async function updateMarkingGuidanceAction(input: {
  id: string
  title: string
  content: string
}): Promise<z.infer<typeof MarkingGuidanceWriteResult>> {
  try {
    await requireRole("admin")
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) {
      return MarkingGuidanceWriteResult.parse({ data: null, error: "Title and content are required." })
    }
    await query(`UPDATE marking_guidances SET title = $2, content = $3 WHERE id = $1`, [input.id, title, content])
    return MarkingGuidanceWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return MarkingGuidanceWriteResult.parse({ data: null, error: String(e) })
  }
}

export async function setMarkingGuidanceActiveAction(
  id: string,
  active: boolean,
): Promise<z.infer<typeof MarkingGuidanceWriteResult>> {
  try {
    await requireRole("admin")
    await query(`UPDATE marking_guidances SET active = $2 WHERE id = $1`, [id, active])
    return MarkingGuidanceWriteResult.parse({ data: null, error: null })
  } catch (e) {
    return MarkingGuidanceWriteResult.parse({ data: null, error: String(e) })
  }
}
