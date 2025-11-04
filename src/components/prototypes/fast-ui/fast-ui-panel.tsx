"use client"

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { FAST_UI_INITIAL_STATE, FAST_UI_MAX_COUNTER } from "@/lib/prototypes/fast-ui"
import { supabaseBrowserClient } from "@/lib/supabase-browser"
import { FastUiRealtimePayloadSchema, type FastUiActionState } from "@/types"

const CHANNEL_NAME = "fast_ui_updates"
const SUCCESS_EVENT = "fast_ui:completed"
const ERROR_EVENT = "fast_ui:error"

type FastUiPanelProps = {
  action: (prevState: FastUiActionState, formData: FormData) => Promise<FastUiActionState>
  initialState?: FastUiActionState
}

type JobStatus = {
  jobId: string
  status: "queued" | "completed" | "error"
  message: string
}

export function FastUiPanel({ action, initialState = FAST_UI_INITIAL_STATE }: FastUiPanelProps) {
  const [counter, setCounter] = useState(0)
  const [statusMessage, setStatusMessage] = useState("Waiting for updates…")
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const confirmedCounterRef = useRef(0)
  const jobTimeoutsRef = useRef(new Map<string, number>())
  const toastLedgerRef = useRef(new Set<string>())

  const [actionState, formAction, pending] = useActionState(action, initialState)

  const inFlightJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued"),
    [jobs],
  )

  useEffect(() => {
    if (actionState.status === "queued" && actionState.jobId) {
      const queuedJobId = actionState.jobId

      setJobs((prev) => {
        if (prev.some((job) => job.jobId === queuedJobId)) {
          return prev
        }

        return [
          ...prev,
          { jobId: queuedJobId, status: "queued", message: "Processing…" },
        ]
      })

      if (!jobTimeoutsRef.current.has(queuedJobId)) {
        const timeoutId = window.setTimeout(() => {
          setJobs((prev) =>
            prev.map((job) =>
              job.jobId === queuedJobId
                ? { jobId: job.jobId, status: "completed", message: "Completed (fallback)" }
                : job,
            ),
          )
          const fallbackValue = Math.min(confirmedCounterRef.current + 1, FAST_UI_MAX_COUNTER)
          confirmedCounterRef.current = fallbackValue
          setCounter(fallbackValue)
          setStatusMessage(
            `Job ${queuedJobId.slice(0, 8)} completed (fallback). Counter may lag without realtime.`,
          )
          if (fallbackValue >= FAST_UI_MAX_COUNTER) {
            setStatusMessage("Counter limit reached. No further updates will be accepted.")
          }
          if (!toastLedgerRef.current.has(queuedJobId)) {
            toastLedgerRef.current.add(queuedJobId)
            toast.success("Counter updated", {
              description: `Fallback completion. Counter is ${fallbackValue}.`,
            })
          }
          jobTimeoutsRef.current.delete(queuedJobId)
        }, 12_000)

        jobTimeoutsRef.current.set(queuedJobId, timeoutId)
      }

      setStatusMessage(`Queued job ${queuedJobId.slice(0, 8)}…`)
    } else if (actionState.status === "error" && actionState.message) {
      setCounter(confirmedCounterRef.current)
      setStatusMessage(actionState.message)
      toast.error("Update failed", { description: actionState.message })
    }
  }, [actionState])

  useEffect(() => {
    const channel = supabaseBrowserClient.channel(CHANNEL_NAME)

    channel.on("broadcast", { event: SUCCESS_EVENT }, (event) => {
      const parsed = FastUiRealtimePayloadSchema.safeParse(event.payload)
      if (!parsed.success) {
        console.warn("[fast-ui] received invalid success payload", parsed.error)
        return
      }

      const payload = parsed.data
      const timeoutId = jobTimeoutsRef.current.get(payload.job_id)
      if (timeoutId) {
        window.clearTimeout(timeoutId)
        jobTimeoutsRef.current.delete(payload.job_id)
      }

      const nextValue = Math.max(confirmedCounterRef.current, payload.counter_value)
      confirmedCounterRef.current = nextValue
      setCounter(nextValue)
      setJobs((prev) => {
        const nextJob: JobStatus = {
          jobId: payload.job_id,
          status: "completed",
          message: payload.message ?? "Completed",
        }

        if (!prev.some((job) => job.jobId === payload.job_id)) {
          return [...prev, nextJob]
        }

        return prev.map((job) => (job.jobId === payload.job_id ? nextJob : job))
      })
      setStatusMessage(
        `Job ${payload.job_id.slice(0, 8)} completed. Counter synced to ${payload.counter_value}.`,
      )
      if (nextValue >= FAST_UI_MAX_COUNTER) {
        setStatusMessage("Counter limit reached. No further updates will be accepted.")
      }
      if (!toastLedgerRef.current.has(payload.job_id)) {
        toastLedgerRef.current.add(payload.job_id)
        toast.success("Counter updated", { description: `Counter is now ${nextValue}.` })
      }
    })

    channel.on("broadcast", { event: ERROR_EVENT }, (event) => {
      const parsed = FastUiRealtimePayloadSchema.safeParse(event.payload)
      if (!parsed.success) {
        console.warn("[fast-ui] received invalid error payload", parsed.error)
        return
      }

      const payload = parsed.data
      const timeoutId = jobTimeoutsRef.current.get(payload.job_id)
      if (timeoutId) {
        window.clearTimeout(timeoutId)
        jobTimeoutsRef.current.delete(payload.job_id)
      }

      setCounter(confirmedCounterRef.current)
      setJobs((prev) => {
        const nextJob: JobStatus = {
          jobId: payload.job_id,
          status: "error",
          message: payload.message ?? "Failed",
        }

        if (!prev.some((job) => job.jobId === payload.job_id)) {
          return [...prev, nextJob]
        }

        return prev.map((job) => (job.jobId === payload.job_id ? nextJob : job))
      })
      setStatusMessage(
        `Job ${payload.job_id.slice(0, 8)} failed. Counter remains at ${payload.counter_value}.`,
      )
      if (!toastLedgerRef.current.has(payload.job_id)) {
        toastLedgerRef.current.add(payload.job_id)
        toast.error("Update failed", {
          description: payload.message ?? "The operation did not complete successfully.",
        })
      }
    })

    const subscription = channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setStatusMessage("Connected to realtime channel. Trigger an update to begin.")
      }
    })

    if (subscription instanceof Promise) {
      subscription.catch((error) => {
        console.error("[fast-ui] failed to subscribe to realtime channel", error)
        setStatusMessage("Failed to connect to realtime updates.")
      })
    }

    return () => {
      jobTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
      jobTimeoutsRef.current.clear()
      toastLedgerRef.current.clear()
      void supabaseBrowserClient.removeChannel(channel)
    }
  }, [])

  const handleSubmit = useCallback(
    (_event: FormEvent<HTMLFormElement>) => {
      setCounter((value) => {
        confirmedCounterRef.current = value
        return value + 1
      })
      setStatusMessage("Queued update…")
    },
    [],
  )

  return (
    <div className="space-y-6 rounded-lg border border-border bg-card p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Optimistic counter value</p>
        <p data-testid="fast-ui-counter-value" className="text-3xl font-semibold text-foreground">
          {counter}
        </p>
      </div>

      <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="counter" value={counter + 1} readOnly />
        <Button data-testid="fast-ui-increment" type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : (
            "Increment counter"
          )}
        </Button>
      </form>

      <div className="space-y-1 text-sm">
        <p className="font-medium text-foreground">Status</p>
        <p data-testid="fast-ui-status" className="text-muted-foreground">
          {statusMessage}
        </p>
        {inFlightJobs.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            In flight: {inFlightJobs.length} job{inFlightJobs.length > 1 ? "s" : ""}.
          </p>
        ) : null}
      </div>

      {jobs.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {jobs.map((job) => (
            <li key={job.jobId} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="font-mono text-xs text-muted-foreground">{job.jobId.slice(0, 8)}</span>
              <span
                className={
                  job.status === "completed"
                    ? "text-emerald-500"
                    : job.status === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }
              >
                {job.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
