"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Download, Loader2 } from "lucide-react"

import type { SubmissionStatus, UploadSubmissionFile } from "@/types"
import { getQueueFileDownloadUrlAction, updateUploadSubmissionStatusAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function itemLessonId(items: UploadSubmissionFile[], pupilId: string) {
  return items.find((item) => item.pupilId === pupilId)?.lessonId ?? ""
}

function itemActivityId(items: UploadSubmissionFile[], pupilId: string) {
  return items.find((item) => item.pupilId === pupilId)?.activityId ?? ""
}

type QueueListProps = {
  items: UploadSubmissionFile[]
}

const statusOptions: Array<{ value: SubmissionStatus; label: string }> = [
  { value: "inprogress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
]

function formatPupilName(pupilId: string, pupilName?: string | null) {
  if (pupilName && pupilName.trim().length > 0) {
    return pupilName.trim()
  }
  return pupilId
}

export function QueueList({ items }: QueueListProps) {
  const [queueItems, setQueueItems] = useState<UploadSubmissionFile[]>(() => items)
  const [, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [downloadId, setDownloadId] = useState<string | null>(null)
  const [downloadAllPending, setDownloadAllPending] = useState(false)
  const [filterText, setFilterText] = useState("")

  useEffect(() => {
    setQueueItems(items)
  }, [items])

  const filteredItems = useMemo(() => {
    const query = filterText.trim().toLowerCase()
    if (!query) return queueItems

    return queueItems.filter((item) => {
      const lessonLabel = item.lessonTitle || item.lessonId || ""
      const activityLabel = item.activityTitle || ""
      const unitLabel = item.unitTitle || ""
      const groupLabel = item.groupId || item.groupName || ""
      const displayName = formatPupilName(item.pupilId, item.pupilName)
      const fileName = item.fileName ?? ""

      const haystack = [lessonLabel, activityLabel, unitLabel, groupLabel, displayName, fileName]
        .join(" ")
        .toLowerCase()

      return haystack.includes(query)
    })
  }, [filterText, queueItems])

  const hasDownloadableFiles = useMemo(
    () => filteredItems.some((item) => item.fileName && item.fileName.trim().length > 0),
    [filteredItems],
  )

  const handleStatusChange = (pupilId: string, nextStatus: SubmissionStatus) => {
    startTransition(async () => {
      setPendingId(pupilId)
      try {
        const result = await updateUploadSubmissionStatusAction({
          lessonId: itemLessonId(queueItems, pupilId) ?? "",
          activityId: itemActivityId(queueItems, pupilId) ?? "",
          pupilId,
          status: nextStatus,
        })

        if (!result.success) {
          toast.error("Unable to update status", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        setQueueItems((prev) =>
          prev.map((item) =>
            item.pupilId === pupilId
              ? {
                  ...item,
                  status: nextStatus,
                }
              : item,
          ),
        )
        toast.success("Status updated")
      } catch (error) {
        console.error("[queue] Failed to update status", error)
        toast.error("Unable to update status", {
          description: "Please try again later.",
        })
      } finally {
        setPendingId(null)
      }
    })
  }

  const handleDownload = (item: UploadSubmissionFile) => {
    if (!item.lessonId || !item.activityId || !item.pupilId || !item.fileName) {
      toast.error("Missing file details.")
      return
    }
    startTransition(async () => {
      setDownloadId(item.submissionId ?? `${item.activityId}-${item.pupilId}-${item.fileName}`)
      try {
        const result = await getQueueFileDownloadUrlAction({
          lessonId: item.lessonId ?? "",
          activityId: item.activityId,
          pupilId: item.pupilId,
          fileName: item.fileName ?? "",
        })

        if (!result.success || !("url" in result) || !result.url) {
          toast.error("Unable to download file", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        window.open(result.url, "_blank")
      } catch (error) {
        console.error("[queue] Failed to download file", error)
        toast.error("Unable to download file", {
          description: "Please try again later.",
        })
      } finally {
        setDownloadId(null)
      }
    })
  }

  const handleDownloadAll = (itemsToDownload: UploadSubmissionFile[]) => {
    const downloadable = itemsToDownload.filter((item) => item.lessonId && item.activityId && item.pupilId && item.fileName)
    if (downloadable.length === 0) {
      toast.error("No files to download for the current filter.")
      return
    }

    startTransition(async () => {
      setDownloadAllPending(true)
      try {
        const response = await fetch("/queue/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: downloadable.map((item) => ({
              lessonId: item.lessonId,
              activityId: item.activityId,
              pupilId: item.pupilId,
              fileName: item.fileName,
            })),
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          toast.error("Unable to download files", { description: errorText || "Please try again later." })
          return
        }

        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "uploads.zip"
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error("[queue] Failed to download zip", error)
        toast.error("Unable to download files", { description: "Please try again later." })
      } finally {
        setDownloadAllPending(false)
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Queue</h3>
          <p className="text-sm text-muted-foreground">Review all uploads.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => handleDownloadAll(filteredItems)}
          disabled={!hasDownloadableFiles || downloadAllPending}
        >
          <Download className="mr-2 h-4 w-4" />
          {downloadAllPending ? "Preparing..." : "Download all as zip"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Filter by unit, lesson, activity, group, pupil, or file"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          className="max-w-xl"
        />
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files found.</p>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item, index) => {
            const statusDisabled = pendingId !== null
            const displayName = formatPupilName(item.pupilId, item.pupilName)
            const lessonLabel = item.lessonTitle || item.lessonId || "Lesson"
            const activityLabel = item.activityTitle || "Upload activity"
            const unitLabel = item.unitTitle || "Unit"
            const groupLabel = item.groupId || item.groupName || "Group"
            return (
              <div
                key={
                  item.submissionId
                    ? `submission-${item.submissionId}-${index}`
                    : `activity-${item.activityId}-${item.pupilId}-${item.fileName ?? "nofile"}-${
                        item.submittedAt ?? "na"
                      }-${index}`
                }
                className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-center">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">{unitLabel}</p>
                    <p className="text-muted-foreground">
                      {lessonLabel} / {activityLabel}
                    </p>
                  </div>
                  <p className="text-sm text-foreground">{groupLabel}</p>
                  <p className="text-sm text-foreground">{displayName}</p>
                  <button
                    type="button"
                    className="text-sm text-left text-foreground truncate underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                    title={item.fileName ?? undefined}
                    onClick={() => handleDownload(item)}
                    disabled={!item.fileName || downloadId !== null}
                  >
                    {item.fileName ? item.fileName : "No file uploaded yet"}
                  </button>
                  <div className="flex items-center gap-2">
                    <Select
                      value={item.status}
                      onValueChange={(value) => handleStatusChange(item.pupilId, value as SubmissionStatus)}
                      disabled={statusDisabled}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue aria-label={item.status} />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {pendingId === item.pupilId || downloadId ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
