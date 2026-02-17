"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { DateCommentsSchema } from "@/types"

const DateCommentsReturnValue = z.object({
  data: DateCommentsSchema.nullable(),
  error: z.string().nullable(),
})

export async function listDateCommentsAction(startDate: string, endDate: string) {
  try {
    await requireTeacherProfile()

    const { rows } = await query(
      `
        select date_comment_id, comment_date::text, comment, created_by, created_at
        from date_comments
        where comment_date >= $1::date and comment_date <= $2::date
        order by comment_date, created_at
      `,
      [startDate, endDate],
    )

    return DateCommentsReturnValue.parse({ data: rows ?? [], error: null })
  } catch (error) {
    console.error("[date-comments] Failed to list date comments:", error)
    const message = error instanceof Error ? error.message : "Unable to list date comments."
    return DateCommentsReturnValue.parse({ data: null, error: message })
  }
}

export async function createDateCommentAction(commentDate: string, comment: string) {
  try {
    const profile = await requireTeacherProfile()

    const { rows } = await query<{
      date_comment_id: string
      comment_date: string
      comment: string
      created_by: string
      created_at: string
    }>(
      `
        insert into date_comments (comment_date, comment, created_by)
        values ($1::date, $2, $3)
        returning date_comment_id, comment_date::text, comment, created_by, created_at
      `,
      [commentDate, comment, profile.userId],
    )

    const data = rows[0] ?? null
    if (!data) {
      return { success: false, error: "Unable to create date comment.", data: null }
    }

    revalidatePath("/assignments")
    return { success: true, data }
  } catch (error) {
    console.error("[date-comments] Failed to create date comment:", error)
    const message = error instanceof Error ? error.message : "Unable to create date comment."
    return { success: false, error: message, data: null }
  }
}

export async function updateDateCommentAction(dateCommentId: string, comment: string) {
  try {
    await requireTeacherProfile()

    const { rows } = await query<{
      date_comment_id: string
      comment_date: string
      comment: string
      created_by: string
      created_at: string
    }>(
      `
        update date_comments
        set comment = $1
        where date_comment_id = $2
        returning date_comment_id, comment_date::text, comment, created_by, created_at
      `,
      [comment, dateCommentId],
    )

    const data = rows[0] ?? null
    if (!data) {
      return { success: false, error: "Date comment not found.", data: null }
    }

    revalidatePath("/assignments")
    return { success: true, data }
  } catch (error) {
    console.error("[date-comments] Failed to update date comment:", error)
    const message = error instanceof Error ? error.message : "Unable to update date comment."
    return { success: false, error: message, data: null }
  }
}

export async function deleteDateCommentAction(dateCommentId: string) {
  try {
    await requireTeacherProfile()

    const { rowCount } = await query("delete from date_comments where date_comment_id = $1", [dateCommentId])

    if (rowCount === 0) {
      return { success: false, error: "Date comment not found." }
    }

    revalidatePath("/assignments")
    return { success: true }
  } catch (error) {
    console.error("[date-comments] Failed to delete date comment:", error)
    const message = error instanceof Error ? error.message : "Unable to delete date comment."
    return { success: false, error: message }
  }
}
