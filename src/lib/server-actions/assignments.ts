"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { Assignment } from "@/types"
import { AssignmentSchema, AssignmentsSchema } from "@/types"
import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"
import { normalizeAssignmentWeek, normalizeDateOnly } from "@/lib/utils"

const AssignmentReturnValue = z.object({
  data: AssignmentSchema.nullable(),
  error: z.string().nullable(),
})

type RawAssignmentRow = {
  group_id: string
  unit_id: string
  start_date: string | Date | null
  end_date: string | Date | null
  active?: boolean | null
}

function normalizeAssignmentRow(row: RawAssignmentRow) {
  const snapped = normalizeAssignmentWeek(row.start_date, row.end_date)
  const normalizedStart = snapped?.start ?? normalizeDateOnly(row.start_date)
  const normalizedEnd = snapped?.end ?? normalizeDateOnly(row.end_date)

  return {
    ...row,
    start_date:
      normalizedStart ??
      (row.start_date instanceof Date
        ? row.start_date.toISOString().slice(0, 10)
        : (row.start_date ?? "")),
    end_date:
      normalizedEnd ??
      (row.end_date instanceof Date ? row.end_date.toISOString().slice(0, 10) : (row.end_date ?? "")),
  }
}

const AssignmentsReturnValue = z.object({
  data: AssignmentsSchema.nullable(),
  error: z.string().nullable(),
})

export type AssignmentActionResult = z.infer<typeof AssignmentReturnValue>

