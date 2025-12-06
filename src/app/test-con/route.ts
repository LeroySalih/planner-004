import { performance } from "node:perf_hooks"

import { requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const authStart = performance.now()
  await requireTeacherProfile({ refreshSessionCookie: true })
  const authEnd = performance.now()

  return withTelemetry(
    {
      routeTag: "/test-con",
      functionName: "testConnection",
      params: { table: "profiles" },
      authEndTime: authEnd,
    },
    async () => {
      try {
        const { rows } = await query<{ count: string }>("select count(*)::text as count from profiles")
        const count = Number(rows[0]?.count ?? 0)

        return Response.json({
          ok: true,
          reachable: true,
          table: "profiles",
          rowCount: Number.isFinite(count) ? count : 0,
          timings: {
            authMs: +(authEnd - authStart).toFixed(3),
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return Response.json({ ok: false, error: message }, { status: 500 })
      }
    },
  )
}
