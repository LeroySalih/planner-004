"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { UnitsSchema } from "@/types"
import { supabaseServer } from "@/lib/supabaseClient"

const UnitsReturnValue = z.object({
  data: UnitsSchema.nullable(),
  error: z.string().nullable(),
})

export async function createUnitAction(unitId: string, title: string, subject: string) {
  console.log("[v0] Server action started for unit creation:", { unitId, title, subject })

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for unit creation:", { unitId, title, subject })

  revalidatePath("/")
  revalidatePath("/units")
  return { success: true, unitId, title, subject }
}

export async function readUnitAction(unitId: string) {
  console.log("[v0] Server action started for reading unit:", { unitId })

  await new Promise((resolve) => setTimeout(resolve, 1000))

  console.log("[v0] Server action completed for reading unit:", { unitId })

  revalidatePath("/units")
  return { success: true, unitId }
}

export async function readUnitsAction() {
  console.log("[v0] Server action started for reading units:")

  let error: string | null = null

  const { data, error: readError } = await supabaseServer
    .from("units")
    .select("*")
    .eq("active", true)

  if (readError) {
    error = readError.message
    console.error(error)
  }

  console.log("[v0] Server action completed for reading units:", error)

  return UnitsReturnValue.parse({ data, error })
}

export async function updateUnitAction(unitId: string, title: string, subject: string) {
  console.log("[v0] Server action started for unit update:", { unitId, title, subject })

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for unit update:", { unitId, title, subject })

  revalidatePath("/")
  revalidatePath("/units")
  return { success: true, unitId, title, subject }
}

export async function deleteUnitAction(unitId: string) {
  console.log("[v0] Server action started for unit deletion:", { unitId })

  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log("[v0] Server action completed for unit deletion:", { unitId })

  revalidatePath("/")
  revalidatePath("/units")
  return { success: true, unitId }
}
