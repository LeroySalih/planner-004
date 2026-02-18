"use client"

import { Fragment, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Download, Loader2 } from "lucide-react"
import { format } from "date-fns"

import type { SubmissionStatus, UploadSubmissionFile } from "@/types"
import { getQueueFileDownloadUrlAction, readQueueAllItemsAction, updateUploadSubmissionStatusAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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

type StatusFilter = SubmissionStatus | "all"

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
  const [downloadSubGroupKey, setDownloadSubGroupKey] = useState<string | null>(null)
  const [filterText, setFilterText] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("submitted")
  const [ownerFilter, setOwnerFilter] = useState<string>("all")
  const [lessonActivityFilter, setLessonActivityFilter] = useState("")

  useEffect(() => {
    setQueueItems(items)
  }, [items])

  useEffect(() => {
    const source = new EventSource("/sse?topics=submissions")

    source.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as { topic?: string; type?: string }
        if (envelope.topic !== "submissions") return

        // Refresh the queue on any submission event to stay in sync.
        startTransition(async () => {
          const result = await readQueueAllItemsAction()
          if (result.data) {
            setQueueItems(result.data)
          } else if (result.error) {
            console.error("[queue] Failed to refresh after submission event:", result.error)
          }
        })
      } catch (error) {
        console.error("[queue] Failed to parse SSE message", error)
      }
    }

    source.onerror = () => {
      // rely on browser retry; no-op
    }

    return () => {
      source.close()
    }
  }, [startTransition])

  const ownerOptions = useMemo(() => {
    const owners = new Map<string, string>()
    queueItems.forEach((item) => {
      const label = formatPupilName(item.pupilId, item.pupilName)
      owners.set(item.pupilId, label)
    })

    return Array.from(owners.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: "base" }),
    )
  }, [queueItems])

  const filteredItems = useMemo(() => {
    const query = filterText.trim().toLowerCase()
    const lessonActivityQuery = lessonActivityFilter.trim().toLowerCase()
    const matchesQuery = (item: UploadSubmissionFile) => {
      const lessonLabel = item.lessonTitle || item.lessonId || ""
      const activityLabel = item.activityTitle || ""
      const unitLabel = item.unitTitle || ""
      const groupLabel = item.groupId || item.groupName || ""
      const displayName = formatPupilName(item.pupilId, item.pupilName)
      const fileName = item.fileName ?? ""

      const haystack = [lessonLabel, activityLabel, unitLabel, groupLabel, displayName, fileName]
        .join(" ")
        .toLowerCase()

      return !query || haystack.includes(query)
    }

    return queueItems.filter((item) => {
      const statusMatch = statusFilter === "all" ? true : item.status === statusFilter
      const ownerMatch = ownerFilter === "all" ? true : item.pupilId === ownerFilter
      const lessonActivityMatch =
        !lessonActivityQuery ||
        [item.lessonTitle, item.lessonId, item.activityTitle, item.activityId]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(lessonActivityQuery))
      const queryMatch = matchesQuery(item)
      return statusMatch && ownerMatch && lessonActivityMatch && queryMatch
    })
  }, [filterText, lessonActivityFilter, ownerFilter, queueItems, statusFilter])

  const groupedItems = useMemo(() => {
    const compareSubmittedAt = (a: UploadSubmissionFile, b: UploadSubmissionFile) => {
      const dateA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0
      const dateB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0
      return dateA - dateB
    }

    // First level: group by class/group
    const groups = new Map<string, UploadSubmissionFile[]>()
    filteredItems.forEach((item) => {
      const label = item.groupId || item.groupName || "Ungrouped"
      const existing = groups.get(label) ?? []
      existing.push(item)
      groups.set(label, existing)
    })

    return Array.from(groups.entries())
      .map(([groupLabel, groupItems]) => {
        // Second level: sub-group by unit / lesson / activity
        const subGroups = new Map<string, UploadSubmissionFile[]>()
        groupItems.forEach((item) => {
          const unitLabel = item.unitTitle || "Unit"
          const lessonLabel = item.lessonTitle || item.lessonId || "Lesson"
          const activityLabel = item.activityTitle || "Upload activity"
          const key = `${unitLabel}|||${lessonLabel}|||${activityLabel}`
          const existing = subGroups.get(key) ?? []
          existing.push(item)
          subGroups.set(key, existing)
        })

        const sortedSubGroups = Array.from(subGroups.entries())
          .map(([key, items]) => {
            const [unitLabel, lessonLabel, activityLabel] = key.split("|||")
            return {
              key,
              unitLabel,
              lessonLabel,
              activityLabel,
              items: [...items].sort(compareSubmittedAt),
            }
          })
          .sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: "base" }))

        return {
          groupLabel,
          subGroups: sortedSubGroups,
          totalItems: groupItems.length,
        }
      })
      .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel, undefined, { sensitivity: "base" }))
  }, [filteredItems])

  const flattenedItems = useMemo(
    () => groupedItems.flatMap((group) => group.subGroups.flatMap((sub) => sub.items)),
    [groupedItems],
  )



  const handleStatusChange = (item: UploadSubmissionFile, nextStatus: SubmissionStatus) => {
    startTransition(async () => {
      const uniqueId = `${item.pupilId}-${item.fileName}`
      setPendingId(uniqueId)
      try {
        const result = await updateUploadSubmissionStatusAction({
          lessonId: item.lessonId ?? "",
          activityId: item.activityId,
          pupilId: item.pupilId,
          status: nextStatus,
          fileName: item.fileName ?? undefined,
        })

        if (!result.success) {
          toast.error("Unable to update status", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        setQueueItems((prev) =>
          prev.map((prevItem) =>
            prevItem.pupilId === item.pupilId && prevItem.fileName === item.fileName
              ? {
                  ...prevItem,
                  status: nextStatus,
                }
              : prevItem,
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

  const handleDownloadSubGroup = (subGroupKey: string, itemsToDownload: UploadSubmissionFile[], zipName: string) => {
    const downloadable = itemsToDownload.filter((item) => item.lessonId && item.activityId && item.pupilId && item.fileName)
    if (downloadable.length === 0) {
      toast.error("No files to download for the current filter.")
      return
    }

    startTransition(async () => {
      setDownloadSubGroupKey(subGroupKey)
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
        link.download = zipName
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error("[queue] Failed to download zip", error)
        toast.error("Unable to download files", { description: "Please try again later." })
      } finally {
        setDownloadSubGroupKey(null)
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Queue</h3>
        <p className="text-sm text-muted-foreground">Review all uploads.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          placeholder="Filter by unit, lesson, activity, group, owner, or file"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          className="max-w-xl"
        />
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {ownerOptions.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="text"
          placeholder="Filter by lesson or activity title"
          value={lessonActivityFilter}
          onChange={(event) => setLessonActivityFilter(event.target.value)}
          className="max-w-xs"
        />
      </div>

      {flattenedItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files found.</p>
      ) : (
        <div className="space-y-2">
          {groupedItems.map((group) => {
            const headerId = `group-${group.groupLabel}`
            return (
              <div key={headerId} className="overflow-hidden rounded-md border border-border/60 bg-muted/30">
                <div className="flex flex-wrap items-center justify-between border-b border-border/60 bg-muted px-3 py-2.5">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-foreground">{group.groupLabel}</p>
                    <p className="text-xs text-muted-foreground">{group.totalItems} file(s)</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0">
                    <thead className="bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Owner</th>
                        <th className="px-3 py-2 text-left">Instructions</th>
                        <th className="px-3 py-2 text-left">Submitted</th>
                        <th className="px-3 py-2 text-left">File</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {group.subGroups.map((subGroup) => (
                        <Fragment key={`sub-${subGroup.key}`}>
                          <tr className="bg-muted/20">
                            <td colSpan={5} className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm">
                                  <span className="font-medium text-foreground">{subGroup.unitLabel}</span>
                                  <span className="text-muted-foreground">
                                    {" — "}{subGroup.lessonLabel} / {subGroup.activityLabel}
                                  </span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    ({subGroup.items.length})
                                  </span>
                                </div>
                                {subGroup.items.some((i) => i.fileName) && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
                                      const zipName = `${slug(group.groupLabel)}-${slug(subGroup.activityLabel)}.zip`
                                      handleDownloadSubGroup(subGroup.key, subGroup.items, zipName)
                                    }}
                                    disabled={downloadSubGroupKey !== null}
                                  >
                                    {downloadSubGroupKey === subGroup.key ? (
                                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                    ) : (
                                      <Download className="mr-1 h-3 w-3" />
                                    )}
                                    {downloadSubGroupKey === subGroup.key ? "Preparing..." : "Download zip"}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {subGroup.items.map((item, index) => {
                            const uniqueId = `${item.pupilId}-${item.fileName}`
                            const statusDisabled = pendingId !== null && pendingId !== uniqueId
                            const displayName = formatPupilName(item.pupilId, item.pupilName)
                            const rowKey =
                              (item.submissionId ? `${item.submissionId}-` : `activity-${item.activityId}-${item.pupilId}-`) +
                              `${item.fileName ?? "nofile"}-${index}`
                            return (
                              <tr key={rowKey} className="align-middle">
                                <td className="px-3 py-3 text-sm text-foreground">{displayName}</td>
                                <td className="px-3 py-3 text-sm text-foreground">
                                  {item.instructions ? (
                                    <Badge variant="outline" className="font-normal">
                                      {item.instructions}
                                    </Badge>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="px-3 py-3 text-sm text-foreground tabular-nums">
                                  {item.submittedAt ? (
                                    <div className="flex flex-col">
                                      <span>{format(new Date(item.submittedAt), "dd-MM-yyyy")}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(item.submittedAt), "HH:mm")}
                                      </span>
                                    </div>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <button
                                    type="button"
                                    className="text-sm text-left text-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                                    title={item.fileName ?? undefined}
                                    onClick={() => handleDownload(item)}
                                    disabled={!item.fileName || downloadId !== null}
                                  >
                                    {item.fileName ? item.fileName : "No file uploaded yet"}
                                  </button>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-2">
                                    <Select
                                      value={item.status}
                                      onValueChange={(value) => handleStatusChange(item, value as SubmissionStatus)}
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
                                    {pendingId === uniqueId || downloadId === item.submissionId ? (
                                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
