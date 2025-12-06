"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { LessonAssignmentSchema, LessonAssignmentsSchema } from "@/types"
import { query } from "@/lib/db"
import { normalizeDateOnly } from "@/lib/utils"

const LessonAssignmentReturnValue = z.object({
  data: LessonAssignmentSchema.nullable(),
  error: z.string().nullable(),
})

const LessonAssignmentsReturnValue = z.object({
  data: LessonAssignmentsSchema.nullable(),
  error: z.string().nullable(),
})

export type LessonAssignmentActionResult = z.infer<typeof LessonAssignmentReturnValue>

export async function readLessonAssignmentsAction() {
  console.log("[v0] Server action started for reading lesson assignments")

  try {
    const { rows } = await query<{
      group_id: string
      lesson_id: string
      start_date: string | Date | null
    }>("select * from lesson_assignments")
    const normalized = (rows ?? []).map((row) => ({
      ...row,
      start_date:
        normalizeDateOnly(row.start_date) ??
        (row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : (row.start_date ?? "")),
    }))
    console.log("[v0] Server action completed for reading lesson assignments")
    return LessonAssignmentsReturnValue.parse({ data: normalized ?? [], error: null })
  } catch (error) {
    console.error("[v0] Server action failed for reading lesson assignments:", error)
    const message = error instanceof Error ? error.message : "Unable to load lesson assignments."
    return LessonAssignmentsReturnValue.parse({ data: null, error: message })
  }
}

export async function upsertLessonAssignmentAction(groupId: string, lessonId: string, startDate: string) {
  const normalizedStartDate = normalizeDateOnly(startDate) ?? startDate

  console.log("[v0] Server action started for upserting lesson assignment:", {
    groupId,
    lessonId,
    startDate: normalizedStartDate,
  })

  let resultData: Record<string, unknown> | null = null

  try {
    const { rows: existingRows } = await query(
      `
        select *
        from lesson_assignments
        where group_id = $1 and lesson_id = $2
        limit 1
      `,
      [groupId, lessonId],
    )

    if (existingRows.length > 0) {
      const { rows } = await query(
        `
          update lesson_assignments
          set start_date = $1
          where group_id = $2 and lesson_id = $3
          returning *
        `,
        [normalizedStartDate, groupId, lessonId],
      )
      resultData = rows[0] ?? null
    } else {
      const { rows } = await query(
        `
          insert into lesson_assignments (group_id, lesson_id, start_date)
          values ($1, $2, $3)
          returning *
        `,
        [groupId, lessonId, normalizedStartDate],
      )
      resultData = rows[0] ?? null
    }
  } catch (error) {
    console.error("[v0] Server action failed for upserting lesson assignment:", error)
    const message = error instanceof Error ? error.message : "Unable to save lesson assignment."
    return LessonAssignmentReturnValue.parse({ data: null, error: message })
  }

  console.log("[v0] Server action completed for upserting lesson assignment:", {
    groupId,
    lessonId,
    startDate: normalizedStartDate,
  })

  revalidatePath("/assignments")
  const normalized =
    resultData && typeof resultData === "object"
      ? {
          ...resultData,
          start_date:
            normalizeDateOnly(resultData["start_date"] as string | Date | null | undefined) ??
            (resultData["start_date"] instanceof Date
              ? (resultData["start_date"] as Date).toISOString().slice(0, 10)
              : (resultData["start_date"] as string | null | undefined) ?? ""),
        }
      : resultData
  return LessonAssignmentReturnValue.parse({ data: normalized, error: null })
}

export async function deleteLessonAssignmentAction(groupId: string, lessonId: string) {
  console.log("[v0] Server action started for deleting lesson assignment:", { groupId, lessonId })

  try {
    const { rowCount } = await query(
      "delete from lesson_assignments where group_id = $1 and lesson_id = $2",
      [groupId, lessonId],
    )

    if (rowCount === 0) {
      return { success: false, error: "Lesson assignment not found." }
    }
  } catch (error) {
    console.error("[v0] Server action failed for deleting lesson assignment:", error)
    const message = error instanceof Error ? error.message : "Unable to delete lesson assignment."
    return { success: false, error: message }
  }

  console.log("[v0] Server action completed for deleting lesson assignment:", { groupId, lessonId })

  revalidatePath("/assignments")
  return { success: true }
}
