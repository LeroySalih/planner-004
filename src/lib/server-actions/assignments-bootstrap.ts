"use server"

import { z } from "zod"

import { AssignmentsBootstrapPayloadSchema } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { withTelemetry } from "@/lib/telemetry"

const AssignmentsBootstrapReturnSchema = z.object({
  data: AssignmentsBootstrapPayloadSchema.nullable(),
  error: z.string().nullable(),
})

export type AssignmentsBootstrapResult = z.infer<typeof AssignmentsBootstrapReturnSchema>

export async function readAssignmentsBootstrapAction(options?: { authEndTime?: number | null; routeTag?: string }) {
  const routeTag = options?.routeTag ?? "/assignments:bootstrap"

  return withTelemetry(
    {
      routeTag,
      functionName: "readAssignmentsBootstrapAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      const supabase = await createSupabaseServerClient()

      const { data, error } = await supabase.rpc("assignments_bootstrap")

      if (error) {
        console.error("[assignments] Failed to load bootstrap payload", error)
        return AssignmentsBootstrapReturnSchema.parse({ data: null, error: error.message })
      }

      const parsed = AssignmentsBootstrapPayloadSchema.safeParse(data)

      if (!parsed.success) {
        console.error("[assignments] Invalid payload from assignments_bootstrap", parsed.error)
        return AssignmentsBootstrapReturnSchema.parse({ data: null, error: "Invalid assignments payload" })
      }

      return AssignmentsBootstrapReturnSchema.parse({ data: parsed.data, error: null })
    },
  )
}
