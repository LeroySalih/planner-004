"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, FileDown, LinkIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { getLessonFileDownloadUrlAction } from "@/lib/server-updates"

type LessonResourceLink = {
  lesson_link_id: string
  url: string
  description: string | null
}

type LessonResourceFile = {
  name: string
  path: string
  size?: number
}

type LessonResourcesPanelProps = {
  lessonId: string
  links: LessonResourceLink[]
  files: LessonResourceFile[]
}

export function LessonResourcesPanel({ lessonId, links, files }: LessonResourcesPanelProps) {
  const [open, setOpen] = useState(true)
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const panelId = `lesson-resources-${lessonId}`

  const handleDownload = (fileName: string) => {
    setPendingDownload(fileName)
    startTransition(async () => {
      try {
        const result = await getLessonFileDownloadUrlAction(lessonId, fileName)
        if (!result.success || !result.url) {
          toast.error("Failed to download file", {
            description: result.error ?? "Please try again later.",
          })
          return
        }
        window.open(result.url, "_blank", "noopener,noreferrer")
      } catch (error) {
        console.error("[feedback] Failed to download lesson file:", error)
        toast.error("Failed to download file", {
          description: error instanceof Error ? error.message : "Please try again later.",
        })
      } finally {
        setPendingDownload(null)
      }
    })
  }

  const hasLinks = links.length > 0
  const hasFiles = files.length > 0

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-medium text-foreground transition hover:bg-muted/60"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Lesson Resources
        </span>
        <span className="text-xs text-muted-foreground">
          {hasLinks ? `${links.length} link${links.length === 1 ? "" : "s"}` : "No links"}
          {" · "}
          {hasFiles ? `${files.length} file${files.length === 1 ? "" : "s"}` : "No files"}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="space-y-6 border-t border-border px-5 py-4 text-sm">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links</h3>
            {hasLinks ? (
              <ul className="mt-3 space-y-2">
                {links.map((link) => (
                  <li
                    key={link.lesson_link_id}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
                  >
                    <Link
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 break-all text-sm text-primary underline-offset-4 hover:underline"
                    >
                      <LinkIcon className="h-4 w-4" />
                      {link.description?.trim() || link.url}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No lesson links added.</p>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</h3>
            {hasFiles ? (
              <ul className="mt-3 space-y-2">
                {files.map((file) => {
                  const loading = isPending && pendingDownload === file.name
                  return (
                    <li
                      key={file.path}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
                        {typeof file.size === "number" ? (
                          <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(file.name)}
                        disabled={loading}
                        className="inline-flex items-center gap-1"
                      >
                        <FileDown className="h-4 w-4" />
                        {loading ? "Preparing…" : "Download"}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No lesson files uploaded.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}

function formatFileSize(size?: number): string | null {
  if (!size || size <= 0) return null
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const formatted = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${formatted} ${units[unitIndex]}`
}
