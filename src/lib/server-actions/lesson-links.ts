"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { query } from "@/lib/db"

const LessonLinkSchema = z.object({
  lesson_link_id: z.string(),
  lesson_id: z.string(),
  url: z.string().url(),
  description: z.string().nullable(),
})

const LessonLinksReturnValue = z.object({
  data: z.array(LessonLinkSchema).nullable(),
  error: z.string().nullable(),
})

export async function listLessonLinksAction(lessonId: string) {
  try {
    const { rows } = await query(
      `
        select lesson_link_id, lesson_id, url, description
        from lesson_links
        where lesson_id = $1
        order by lesson_link_id
      `,
      [lessonId],
    )

    return LessonLinksReturnValue.parse({ data: rows ?? [], error: null })
  } catch (error) {
    console.error("[v0] Failed to list lesson links:", error)
    const message = error instanceof Error ? error.message : "Unable to list lesson links."
    return LessonLinksReturnValue.parse({ data: null, error: message })
  }
}

export async function createLessonLinkAction(
  unitId: string,
  lessonId: string,
  url: string,
  description: string | null,
) {
  try {
    const { rows } = await query<{
      lesson_link_id: string
      lesson_id: string
      url: string
      description: string | null
    }>(
      `
        insert into lesson_links (lesson_id, url, description)
        values ($1, $2, $3)
        returning lesson_link_id, lesson_id, url, description
      `,
      [lessonId, url, description],
    )

    const data = rows[0] ?? null
    if (!data) {
      return { success: false, error: "Unable to create lesson link.", data: null }
    }

    revalidatePath(`/units/${unitId}`)
    return { success: true, data }
  } catch (error) {
    console.error("[v0] Failed to create lesson link:", error)
    const message = error instanceof Error ? error.message : "Unable to create lesson link."
    return { success: false, error: message, data: null }
  }
}

export async function updateLessonLinkAction(
  unitId: string,
  lessonId: string,
  lessonLinkId: string,
  url: string,
  description: string | null,
) {
  try {
    const { rows } = await query<{
      lesson_link_id: string
      lesson_id: string
      url: string
      description: string | null
    }>(
      `
        update lesson_links
        set url = $1, description = $2
        where lesson_link_id = $3
        returning lesson_link_id, lesson_id, url, description
      `,
      [url, description, lessonLinkId],
    )

    const data = rows[0] ?? null
    if (!data) {
      return { success: false, error: "Lesson link not found.", data: null }
    }

    revalidatePath(`/units/${unitId}`)
    return { success: true, data }
  } catch (error) {
    console.error("[v0] Failed to update lesson link:", error)
    const message = error instanceof Error ? error.message : "Unable to update lesson link."
    return { success: false, error: message, data: null }
  }
}

export async function deleteLessonLinkAction(unitId: string, lessonId: string, lessonLinkId: string) {
  try {
    const { rowCount } = await query("delete from lesson_links where lesson_link_id = $1", [lessonLinkId])

    if (rowCount === 0) {
      return { success: false, error: "Lesson link not found." }
    }

    revalidatePath(`/units/${unitId}`)
    return { success: true }
  } catch (error) {
    console.error("[v0] Failed to delete lesson link:", error)
    const message = error instanceof Error ? error.message : "Unable to delete lesson link."
    return { success: false, error: message }
  }
}
