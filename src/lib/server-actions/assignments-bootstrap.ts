"use server"

import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"

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
      try {
        const { rows } = await query("select * from assignments_bootstrap")
        return { data: rows ?? [], error: null }
      } catch (error) {
        console.error("[assignments-bootstrap] Failed to load bootstrap data", error)
        const message = error instanceof Error ? error.message : "Unable to load assignments bootstrap."
        return { data: null, error: message }
      }
    },
  )
}
