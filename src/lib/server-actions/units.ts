"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { UnitSchema, UnitsSchema } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

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
  year: number | null = null,
) {
  console.log("[v0] Server action started for unit creation:", { unitId, title, subject, year })

  const supabase = await createSupabaseServerClient()

  const sanitizedYear =
    typeof year === "number" && Number.isFinite(year)
      ? Math.min(Math.max(Math.trunc(year), 1), 13)
      : null

  let attempt = 0
  let finalUnitId = unitId
  let lastError: { message: string } | null = null

  while (attempt < 5) {
    const { data, error } = await supabase
      .from("units")
      .insert({
        unit_id: finalUnitId,
        title,
        subject,
        description,
        year: sanitizedYear,
        active: true,
      })
      .select()
      .single()

    if (!error) {
      console.log("[v0] Server action completed for unit creation:", {
        unitId: finalUnitId,
        title,
        subject,
        year: sanitizedYear,
      })

      revalidatePath("/")
      revalidatePath("/units")
      revalidatePath("/assignments")
      return UnitReturnValue.parse({ data, error: null })
    }

    lastError = error

    if (error.code === "23505" && error.message?.includes("units_pkey")) {
      attempt += 1
      finalUnitId = `${unitId}-${Date.now()}-${attempt}`
      console.warn(
        "[v0] Duplicate unit_id detected, retrying with suffix",
        { attempt, finalUnitId },
      )
      continue
    }

    console.error("[v0] Server action failed for unit creation:", error)
    return UnitReturnValue.parse({ data: null, error: error.message })
  }

  console.error("[v0] Server action failed for unit creation after retries:", lastError)
  return UnitReturnValue.parse({ data: null, error: lastError?.message ?? "Unable to create unit" })
}

export async function readUnitAction(unitId: string) {
  console.log("[v0] Server action started for reading unit:", { unitId })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
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

  const supabase = await createSupabaseServerClient()

  const { data, error: readError } = await supabase
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
  updates: { title: string; subject: string; description?: string | null; active?: boolean; year?: number | null },
) {
  console.log("[v0] Server action started for unit update:", { unitId, updates })

  const supabase = await createSupabaseServerClient()

  const payload: Record<string, unknown> = {
    title: updates.title,
    subject: updates.subject,
    description: updates.description ?? null,
  }

  if (Object.prototype.hasOwnProperty.call(updates, "year")) {
    payload.year = typeof updates.year === "number" ? updates.year : null
  }

  if (typeof updates.active === "boolean") {
    payload.active = updates.active
  }

  const { data, error } = await supabase
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

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
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
