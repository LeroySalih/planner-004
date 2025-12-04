"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { Loader2, WifiOff, Wifi as WifiOn } from "lucide-react"

import type { TestSseActionState } from "@/app/test-sse/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type IncrementAction = (
  prevState: TestSseActionState,
  formData: FormData,
) => Promise<TestSseActionState>

type TestSseClientProps = {
  action: IncrementAction
  initialState: TestSseActionState
  streamPath?: string
}

type ConnectionState = "connecting" | "open" | "error"

const STREAM_PATH = "/sse?topics=test-sse"

export function TestSseClient({
  action,
  initialState,
  streamPath = STREAM_PATH,
}: TestSseClientProps) {
  const [counter, setCounter] = useState(initialState.counter)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting")

  const [actionState, formAction, pending] = useActionState<TestSseActionState, FormData>(
    action,
    initialState,
  )

  const connectionLabel = useMemo(() => {
    switch (connectionState) {
      case "open":
        return "Live connection"
      case "error":
        return "Reconnecting…"
      default:
        return "Connecting…"
    }
  }, [connectionState])

  useEffect(() => {
    const eventSource = new EventSource(streamPath)

    eventSource.onopen = () => {
      setConnectionState("open")
      setLastMessage("Connected to stream.")
    }

    eventSource.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as {
          topic?: string
          type?: string
          payload?: { value?: unknown }
        }
        const value = envelope?.payload?.value
        if (typeof value === "number") {
          setCounter(value)
          setLastMessage(`Received ${envelope.type ?? "update"}: ${value}`)
        }
      } catch (error) {
        console.warn("[test-sse] failed to parse event payload", error)
      }
    }

    eventSource.onerror = () => {
      setConnectionState("error")
      setLastMessage("Lost connection. Waiting to reconnect…")
    }

    return () => {
      eventSource.close()
    }
  }, [streamPath])

  useEffect(() => {
    if (actionState.status === "updated") {
      setCounter(actionState.counter)
      setLastMessage(actionState.message ?? null)
    } else if (actionState.status === "error") {
      setLastMessage(actionState.message ?? "Failed to update counter.")
    }
  }, [actionState])

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Server-Sent Events</CardTitle>
          <CardDescription>
            Subscribe to a shared counter stream and broadcast updates to every connected tab.
          </CardDescription>
        </div>
        <Badge
          variant={connectionState === "open" ? "secondary" : "outline"}
          className={cn(
            "gap-2",
            connectionState === "error" && "border-destructive text-destructive",
          )}
        >
          {connectionState === "open" ? <WifiOn className="size-4" /> : <WifiOff className="size-4" />}
          {connectionLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-baseline gap-3">
          <p className="text-sm text-muted-foreground">Current counter</p>
          <p className="text-4xl font-semibold tracking-tight">{counter}</p>
        </div>
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending event…
              </>
            ) : (
              "Send counter event"
            )}
          </Button>
          <p className="text-sm text-muted-foreground">
            Click to increment on the server and broadcast to all open clients.
          </p>
        </form>
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {lastMessage ?? "No updates yet. Open another tab to watch live events."}
        </div>
      </CardContent>
    </Card>
  )
}
