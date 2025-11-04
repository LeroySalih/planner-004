"use server"

import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  UnitSchema,
  UnitsSchema,
  UnitJobPayloadSchema,
  UnitMutationStateSchema,
} from "@/types"
import { requireTeacherProfile } from "@/lib/auth"
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server"
import { withTelemetry } from "@/lib/telemetry"

const UnitsReturnValue = z.object({
  data: UnitsSchema.nullable(),
  error: z.string().nullable(),
})

const UnitReturnValue = z.object({
  data: UnitSchema.nullable(),
  error: z.string().nullable(),
})

const UNIT_ROUTE_TAG = "/units/[unitId]"
const UNIT_CHANNEL_NAME = "unit_updates"
const UNIT_UPDATE_EVENT = "unit:update"
const UNIT_DEACTIVATE_EVENT = "unit:deactivate"
const UNIT_CHANNEL_BROADCAST = { config: { broadcast: { ack: true } } }

const UnitUpdateFormSchema = z.object({
  unitId: z.string(),
  title: z.string(),
  subject: z.string(),
  description: z.string().optional(),
  year: z.string().optional(),
})

const UnitDeactivateFormSchema = z.object({
  unitId: z.string(),
})

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>

async function revalidateUnitPaths(unitId: string) {
  void unitId
}

async function publishUnitJobEvent(
  supabase: SupabaseClient,
  event: string,
  payloadInput: z.input<typeof UnitJobPayloadSchema>,
) {
  const payload = UnitJobPayloadSchema.parse(payloadInput)
  const channel = supabase.channel(UNIT_CHANNEL_NAME, UNIT_CHANNEL_BROADCAST)

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const result = channel.subscribe((status) => {
        if (settled) return
        if (status === "SUBSCRIBED") {
          settled = true
          resolve()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          settled = true
          reject(new Error(`Realtime channel subscription failed with status: ${status}`))
        }
      })

      if (result instanceof Promise) {
        result.catch((error) => {
          if (!settled) {
            settled = true
            reject(error)
          }
        })
      }
    })

    const { error } = await channel.send({
      type: "broadcast",
      event,
      payload,
    })

    if (error) {
      throw new Error(error.message)
    }

    console.info("[units] published unit job event", { event, jobId: payload.job_id, unitId: payload.unit_id })
  } finally {
    await supabase.removeChannel(channel)
  }
}

type UnitUpdateJobArgs = {
  supabase: SupabaseClient
  jobId: string
  unitId: string
  updates: {
    title: string
    subject: string
    description: string | null
    year: number | null
  }
}

async function runUnitUpdateJob({ supabase, jobId, unitId, updates }: UnitUpdateJobArgs) {
  try {
    const payload: Record<string, unknown> = {
      title: updates.title,
      subject: updates.subject,
      description: updates.description,
    }

    if (updates.year !== undefined) {
      payload.year = updates.year
    }

    const { data, error } = await supabase
      .from("units")
      .update(payload)
      .eq("unit_id", unitId)
      .select()
      .single()

    if (error) {
      throw error
    }

    await revalidateUnitPaths(unitId)
    await publishUnitJobEvent(supabase, UNIT_UPDATE_EVENT, {
      job_id: jobId,
      unit_id: unitId,
      status: "completed",
      operation: "update",
      message: "Unit updated successfully",
      unit: data ?? null,
    })
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message ?? "Failed to update unit")
        : "Failed to update unit"
    console.error("[units] async update job failed", { unitId, jobId, error })

    try {
      await publishUnitJobEvent(supabase, UNIT_UPDATE_EVENT, {
        job_id: jobId,
        unit_id: unitId,
        status: "error",
        operation: "update",
        message,
        unit: null,
      })
    } catch (notifyError) {
      console.error("[units] failed to publish update error event", { jobId, notifyError })
    }
  }
}

type UnitDeactivateJobArgs = {
  supabase: SupabaseClient
  jobId: string
  unitId: string
}

async function runUnitDeactivateJob({ supabase, jobId, unitId }: UnitDeactivateJobArgs) {
  try {
    const { error } = await supabase.from("units").update({ active: false }).eq("unit_id", unitId)

    if (error) {
      throw error
    }

    await revalidateUnitPaths(unitId)
    await publishUnitJobEvent(supabase, UNIT_DEACTIVATE_EVENT, {
      job_id: jobId,
      unit_id: unitId,
      status: "completed",
      operation: "deactivate",
      message: "Unit deactivated successfully",
      unit: null,
    })
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message ?? "Failed to deactivate unit")
        : "Failed to deactivate unit"
    console.error("[units] async deactivate job failed", { unitId, jobId, error })

    try {
      await publishUnitJobEvent(supabase, UNIT_DEACTIVATE_EVENT, {
        job_id: jobId,
        unit_id: unitId,
        status: "error",
        operation: "deactivate",
        message,
        unit: null,
      })
    } catch (notifyError) {
      console.error("[units] failed to publish deactivate error event", { jobId, notifyError })
    }
  }
}

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

