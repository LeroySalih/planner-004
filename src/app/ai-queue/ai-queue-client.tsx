"use client"

import { useEffect, useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { readAiMarkingQueueAction, retryQueueItemAction, processQueueAction, readAiMarkingLogsAction, clearAiMarkingQueueAction, clearAiMarkingLogsAction, readChatCallsAction, clearChatCallsAction } from "@/lib/server-actions/ai-queue"
import { toast } from "sonner"
import { RefreshCw, RotateCcw, Play, MessageSquare, Activity, Trash2, Bot } from "lucide-react"
import { markStatusLabel } from "@/lib/mark-status"

export default function AiQueuePage() {
  const [data, setData] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [chatCalls, setChatCalls] = useState<any[]>([])
  const [stats, setStats] = useState<any>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  const loadData = async () => {
    setIsLoading(true)
    const [queueResult, logsResult, chatResult] = await Promise.all([
      readAiMarkingQueueAction(),
      readAiMarkingLogsAction(),
      readChatCallsAction()
    ])

    if (queueResult.success) {
      setData(queueResult.data || [])
      setStats(queueResult.stats || {})
    } else {
      toast.error(queueResult.error || "Failed to load queue")
    }

    if (logsResult.success) {
      setLogs(logsResult.data || [])
    }

    if (chatResult.success) {
      setChatCalls(chatResult.data || [])
    }

    setIsLoading(false)
  }

  useEffect(() => {
    loadData()
    // Auto-refresh every 10 seconds
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleRetry = (queueId: string) => {
    startTransition(async () => {
      const result = await retryQueueItemAction(queueId)
      if (result.success) {
        toast.success("Item queued for retry")
        loadData()
      } else {
        toast.error("Failed to retry item")
      }
    })
  }

  const handleProcessQueue = () => {
    startTransition(async () => {
      const result = await processQueueAction()
      if (result.success) {
        toast.success("Queue processing triggered")
        setTimeout(loadData, 1000)
      } else {
        toast.error("Failed to trigger queue processing")
      }
    })
  }

  const handleClearQueue = () => {
    if (!confirm("Are you sure you want to clear the entire queue? This will remove all history and pending tasks.")) {
      return
    }

    startTransition(async () => {
      const result = await clearAiMarkingQueueAction()
      if (result.success) {
        toast.success("Queue cleared")
        loadData()
      } else {
        toast.error("Failed to clear queue")
      }
    })
  }

  const handleClearChatCalls = async () => {
    if (!confirm("Clear the recorded chat calls? This only removes the log, not any chat history.")) return
    startTransition(async () => {
      const result = await clearChatCallsAction()
      if (result.success) {
        setChatCalls([])
        toast.success("Chat calls cleared")
      } else {
        toast.error("Failed to clear chat calls")
      }
    })
  }

  const handleClearLogs = () => {
    if (!confirm("Are you sure you want to clear all process logs?")) {
      return
    }

    startTransition(async () => {
      const result = await clearAiMarkingLogsAction()
      if (result.success) {
        toast.success("Logs cleared")
        loadData()
      } else {
        toast.error("Failed to clear logs")
      }
    })
  }

  const getStatusBadge = (markStatus: string | null | undefined) => {
    const { label, tone } = markStatusLabel(markStatus as any)
    switch (tone) {
      case "pending":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{label}</Badge>
      case "active":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 animate-pulse">{label}</Badge>
      case "done":
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{label}</Badge>
      case "error":
        return <Badge variant="destructive">{label}</Badge>
      default:
        return <Badge variant="secondary">{label}</Badge>
    }
  }

  const getLogLevelBadge = (level: string) => {
    switch (level) {
      case "info":
        return <Badge variant="outline" className="text-[10px] uppercase">Info</Badge>
      case "warn":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] uppercase">Warn</Badge>
      case "error":
        return <Badge variant="destructive" className="text-[10px] uppercase">Error</Badge>
      default:
        return <Badge variant="secondary" className="text-[10px] uppercase">{level}</Badge>
    }
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Marking System</h1>
          <p className="text-sm text-muted-foreground">Monitor and manage background AI marking tasks and logs.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleClearLogs} disabled={isLoading || isPending || logs.length === 0}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Logs
          </Button>
          <Button variant="destructive" size="sm" onClick={handleClearQueue} disabled={isLoading || isPending || data.length === 0}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Queue
          </Button>
          <Button variant="default" size="sm" onClick={handleProcessQueue} disabled={isLoading || isPending || !stats.waiting}>
            <Play className="h-4 w-4 mr-2" />
            Process Queue
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border bg-card shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase">Waiting</p>
          <p className="text-2xl font-bold">{stats.waiting || 0}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase">Marking</p>
          <p className="text-2xl font-bold">{stats.marking || 0}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase">Total in Queue</p>
          <p className="text-2xl font-bold">{stats.total || 0}</p>
        </div>
      </div>

      <Tabs defaultValue="status" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="status" className="gap-2">
            <Activity className="h-4 w-4" />
            Queue Status
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Process Logs
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-2">
            <Bot className="h-4 w-4" />
            Chat Calls
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="space-y-4">
          <div className="rounded-md border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pupil</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Error</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      No items in queue.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((item) => (
                    <TableRow key={item.queue_id}>
                      <TableCell className="font-medium">
                        {item.first_name} {item.last_name}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={item.activity_title}>
                        {item.activity_title}
                      </TableCell>
                      <TableCell>{getStatusBadge(item.mark_status)}</TableCell>
                      <TableCell>{item.attempts}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(item.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-[300px] break-words whitespace-normal">
                        {item.last_error || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.mark_status === "marking-error" && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleRetry(item.queue_id)}
                            disabled={isPending}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <div className="rounded-md border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Level</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      No logs recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.log_id}>
                      <TableCell>{getLogLevelBadge(log.level)}</TableCell>
                      <TableCell className="font-medium">{log.message}</TableCell>
                      <TableCell className="text-xs font-mono max-w-[400px]">
                        {log.metadata ? (
                          <pre className="bg-muted p-2 rounded overflow-auto max-h-40 text-[10px]">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}.{new Date(log.created_at).getMilliseconds().toString().padStart(3, '0')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="chat" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Every call the lesson and unit chats made to a model. Failures are listed first — they
              carry the reply that caused them, which is the thing worth looking at. Rows are kept
              for seven days.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearChatCalls}
              disabled={isLoading || isPending || chatCalls.length === 0}
              className="gap-2 shrink-0"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </div>
          <div className="rounded-md border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Surface</TableHead>
                  <TableHead className="w-[150px]">Model</TableHead>
                  <TableHead>Asked</TableHead>
                  <TableHead>Reply</TableHead>
                  <TableHead className="w-[80px] text-right">Took</TableHead>
                  <TableHead className="w-[90px] text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chatCalls.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      No chat calls recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  chatCalls.map((call) => (
                    <TableRow key={call.job_id}>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {(call.surface ?? "").replace("surface:", "").replace("-chat", "")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{call.model}</TableCell>
                      <TableCell className="max-w-[260px] text-xs">
                        <span className="line-clamp-3">{call.asked || "—"}</span>
                        {call.history_turns ? (
                          <span className="text-muted-foreground"> ({call.history_turns} prior turns)</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[380px] text-xs">
                        {call.last_error ? (
                          <div className="space-y-1">
                            {/* break-all, not break-words: a provider error is
                                often one long unbroken JSON blob, which would
                                otherwise run over the columns to its right. */}
                            <p className="text-destructive break-all line-clamp-4">{call.last_error}</p>
                            {call.raw_reply ? (
                              <details>
                                <summary className="cursor-pointer text-muted-foreground">
                                  reply that caused it
                                </summary>
                                <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px] whitespace-pre-wrap">
                                  {call.raw_reply}
                                </pre>
                              </details>
                            ) : null}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <span className="line-clamp-3">{call.replied || "—"}</span>
                            {call.proposals ? (
                              <Badge variant="secondary" className="font-normal">
                                {call.proposals} proposal{call.proposals === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {call.duration_ms != null ? `${(call.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {new Date(call.created_at).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
