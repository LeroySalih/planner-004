import Image from "next/image"

import { query } from "@/lib/db"
import { withTelemetry } from "@/lib/telemetry"

export const dynamic = "force-dynamic"

const REQUIRED_ENV_VARS = ["DATABASE_URL"]

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
    return error instanceof Error ? error.message : String(error)
  }
}

function readEnvStatus() {
  const seen = REQUIRED_ENV_VARS.map((name) => ({
    name,
    hasValue: Boolean(process.env[name]?.trim()),
  }))
  const present = seen.filter((entry) => entry.hasValue).length
  return { seen, present, total: seen.length }
}

const Home = async () => {
  const unitsCount = await fetchUnitsCount()
  const status = typeof unitsCount === "string" ? "Unable to reach database" : "Connection successful"
  const envStatus = readEnvStatus()

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
        {typeof unitsCount === "string" ? (
          <p className="mt-3 text-sm text-destructive">Error: {unitsCount}</p>
        ) : unitsCount !== null ? (
          <p className="mt-3 text-sm text-muted-foreground">Units table row count: {unitsCount}</p>
        ) : null}
      </div>

      <div className="mt-4 w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Environment readiness</p>
            <p className="text-base font-semibold">
              {envStatus.present}/{envStatus.total} required vars set
            </p>
          </div>
          <span
            className={`h-3 w-3 rounded-full ${
              envStatus.present === envStatus.total ? "bg-emerald-500" : "bg-amber-500"
            }`}
            aria-hidden
          />
        </div>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {envStatus.seen.map((entry) => (
            <li key={entry.name} className="flex items-center justify-between">
              <span className="font-mono text-xs sm:text-sm">{entry.name}</span>
              <span className={`ml-3 h-2.5 w-2.5 rounded-full ${entry.hasValue ? "bg-emerald-500" : "bg-destructive"}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default Home
