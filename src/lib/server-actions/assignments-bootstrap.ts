"use server"

import { withTelemetry } from "@/lib/telemetry"
import { query } from "@/lib/db"
import { AssignmentsBootstrapPayloadSchema, type AssignmentsBootstrapPayload } from "@/types"

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
        const { rows } = await query<{ payload: AssignmentsBootstrapPayload }>(
          "select assignments_bootstrap() as payload",
        )

        const payload = rows[0]?.payload ?? null
        if (!payload) {
          return { data: null, error: "Unable to load assignments bootstrap data." }
        }

        const parsed = AssignmentsBootstrapPayloadSchema.safeParse(payload)
        if (!parsed.success) {
          console.error("[assignments-bootstrap] Invalid bootstrap payload", parsed.error)
          return { data: null, error: "Received malformed assignments bootstrap data." }
        }

        return { data: parsed.data, error: null }
      } catch (error) {
        console.error("[assignments-bootstrap] Failed to load bootstrap data", error)
        const message = error instanceof Error ? error.message : "Unable to load assignments bootstrap."
        return { data: null, error: message }
      }
    },
  )
}
