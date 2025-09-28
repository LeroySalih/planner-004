"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { Assignment } from "@/types"
import { AssignmentSchema, AssignmentsSchema } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const AssignmentReturnValue = z.object({
  data: AssignmentSchema.nullable(),
  error: z.string().nullable(),
})

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

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("assignments")
    .insert({
      group_id: groupId,
      unit_id: unitId,
      start_date: startDate,
      end_date: endDate,
      active: true,
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Server action failed for assignment creation:", error)
    return AssignmentReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for assignment creation:", { groupId, unitId, startDate, endDate })

  revalidatePath("/")
  return AssignmentReturnValue.parse({ data, error: null })
}

export async function readAssignmentAction(groupId: string, unitId: string, startDate: string) {
  console.log("[v0] Server action started for reading assignment:", { groupId, unitId, startDate })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("assignments")
    .select("*")
    .eq("group_id", groupId)
    .eq("unit_id", unitId)
    .eq("start_date", startDate)
    .eq("active", true)
    .maybeSingle()

  if (error) {
    console.error("[v0] Server action failed for reading assignment:", error)
    return AssignmentReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for reading assignment:", { groupId, unitId, startDate })

  revalidatePath("/")
  return AssignmentReturnValue.parse({ data, error: null })
}

export async function readAssignmentsAction() {
  console.log("[v0] Server action started for reading assignments:")

  let error: string | null = null

  const supabase = await createSupabaseServerClient()

  const { data, error: readError } = await supabase
    .from("assignments")
    .select("*")
    .eq("active", true)

  if (readError) {
    error = readError.message
    console.error(error)
  }

  console.log("[v0] Server action completed for reading assignments:", error)

  return AssignmentsReturnValue.parse({ data, error })
}

export async function readAssignmentsForGroupAction(groupId: string) {
  console.log("[v0] Server action started for reading assignments for group:", { groupId })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("assignments")
    .select("*")
    .eq("group_id", groupId)
    .eq("active", true)

  if (error) {
    console.error("[v0] Server action failed for reading assignments for group:", error)
    return AssignmentsReturnValue.parse({ data: null, error: error.message })
  }

  return AssignmentsReturnValue.parse({ data, error: null })
}

export async function updateAssignmentAction(
  groupId: string,
  unitId: string,
  startDate: string,
  endDate: string,
  options?: { originalUnitId?: string; originalStartDate?: string },
) {
  console.log("[v0] Server action started for assignment update:", {
    groupId,
    unitId,
    startDate,
    endDate,
    originalUnitId: options?.originalUnitId,
    originalStartDate: options?.originalStartDate,
  })

  const matchUnitId = options?.originalUnitId ?? unitId
  const matchStartDate = options?.originalStartDate ?? startDate

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("assignments")
    .update({
      unit_id: unitId,
      start_date: startDate,
      end_date: endDate,
      active: true,
    })
    .eq("group_id", groupId)
    .eq("unit_id", matchUnitId)
    .eq("start_date", matchStartDate)
    .select()
    .single()

  if (error) {
    console.error("[v0] Server action failed for assignment update:", error)
    return AssignmentReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for assignment update:", { groupId, unitId, startDate, endDate })

  revalidatePath("/")
  return AssignmentReturnValue.parse({ data, error: null })
}

export async function deleteAssignmentAction(groupId: string, unitId: string, startDate: string) {
  console.log("[v0] Server action started for assignment deletion:", { groupId, unitId, startDate })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("assignments")
    .update({ active: false })
    .eq("group_id", groupId)
    .eq("unit_id", unitId)
    .eq("start_date", startDate)

  if (error) {
    console.error("[v0] Server action failed for assignment deletion:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for assignment deletion:", { groupId, unitId, startDate })

  revalidatePath("/")
  return { success: true }
}

export async function batchCreateAssignmentsAction(assignments: Assignment[]) {
  console.log("[v0] Server action started for batch assignment creation:", { count: assignments.length })

  if (assignments.length === 0) {
    return { success: true, count: 0 }
  }

  const payload = assignments.map((assignment) => ({
    group_id: assignment.group_id,
    unit_id: assignment.unit_id,
    start_date: assignment.start_date,
    end_date: assignment.end_date,
    active: assignment.active ?? true,
  }))

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from("assignments").insert(payload)

  if (error) {
    console.error("[v0] Server action failed for batch assignment creation:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for batch assignment creation:", { count: assignments.length })

  revalidatePath("/")
  return { success: true, count: assignments.length }
}

export async function batchDeleteAssignmentsAction(assignments: { groupId: string; unitId: string; startDate: string }[]) {
  console.log("[v0] Server action started for batch assignment deletion:", { count: assignments.length })

  if (assignments.length === 0) {
    return { success: true, count: 0 }
  }

  const supabase = await createSupabaseServerClient()

  const errors: string[] = []

  for (const assignment of assignments) {
    const { error } = await supabase
      .from("assignments")
      .update({ active: false })
      .eq("group_id", assignment.groupId)
      .eq("unit_id", assignment.unitId)
      .eq("start_date", assignment.startDate)

    if (error) {
      console.error("[v0] Server action failed during batch assignment deletion:", error)
      errors.push(error.message)
    }
  }

  if (errors.length > 0) {
    return { success: false, error: errors.join("; ") }
  }

  console.log("[v0] Server action completed for batch assignment deletion:", { count: assignments.length })

  revalidatePath("/")
  return { success: true, count: assignments.length }
}
