"use client"

import { useEffect, useMemo, useState } from "react"
import { createBrowserClient } from "@supabase/ssr"

type CheckStatus = "pending" | "ok" | "fail"

interface ClientEnvSnapshot {
  supabaseUrl: string | null | undefined
  supabaseAnonKey: string | null | undefined
}

interface ClientCheckResult {
  label: string
  status: CheckStatus
  summary: string
  details: Record<string, unknown>
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

function formatDetails(details: Record<string, unknown>) {
  return JSON.stringify(details, null, 2)
}

export function ClientSupabaseStatus({ env }: { env: ClientEnvSnapshot }) {
  const supabaseUrl = env.supabaseUrl ?? null
  const supabaseAnonKey = env.supabaseAnonKey ?? null

  const envDetails = useMemo(
    () => ({
      supabaseUrl,
      supabaseAnonKey,
    }),
    [supabaseUrl, supabaseAnonKey]
  )
  const [checks, setChecks] = useState<ClientCheckResult[]>(() => [
    {
      label: "Supabase Database (Client)",
      status: "pending",
      summary: "Running connectivity check...",
      details: { env: envDetails },
    },
    {
      label: "Supabase Auth (Client)",
      status: "pending",
      summary: "Running connectivity check...",
      details: { env: envDetails },
    },
  ])

  const authHealthUrl = useMemo(() => {
    if (!supabaseUrl) return null
    return `${supabaseUrl}/auth/v1/health`
  }, [supabaseUrl])

  useEffect(() => {
    let cancelled = false

    async function runChecks() {
      if (!supabaseUrl || !supabaseAnonKey) {
        const failureDetails = { env: envDetails }
        if (!cancelled) {
          setChecks([
            {
              label: "Supabase Database (Client)",
              status: "fail",
              summary: "Missing Supabase URL or anon key for client database access",
              details: failureDetails,
            },
            {
              label: "Supabase Auth (Client)",
              status: "fail",
              summary: "Missing Supabase URL or anon key for client auth access",
              details: failureDetails,
            },
          ])
        }
        return
      }

      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

      const dbPromise = (async () => {
        try {
          const { data, error, status, statusText } = await supabase
            .from("profiles")
            .select("user_id")
            .limit(1)

          if (error) {
            return {
              label: "Supabase Database (Client)",
              status: "fail" as CheckStatus,
              summary: "Client query against profiles.user_id failed",
              details: { env: envDetails, status, statusText, error },
            }
          }

          return {
            label: "Supabase Database (Client)",
            status: "ok" as CheckStatus,
            summary: "Client successfully queried profiles.user_id",
            details: { env: envDetails, status, statusText, rowCount: data?.length ?? 0, rows: data },
          }
        } catch (error) {
          return {
            label: "Supabase Database (Client)",
            status: "fail" as CheckStatus,
            summary: "Unexpected client error when querying Supabase",
            details: { env: envDetails, error: serializeError(error) },
          }
        }
      })()

      const authPromise = (authHealthUrl
        ? fetch(authHealthUrl, {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
            },
          })
            .then(async (response) => {
              const bodyText = await response.text()

              if (!response.ok) {
                return {
                  label: "Supabase Auth (Client)",
                  status: "fail" as CheckStatus,
                  summary: `Client auth health check responded with ${response.status}`,
                  details: {
                    env: envDetails,
                    status: response.status,
                    statusText: response.statusText,
                    body: bodyText,
                  },
                }
              }

              return {
                label: "Supabase Auth (Client)",
                status: "ok" as CheckStatus,
                summary: "Client auth health endpoint responded successfully",
                details: {
                  env: envDetails,
                  status: response.status,
                  statusText: response.statusText,
                  body: bodyText,
                },
              }
            })
            .catch((error) => ({
              label: "Supabase Auth (Client)",
              status: "fail" as CheckStatus,
              summary: "Unexpected client error when calling auth health endpoint",
              details: { env: envDetails, error: serializeError(error) },
            }))
        : Promise.resolve({
            label: "Supabase Auth (Client)",
            status: "fail" as CheckStatus,
            summary: "Missing Supabase URL for client auth health check",
            details: { env: envDetails },
          }))

      const results = await Promise.all([dbPromise, authPromise])

      if (!cancelled) {
        setChecks(results)
      }
    }

    runChecks()

    return () => {
      cancelled = true
    }
  }, [authHealthUrl, supabaseAnonKey, supabaseUrl, envDetails])

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-lg font-medium">Client-Side Connectivity</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Results below reflect checks executed in the browser after this page loaded.
      </p>

      {checks.map((check) => (
        <div key={check.label} className="mt-6 rounded-md border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-medium">{check.label}</h3>
            <span
              className={`rounded px-3 py-1 text-sm font-semibold ${
                check.status === "ok"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : check.status === "pending"
                    ? "bg-muted text-muted-foreground"
                    : "bg-destructive/10 text-destructive"
              }`}
            >
              {check.status === "ok" ? "OK" : check.status === "pending" ? "PENDING" : "FAIL"}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{check.summary}</p>
          <pre className="mt-4 overflow-x-auto rounded bg-muted p-4 text-xs">{formatDetails(check.details)}</pre>
        </div>
      ))}
    </section>
  )
}
