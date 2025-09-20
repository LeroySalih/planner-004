"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { UnitSchema, UnitsSchema } from "@/types"
import { supabaseServer } from "@/lib/supabaseClient"

const UnitsReturnValue = z.object({
  data: UnitsSchema.nullable(),
  error: z.string().nullable(),
})

const UnitReturnValue = z.object({
  data: UnitSchema.nullable(),
  error: z.string().nullable(),
})

export async function createUnitAction(
  unitId: string,
  title: string,
  subject: string,
  description: string | null = null,
) {
  console.log("[v0] Server action started for unit creation:", { unitId, title, subject })

  const { data, error } = await supabaseServer
    .from("units")
    .insert({
      unit_id: unitId,
      title,
      subject,
      description,
      active: true,
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Server action failed for unit creation:", error)
    return UnitReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for unit creation:", { unitId, title, subject })

  revalidatePath("/")
  revalidatePath("/units")
  revalidatePath("/assignments")
  return UnitReturnValue.parse({ data, error: null })
}

export async function readUnitAction(unitId: string) {
  console.log("[v0] Server action started for reading unit:", { unitId })

  const { data, error } = await supabaseServer
    .from("units")
    .select("*")
    .eq("unit_id", unitId)
    .maybeSingle()

  if (error) {
    console.error("[v0] Server action failed for reading unit:", error)
    return UnitReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for reading unit:", { unitId })

  return UnitReturnValue.parse({ data, error: null })
}

export async function readUnitsAction() {
  console.log("[v0] Server action started for reading units:")

  let error: string | null = null

  const { data, error: readError } = await supabaseServer
    .from("units")
    .select("*")

  if (readError) {
    error = readError.message
    console.error(error)
  }

  console.log("[v0] Server action completed for reading units:", error)

  return UnitsReturnValue.parse({ data, error })
}

export async function updateUnitAction(
  unitId: string,
  updates: { title: string; subject: string; description?: string | null; active?: boolean },
) {
  console.log("[v0] Server action started for unit update:", { unitId, updates })

  const payload: Record<string, unknown> = {
    title: updates.title,
    subject: updates.subject,
    description: updates.description ?? null,
  }

  if (typeof updates.active === "boolean") {
    payload.active = updates.active
  }

  const { data, error } = await supabaseServer
    .from("units")
    .update(payload)
    .eq("unit_id", unitId)
    .select()
    .single()

  if (error) {
    console.error("[v0] Server action failed for unit update:", error)
    return UnitReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for unit update:", { unitId })

  revalidatePath("/")
  revalidatePath("/units")
  revalidatePath("/assignments")
  revalidatePath(`/units/${unitId}`)
  return UnitReturnValue.parse({ data, error: null })
}

export async function deleteUnitAction(unitId: string) {
  console.log("[v0] Server action started for unit deletion:", { unitId })

  const { error } = await supabaseServer
    .from("units")
    .update({ active: false })
    .eq("unit_id", unitId)

  if (error) {
    console.error("[v0] Server action failed for unit deletion:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for unit deletion:", { unitId })

  revalidatePath("/")
  revalidatePath("/units")
  revalidatePath("/assignments")
  revalidatePath(`/units/${unitId}`)
  return { success: true, unitId }
}
