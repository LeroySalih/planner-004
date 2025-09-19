"use server"

import { revalidatePath } from "next/cache"
import type { Assignment } from "@/types/assignment"
import { supabaseServer } from "@/lib/supabaseClient"
import { GroupSchema } from "@/actions/groups/types"
import { z } from "zod"

function generateJoinCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// GROUP CRUD OPERATIONS

const ReturnValue = z.object({
  data: GroupSchema.nullable(),
  error: z.string().nullable(),
})
type ReturnType = z.infer<typeof ReturnValue>

export async function createGroupAction(groupId: string, subject: string): Promise<ReturnType> {
  const joinCode = generateJoinCode()
  console.log("[v0] Server action started for group:", { groupId, subject, joinCode })

  const { data, error } = await supabaseServer
    .from("groups")
    .insert({
      group_id: groupId,
      subject,
      join_code: joinCode,
      active: true,
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Server action failed for group:", error)
    return ReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for group:", { groupId, subject, joinCode })
  revalidatePath("/")
  return ReturnValue.parse({ data, error: null })
}
  

export async function readGroupAction(groupId: string) {
  console.log("[v0] Server action started for reading group:", { groupId })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 1000))

  console.log("[v0] Server action completed for reading group:", { groupId })

  revalidatePath("/")
  return { success: true, groupId }
}

export async function updateGroupAction(oldGroupId: string, newGroupId: string, subject: string) {
  console.log("[v0] Server action started for group update:", { oldGroupId, newGroupId, subject })

  const { error } = await supabaseServer
    .from("groups")
    .update({ group_id: newGroupId, subject })
    .eq("group_id", oldGroupId)

  if (error) {
    console.error("[v0] Server action failed for group update:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for group update:", { oldGroupId, newGroupId, subject })

  revalidatePath("/")
  return { success: true, oldGroupId, newGroupId, subject }
}

export async function deleteGroupAction(groupId: string) {
  console.log("[v0] Server action started for group deletion:", { groupId })

  const { error } = await supabaseServer
    .from("groups")
    .update({ active: false })
    .eq("group_id", groupId)

  if (error) {
    console.error("[v0] Server action failed for group deletion:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for group deletion:", { groupId })

  revalidatePath("/")
  return { success: true, groupId }
}

// UNIT CRUD OPERATIONS
export async function createUnitAction(unitId: string, title: string, subject: string) {
  console.log("[v0] Server action started for unit creation:", { unitId, title, subject })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for unit creation:", { unitId, title, subject })

  revalidatePath("/")
  revalidatePath("/units")
  return { success: true, unitId, title, subject }
}

export async function readUnitAction(unitId: string) {
  console.log("[v0] Server action started for reading unit:", { unitId })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 1000))

  console.log("[v0] Server action completed for reading unit:", { unitId })

  revalidatePath("/units")
  return { success: true, unitId }
}

export async function updateUnitAction(unitId: string, title: string, subject: string) {
  console.log("[v0] Server action started for unit update:", { unitId, title, subject })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for unit update:", { unitId, title, subject })

  revalidatePath("/")
  revalidatePath("/units")
  return { success: true, unitId, title, subject }
}

export async function deleteUnitAction(unitId: string) {
  console.log("[v0] Server action started for unit deletion:", { unitId })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for unit deletion:", { unitId })

  revalidatePath("/")
  revalidatePath("/units")
  return { success: true, unitId }
}

// ASSIGNMENT CRUD OPERATIONS
export async function createAssignmentAction(groupId: string, unitId: string, startDate: string, endDate: string) {
  console.log("[v0] Server action started for assignment creation:", { groupId, unitId, startDate, endDate })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for assignment creation:", { groupId, unitId, startDate, endDate })

  revalidatePath("/")
  return { success: true, groupId, unitId, startDate, endDate }
}

export async function readAssignmentAction(groupId: string, unitId: string) {
  console.log("[v0] Server action started for reading assignment:", { groupId, unitId })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 1000))

  console.log("[v0] Server action completed for reading assignment:", { groupId, unitId })

  revalidatePath("/")
  return { success: true, groupId, unitId }
}

export async function updateAssignmentAction(groupId: string, unitId: string, startDate: string, endDate: string) {
  console.log("[v0] Server action started for assignment update:", { groupId, unitId, startDate, endDate })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for assignment update:", { groupId, unitId, startDate, endDate })

  revalidatePath("/")
  return { success: true, groupId, unitId, startDate, endDate }
}

export async function deleteAssignmentAction(groupId: string, unitId: string) {
  console.log("[v0] Server action started for assignment deletion:", { groupId, unitId })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for assignment deletion:", { groupId, unitId })

  revalidatePath("/")
  return { success: true, groupId, unitId }
}

// BATCH OPERATIONS
export async function batchCreateAssignmentsAction(assignments: Assignment[]) {
  console.log("[v0] Server action started for batch assignment creation:", { count: assignments.length })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 3000))

  console.log("[v0] Server action completed for batch assignment creation:", { count: assignments.length })

  revalidatePath("/")
  return { success: true, count: assignments.length }
}

export async function batchDeleteAssignmentsAction(assignments: { groupId: string; unitId: string }[]) {
  console.log("[v0] Server action started for batch assignment deletion:", { count: assignments.length })

  // Simulate database operation
  await new Promise((resolve) => setTimeout(resolve, 3000))

  console.log("[v0] Server action completed for batch assignment deletion:", { count: assignments.length })

  revalidatePath("/")
  return { success: true, count: assignments.length }
}
