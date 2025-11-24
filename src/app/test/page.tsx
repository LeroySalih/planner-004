import { createClient } from "@supabase/supabase-js"
import { Client } from "pg"

import { ClientSupabaseStatus } from "./client-status"

export const dynamic = "force-dynamic"

type CheckStatus = "ok" | "fail"

interface CheckResult {
  label: string
  status: CheckStatus
  summary: string
  details: Record<string, unknown>
}

interface EnvSnapshot {
  supabaseUrl: string | undefined
  supabaseAnonKey: string | undefined
  supabaseServiceRoleKey: string | undefined
  supabaseDbKey: string | undefined
  authHealthUrl: string | undefined
  postsqlUrl: string | undefined
}

function captureEnv(): EnvSnapshot {
  const supabaseUrl =
    process.env.PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.NEXT_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL

  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY

  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SERVICE_ROLE_KEY

  const postsqlUrl = process.env.POSTSQL_URL

  const supabaseDbKey = supabaseServiceRoleKey ?? supabaseAnonKey

  const authHealthUrl = supabaseUrl ? `${supabaseUrl}/auth/v1/health` : undefined

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    supabaseDbKey,
    authHealthUrl,
    postsqlUrl,
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return { error }
}

async function checkDatabase(env: EnvSnapshot): Promise<CheckResult> {
  if (!env.supabaseUrl || !env.supabaseDbKey) {
    return {
      label: "Supabase Database",
      status: "fail",
      summary: "Missing Supabase URL or key for database connectivity",
      details: { env },
    }
  }

  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseDbKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error, status, statusText } = await supabase
      .from("profiles")
      .select("user_id")
      .limit(1)

    if (error) {
      return {
        label: "Supabase Database",
        status: "fail",
        summary: "Query against profiles table failed",
        details: { env, status, statusText, error },
      }
    }

    return {
      label: "Supabase Database",
      status: "ok",
      summary: "Successfully queried profiles.user_id",
      details: { env, status, statusText, rowCount: data?.length ?? 0, rows: data },
    }
  } catch (error) {
    return {
      label: "Supabase Database",
      status: "fail",
      summary: "Unexpected error when querying Supabase",
      details: { env, error: serializeError(error) },
    }
  }
}

async function checkAuth(env: EnvSnapshot): Promise<CheckResult> {
  if (!env.authHealthUrl || !env.supabaseAnonKey) {
    return {
      label: "Supabase Auth",
      status: "fail",
      summary: "Missing Supabase auth endpoint URL or anon key",
      details: { env },
    }
  }

  try {
    const response = await fetch(env.authHealthUrl, {
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
    })

    const bodyText = await response.text()

    if (!response.ok) {
      return {
        label: "Supabase Auth",
        status: "fail",
        summary: `Auth health check responded with ${response.status}`,
        details: {
          env,
          status: response.status,
          statusText: response.statusText,
          body: bodyText,
        },
      }
    }

    return {
      label: "Supabase Auth",
      status: "ok",
      summary: "Auth health endpoint responded successfully",
      details: {
        env,
        status: response.status,
        statusText: response.statusText,
        body: bodyText,
      },
    }
  } catch (error) {
    return {
      label: "Supabase Auth",
      status: "fail",
      summary: "Unexpected error when calling auth health endpoint",
      details: { env, error: serializeError(error) },
    }
  }
}

async function checkDirectPostgres(env: EnvSnapshot): Promise<CheckResult> {
  if (!env.postsqlUrl) {
    return {
      label: "Direct Postgres (POSTSQL_URL)",
      status: "fail",
      summary: "POSTSQL_URL is not set",
      details: { env },
    }
  }

  const client = new Client({
    connectionString: env.postsqlUrl,
    ssl: { rejectUnauthorized: false },
  })

  try {
    const connectStart = Date.now()
    await client.connect()
    const connectMs = Date.now() - connectStart

    const queryStart = Date.now()
    const result = await client.query("SELECT * FROM groups;")
    const queryMs = Date.now() - queryStart

    return {
      label: "Direct Postgres (POSTSQL_URL)",
      status: "ok",
      summary: "Successfully queried groups via direct Postgres connection",
      details: {
        env: { postsqlUrl: env.postsqlUrl },
        connectMs,
        queryMs,
        rowCount: result.rowCount,
        rows: result.rows,
      },
    }
  } catch (error) {
    return {
      label: "Direct Postgres (POSTSQL_URL)",
      status: "fail",
      summary: "Direct Postgres query failed",
      details: { env: { postsqlUrl: env.postsqlUrl }, error: serializeError(error) },
    }
  } finally {
    try {
      await client.end()
    } catch {
      // ignore
    }
  }
}

function formatDetails(details: unknown) {
  return JSON.stringify(details, null, 2)
}

export default async function TestStatusPage() {
  const env = captureEnv()
  const [databaseResult, authResult, directPgResult] = await Promise.all([
    checkDatabase(env),
    checkAuth(env),
    checkDirectPostgres(env),
  ])

  const checks = [databaseResult, authResult, directPgResult]
  const clientEnv = {
    supabaseUrl: env.supabaseUrl ?? null,
    supabaseAnonKey: env.supabaseAnonKey ?? null,
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold">Supabase Service Status</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This diagnostic page attempts to contact the Supabase database and authentication services
          using the configured environment variables.
        </p>
      </header>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-lg font-medium">Environment Snapshot</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Values below reflect the raw values provided to the connectivity checks.
        </p>
        <pre className="mt-4 overflow-x-auto rounded bg-muted p-4 text-xs">{formatDetails(env)}</pre>
      </section>

      {checks.map((check) => (
        <section key={check.label} className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium">{check.label}</h2>
            <span
              className={`rounded px-3 py-1 text-sm font-semibold ${
                check.status === "ok"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {check.status === "ok" ? "OK" : "FAIL"}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{check.summary}</p>
          <pre className="mt-4 overflow-x-auto rounded bg-muted p-4 text-xs">{formatDetails(check.details)}</pre>
        </section>
      ))}

      <ClientSupabaseStatus env={clientEnv} />
    </main>
  )
}
