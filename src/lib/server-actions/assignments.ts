"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { Assignment } from "@/types"
import { AssignmentSchema, AssignmentsSchema } from "@/types"
import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

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
  return {
    ...row,
    start_date: row.start_date instanceof Date ? row.start_date.toISOString() : row.start_date,
    end_date: row.end_date instanceof Date ? row.end_date.toISOString() : row.end_date,
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
  console.log("[v0] Server action started for assignment creation:", { groupId, unitId, startDate, endDate })

  const payload = {
    group_id: groupId,
    unit_id: unitId,
    start_date: startDate,
    end_date: endDate,
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
      [unitId, startDate, endDate, groupId],
    )

    if (reactivatedRows && reactivatedRows.length > 0) {
      const assignment = reactivatedRows[0]
      console.log("[v0] Server action completed by reactivating assignment:", {
        groupId,
        unitId,
        startDate,
        endDate,
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
      [groupId, unitId, startDate, endDate],
    )

    const data = rows[0] ?? null

    console.log("[v0] Server action completed for assignment creation:", { groupId, unitId, startDate, endDate })

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
  console.log("[v0] Server action started for reading assignment:", { groupId, unitId, startDate })

  try {
    const { rows } = await query(
      `
        select *
        from assignments
        where group_id = $1 and unit_id = $2 and start_date = $3 and active = true
        limit 1
      `,
      [groupId, unitId, startDate],
    )

    const data = rows[0] ?? null

    console.log("[v0] Server action completed for reading assignment:", { groupId, unitId, startDate })

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
  console.log("[v0] Server action started for deleting assignment:", { groupId, unitId, startDate })

  try {
    const { rowCount } = await query(
      `
        delete from assignments
        where group_id = $1 and unit_id = $2 and start_date = $3
      `,
      [groupId, unitId, startDate],
    )

    if (rowCount === 0) {
      return { success: false, error: "Assignment not found." }
    }
  } catch (error) {
    console.error("[v0] Server action failed for deleting assignment:", error)
    const message = error instanceof Error ? error.message : "Unable to delete assignment."
    return { success: false, error: message }
  }

  console.log("[v0] Server action completed for deleting assignment:", { groupId, unitId, startDate })

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
  console.log("[v0] Server action started for updating assignment:", {
    groupId,
    unitId,
    startDate,
    endDate,
    options,
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
      [unitId, startDate, endDate, groupId, options.originalUnitId, options.originalStartDate],
    )

    const data = rows?.[0] ? normalizeAssignmentRow(rows[0] as RawAssignmentRow) : null
    if (!data) {
      return AssignmentReturnValue.parse({ data: null, error: "Assignment not found." })
    }

    console.log("[v0] Server action completed for updating assignment:", {
      groupId,
      unitId,
      startDate,
      endDate,
    })

    revalidatePath("/")
    return AssignmentReturnValue.parse({ data, error: null })
  } catch (error) {
    console.error("[v0] Server action failed for updating assignment:", error)
    const message = error instanceof Error ? error.message : "Unable to update assignment."
    return AssignmentReturnValue.parse({ data: null, error: message })
  }
}
