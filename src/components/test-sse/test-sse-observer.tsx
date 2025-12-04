"use client"

import { useEffect, useMemo, useState } from "react"
import { WifiOff, Wifi as WifiOn } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type ConnectionState = "connecting" | "open" | "error"

type TestSseObserverProps = {
  initialCounter: number
  streamPath?: string
}

const STREAM_PATH = "/test-sse/stream"

export function TestSseObserver({
  initialCounter,
  streamPath = STREAM_PATH,
}: TestSseObserverProps) {
  const [counter, setCounter] = useState(initialCounter)
  const [lastMessage, setLastMessage] = useState<string | null>(
    "Listening for server-sent events…",
  )
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting")

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
        const payload = JSON.parse(event.data) as { type?: string; value?: unknown }
        if (payload.type === "counter" && typeof payload.value === "number") {
          setCounter(payload.value)
          setLastMessage(`Received counter ${payload.value}`)
        }
      } catch (error) {
        console.warn("[test-sse-2] failed to parse event payload", error)
      }
    }

    eventSource.onerror = () => {
      setConnectionState("error")
      setLastMessage("Lost connection. Waiting to reconnect…")
    }

    return () => eventSource.close()
  }, [streamPath])

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Observer</CardTitle>
          <CardDescription>
            Read-only listener for the `/test-sse` broadcast stream. Open both pages to see updates.
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
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <p className="text-sm text-muted-foreground">Current counter</p>
          <p className="text-4xl font-semibold tracking-tight">{counter}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {lastMessage}
        </div>
      </CardContent>
    </Card>
  )
}