export async function createAssignmentAction(
  groupId: string,
  unitId: string,
  startDate: string,
  endDate: string,
) {
  const snapped = normalizeAssignmentWeek(startDate, endDate)
  const normalizedStartDate = snapped?.start ?? normalizeDateOnly(startDate) ?? startDate
  const normalizedEndDate = snapped?.end ?? normalizeDateOnly(endDate) ?? endDate

  console.log("[v0] Server action started for assignment creation:", {
    groupId,
    unitId,
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
  })

  const payload = {
    group_id: groupId,
    unit_id: unitId,
    start_date: normalizedStartDate,
    end_date: normalizedEndDate,
    active: true,
  }

  try {
    const { rows: reactivatedRows } = await query(
      `
        update assignments
        set unit_id = $1, start_date = $2, end_date = $3, active = true
        where group_id = $4 and unit_id = $1 and start_date = $2 and active = false
        returning *
      `,
      [payload.unit_id, payload.start_date, payload.end_date, payload.group_id],
    )

    if (reactivatedRows && reactivatedRows.length > 0) {
      const assignment = normalizeAssignmentRow(reactivatedRows[0] as RawAssignmentRow)
      console.log("[v0] Server action completed by reactivating assignment:", {
        groupId,
        unitId,
        startDate: payload.start_date,
        endDate: payload.end_date,
      })

      revalidatePath("/")
      return AssignmentReturnValue.parse({ data: assignment, error: null })
    }

    const { rows } = await query(
      `
        insert into assignments (group_id, unit_id, start_date, end_date, active)
        values ($1, $2, $3, $4, true)
        returning *
      `,
      [payload.group_id, payload.unit_id, payload.start_date, payload.end_date],
    )

    const data = rows[0] ? normalizeAssignmentRow(rows[0] as RawAssignmentRow) : null

    console.log("[v0] Server action completed for assignment creation:", {
      groupId,
      unitId,
      startDate: payload.start_date,
      endDate: payload.end_date,
    })

    revalidatePath("/")
    return AssignmentReturnValue.parse({ data, error: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create assignment."
    if (message.includes("duplicate") || message.includes("unique") || message.includes("already exists")) {
      return AssignmentReturnValue.parse({
        data: null,
        error: "An assignment already exists for this group, unit, and start date.",
      })
    }

    console.error("[v0] Server action failed for assignment creation:", error)
    return AssignmentReturnValue.parse({ data: null, error: message })
  }
}

export async function readAssignmentAction(groupId: string, unitId: string, startDate: string) {
  const normalizedStartDate = normalizeAssignmentWeek(startDate, null)?.start ?? normalizeDateOnly(startDate) ?? startDate

  console.log("[v0] Server action started for reading assignment:", {
    groupId,
    unitId,
    startDate: normalizedStartDate,
  })

  try {
    const { rows } = await query(
      `
        select *
        from assignments
        where group_id = $1 and unit_id = $2 and start_date = $3 and active = true
        limit 1
      `,
      [groupId, unitId, normalizedStartDate],
    )

    const data = rows[0] ? normalizeAssignmentRow(rows[0] as RawAssignmentRow) : null

    console.log("[v0] Server action completed for reading assignment:", {
      groupId,
      unitId,
      startDate: normalizedStartDate,
    })

    revalidatePath("/")
    return AssignmentReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[v0] Server action failed for reading assignment:", error)
    const message = error instanceof Error ? error.message : "Unable to load assignment."
    return AssignmentReturnValue.parse({ data: null, error: message })
  }
}

export async function readAssignmentsAction(options?: { authEndTime?: number | null; routeTag?: string }) {
  const routeTag = options?.routeTag ?? "/assignments:readAssignments"

  return withTelemetry(
    {
      routeTag,
      functionName: "readAssignmentsAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading assignments")
      try {
        const { rows } = await query<RawAssignmentRow>("select * from assignments where active = true")
        const normalized = (rows ?? []).map(normalizeAssignmentRow)
        console.log("[v0] Server action completed for reading assignments")
        return AssignmentsReturnValue.parse({ data: normalized ?? [], error: null })
      } catch (error) {
        console.error("[v0] Server action failed for reading assignments:", error)
        const message = error instanceof Error ? error.message : "Unable to load assignments."
        return AssignmentsReturnValue.parse({ data: null, error: message })
      }
    },
  )
}

export async function readAssignmentsForGroupAction(
  groupId: string,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const routeTag = options?.routeTag ?? "/assignments:readAssignmentsForGroup"

  return withTelemetry(
    {
      routeTag,
      functionName: "readAssignmentsForGroupAction",
      params: { groupId },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading assignments for group:", { groupId })
      try {
        const { rows } = await query<RawAssignmentRow>(
          "select * from assignments where group_id = $1 and active = true",
          [groupId],
        )
        const normalized = (rows ?? []).map(normalizeAssignmentRow)
        console.log("[v0] Server action completed for reading assignments for group:", { groupId })
        return AssignmentsReturnValue.parse({ data: normalized ?? [], error: null })
      } catch (error) {
        console.error("[v0] Server action failed for reading assignments for group:", error)
        const message = error instanceof Error ? error.message : "Unable to load assignments."
        return AssignmentsReturnValue.parse({ data: null, error: message })
      }
    },
  )
}

export async function deleteAssignmentAction(groupId: string, unitId: string, startDate: string) {
  const normalizedStartDate = normalizeAssignmentWeek(startDate, null)?.start ?? normalizeDateOnly(startDate) ?? startDate

  console.log("[v0] Server action started for deleting assignment:", {
    groupId,
    unitId,
    startDate: normalizedStartDate,
  })

  try {
    const { rowCount } = await query(
      `
        delete from assignments
        where group_id = $1 and unit_id = $2 and start_date = $3
      `,
      [groupId, unitId, normalizedStartDate],
    )

    if (rowCount === 0) {
      return { success: false, error: "Assignment not found." }
    }
  } catch (error) {
    console.error("[v0] Server action failed for deleting assignment:", error)
    const message = error instanceof Error ? error.message : "Unable to delete assignment."
    return { success: false, error: message }
  }

  console.log("[v0] Server action completed for deleting assignment:", {
    groupId,
    unitId,
    startDate: normalizedStartDate,
  })

  revalidatePath("/")
  return { success: true }
}

export async function updateAssignmentAction(
  groupId: string,
  unitId: string,
  startDate: string,
  endDate: string,
  options: { originalUnitId: string; originalStartDate: string },
) {
  const snapped = normalizeAssignmentWeek(startDate, endDate)
  const normalizedStartDate = snapped?.start ?? normalizeDateOnly(startDate) ?? startDate
  const normalizedEndDate = snapped?.end ?? normalizeDateOnly(endDate) ?? endDate
  const normalizedOriginalStart =
    normalizeAssignmentWeek(options.originalStartDate, null)?.start ??
    normalizeDateOnly(options.originalStartDate) ??
    options.originalStartDate

  console.log("[v0] Server action started for updating assignment:", {
    groupId,
    unitId,
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    options: { ...options, originalStartDate: normalizedOriginalStart },
  })

  try {
    const { rows } = await query(
      `
        update assignments
        set unit_id = $1,
            start_date = $2,
            end_date = $3,
            active = true
        where group_id = $4
          and unit_id = $5
          and start_date = $6
        returning *
      `,
      [unitId, normalizedStartDate, normalizedEndDate, groupId, options.originalUnitId, normalizedOriginalStart],
    )

    const data = rows?.[0] ? normalizeAssignmentRow(rows[0] as RawAssignmentRow) : null
    if (!data) {
      return AssignmentReturnValue.parse({ data: null, error: "Assignment not found." })
    }

    console.log("[v0] Server action completed for updating assignment:", {
      groupId,
      unitId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
    })

    revalidatePath("/")
    return AssignmentReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[v0] Server action failed for updating assignment:", error)
    const message = error instanceof Error ? error.message : "Unable to update assignment."
    return AssignmentReturnValue.parse({ data: null, error: message })
  }
}
