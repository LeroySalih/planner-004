import Image from "next/image"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

async function fetchUnitsCount() {
  try {
    return await withTelemetry(
      { routeTag: "/", functionName: "homeUnitsCount", params: { table: "units" } },
      async () => {
        const { rows } = await query<{ count: string }>("select count(*)::text as count from units")
        const parsed = Number(rows[0]?.count ?? 0)
        return Number.isFinite(parsed) ? parsed : 0
      },
    )
  } catch (error) {
    console.error("[home] failed to fetch units count", error)
    return null
  }
}

const Home = async () => {
  const unitsCount = await fetchUnitsCount()
  const status = unitsCount === null ? "Unable to reach database" : "Connection successful"

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 sm:px-8">
      <Image
        src="/header.png"
        alt="Planner"
        width={480}
        height={160}
        priority
        className="h-auto w-full max-w-[420px] sm:max-w-[480px]"
      />

      <div className="mt-8 w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Database connection</p>
            <p className="text-base font-semibold">{status}</p>
          </div>
          <span
            className={`h-3 w-3 rounded-full ${
              unitsCount === null ? "bg-destructive" : "bg-emerald-500"
            }`}
            aria-hidden
          />
        </div>
        {unitsCount !== null && (
          <p className="mt-3 text-sm text-muted-foreground">Units table row count: {unitsCount}</p>
        )}
      </div>
    </div>
  )
}

export default Home
