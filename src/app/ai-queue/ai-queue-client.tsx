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
import { readAiMarkingQueueAction, retryQueueItemAction, processQueueAction } from "@/lib/server-actions/ai-queue"
import { toast } from "sonner"
import { RefreshCw, RotateCcw, Play } from "lucide-react"

export default function AiQueuePage() {
  const [data, setData] = useState<any[]>([])
  const [stats, setStats] = useState<any>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  const loadData = async () => {
    setIsLoading(true)
    const result = await readAiMarkingQueueAction()
    if (result.success) {
      setData(result.data || [])
      setStats(result.stats || {})
    } else {
      toast.error(result.error || "Failed to load queue")
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Pending</Badge>
      case "processing":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 animate-pulse">Processing</Badge>
      case "completed":
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Completed</Badge>
      case "failed":
        return <Badge variant="destructive">Failed</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Marking Queue</h1>
          <p className="text-sm text-muted-foreground">Monitor and manage background AI marking tasks.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={handleProcessQueue} disabled={isLoading || isPending || stats.pending === 0}>
            <Play className="h-4 w-4 mr-2" />
            Process Queue
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-lg border bg-card shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase">Pending</p>
          <p className="text-2xl font-bold">{stats.pending || 0}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase">Processing</p>
          <p className="text-2xl font-bold">{stats.processing || 0}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase">Completed</p>
          <p className="text-2xl font-bold">{stats.completed || 0}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card shadow-sm text-destructive">
          <p className="text-xs font-medium uppercase">Failed</p>
          <p className="text-2xl font-bold">{stats.failed || 0}</p>
        </div>
      </div>

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
                  <TableCell>{getStatusBadge(item.status)}</TableCell>
                  <TableCell>{item.attempts}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(item.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="max-w-[300px] text-xs text-destructive truncate" title={item.last_error}>
                    {item.last_error || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.status === "failed" && (
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
    </div>
  )
}