export async function triggerUnitUpdateJobAction(
  _prevState: z.infer<typeof UnitMutationStateSchema>,
  formData: FormData,
) {
  const profile = await requireTeacherProfile()
  const authEnd = performance.now()

  const unitIdValue = formData.get("unitId")
  const formUnitId = typeof unitIdValue === "string" ? unitIdValue : ""
  const paramsUnitId = formUnitId.trim().length > 0 ? formUnitId.trim() : null

  return withTelemetry(
    {
      routeTag: UNIT_ROUTE_TAG,
      functionName: "triggerUnitUpdateJobAction",
      params: { unitId: paramsUnitId },
      authEndTime: authEnd,
    },
    async () => {
      const parsedForm = UnitUpdateFormSchema.safeParse({
        unitId: formUnitId,
        title: typeof formData.get("title") === "string" ? formData.get("title") ?? "" : "",
        subject: typeof formData.get("subject") === "string" ? formData.get("subject") ?? "" : "",
        description: typeof formData.get("description") === "string" ? formData.get("description") ?? "" : "",
        year: typeof formData.get("year") === "string" ? formData.get("year") ?? "" : "",
      })

      if (!parsedForm.success) {
        console.warn("[units] invalid form submission for unit update", {
          issues: parsedForm.error.issues,
        })
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Invalid unit data submitted.",
        })
      }

      const trimmedUnitId = parsedForm.data.unitId.trim()
      const trimmedTitle = parsedForm.data.title.trim()
      const trimmedSubject = parsedForm.data.subject.trim()
      const descriptionValue = parsedForm.data.description.trim()
      const sanitizedDescription = descriptionValue.length > 0 ? descriptionValue : null
      const trimmedYear = parsedForm.data.year.trim()

      if (!trimmedUnitId || !trimmedTitle || !trimmedSubject) {
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Unit id, title, and subject are required.",
        })
      }

      let parsedYear: number | null = null
      if (trimmedYear.length > 0) {
        const numericYear = Number.parseInt(trimmedYear, 10)
        if (!Number.isFinite(numericYear) || numericYear < 1 || numericYear > 13) {
          return UnitMutationStateSchema.parse({
            status: "error",
            jobId: null,
            message: "Year must be a number between 1 and 13.",
          })
        }
        parsedYear = numericYear
      }

      const supabase = await createSupabaseServiceClient()
      const jobId = randomUUID()

      queueMicrotask(() => {
        void runUnitUpdateJob({
          supabase,
          jobId,
          unitId: trimmedUnitId,
          updates: {
            title: trimmedTitle,
            subject: trimmedSubject,
            description: sanitizedDescription,
            year: parsedYear,
          },
        })
      })

      console.info("[units] queued unit update job", {
        jobId,
        unitId: trimmedUnitId,
        userId: profile.userId,
      })

      return UnitMutationStateSchema.parse({
        status: "queued",
        jobId,
        message: "Unit update queued.",
      })
    },
  )
}

export async function triggerUnitDeactivateJobAction(
  _prevState: z.infer<typeof UnitMutationStateSchema>,
  formData: FormData,
) {
  const profile = await requireTeacherProfile()
  const authEnd = performance.now()

  const rawUnitId = formData.get("unitId")
  const unitId = typeof rawUnitId === "string" ? rawUnitId.trim() : ""

  return withTelemetry(
    {
      routeTag: UNIT_ROUTE_TAG,
      functionName: "triggerUnitDeactivateJobAction",
      params: { unitId: unitId || null },
      authEndTime: authEnd,
    },
    async () => {
      const parsedForm = UnitDeactivateFormSchema.safeParse({
        unitId,
      })

      if (!parsedForm.success) {
        console.warn("[units] invalid form submission for unit deactivate", {
          issues: parsedForm.error.issues,
        })
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Invalid unit selection.",
        })
      }

      const trimmedUnitId = parsedForm.data.unitId.trim()
      if (trimmedUnitId.length === 0) {
        console.warn("[units] missing unit id for deactivate job")
        return UnitMutationStateSchema.parse({
          status: "error",
          jobId: null,
          message: "Invalid unit selection.",
        })
      }

      const supabase = await createSupabaseServiceClient()
      const jobId = randomUUID()

      queueMicrotask(() => {
        void runUnitDeactivateJob({
          supabase,
          jobId,
          unitId: trimmedUnitId,
        })
      })

      console.info("[units] queued unit deactivate job", {
        jobId,
        unitId: trimmedUnitId,
        userId: profile.userId,
      })

      return UnitMutationStateSchema.parse({
        status: "queued",
        jobId,
        message: "Unit deactivation queued.",
      })
    },
  )
}
