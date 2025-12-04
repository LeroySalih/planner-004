"use client"

import { useEffect, useState, useTransition } from "react"
import { Download, Loader2, Maximize2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { getActivityFileDownloadUrlAction, getLessonFileDownloadUrlAction } from "@/lib/server-updates"
import type { PupilUnitLessonFile, PupilUnitLessonMediaImage } from "@/lib/pupil-units-data"

type LessonMediaProps = {
  lessonId: string
  lessonTitle: string
  images: PupilUnitLessonMediaImage[]
  files: PupilUnitLessonFile[]
}

type ImageState = {
  url: string | null
  loading: boolean
}

function isAbsoluteUrl(value: string | null | undefined) {
  if (!value) return false
  return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:")
}

export function LessonMedia({ lessonId, lessonTitle, images, files }: LessonMediaProps) {
  const [imageState, setImageState] = useState<Record<string, ImageState>>({})
  const [openImage, setOpenImage] = useState<string | null>(null)
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const entries = images.map((image) => {
      const direct =
        (image.imageUrl && isAbsoluteUrl(image.imageUrl) ? image.imageUrl : null) ||
        (image.fileUrl && isAbsoluteUrl(image.fileUrl) ? image.fileUrl : null)

      return [
        image.activityId,
        {
          url: direct,
          loading: Boolean(!direct && (image.imageFile || image.fileUrl)),
        },
      ] as const
    })
    setImageState(Object.fromEntries(entries))
  }, [images])

  useEffect(() => {
    let cancelled = false

    const resolveImages = async () => {
      for (const image of images) {
        const currentState = imageState[image.activityId]
        if (currentState?.url || !currentState?.loading) {
          continue
        }

        const fileCandidate = image.imageFile || image.fileUrl
        if (!fileCandidate) {
          setImageState((prev) => ({
            ...prev,
            [image.activityId]: { url: null, loading: false },
          }))
          continue
        }

        try {
          const result = await getActivityFileDownloadUrlAction(lessonId, image.activityId, fileCandidate)
          if (cancelled) return
          const nextUrl = result.success ? result.url ?? null : null
          setImageState((prev) => ({
            ...prev,
            [image.activityId]: { url: nextUrl, loading: false },
          }))
        } catch (error) {
          console.error("[pupil-units] Failed to resolve image URL", error)
          if (!cancelled) {
            setImageState((prev) => ({
              ...prev,
              [image.activityId]: { url: null, loading: false },
            }))
          }
        }
      }
    }

    resolveImages()
    return () => {
      cancelled = true
    }
  }, [images, imageState, lessonId])

  const handleDownload = (file: PupilUnitLessonFile) => {
    startTransition(() => {
      void (async () => {
        setDownloadingFile(file.name)
        try {
          const result = await getLessonFileDownloadUrlAction(lessonId, file.name)
          const url = result.success ? result.url ?? null : null
          if (url) {
            window.location.assign(url)
          }
        } finally {
          setDownloadingFile(null)
        }
      })()
    })
  }

  const hasImages = images.length > 0

  if (!hasImages && files.length === 0) {
    return <p className="text-xs text-muted-foreground">No media attached to this lesson.</p>
  }

  return (
    <div className="space-y-3">
      {hasImages ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Images</p>
          <div className="flex flex-wrap gap-3">
            {images.map((image) => {
              const state = imageState[image.activityId] ?? { url: null, loading: true }
              const url = state.url
              const isLoading = state.loading

              return (
                <button
                  type="button"
                  key={image.activityId}
                  onClick={() => url && setOpenImage(url)}
                  disabled={Boolean(isLoading || !url)}
                  className={cn(
                    "relative h-24 w-32 overflow-hidden rounded-lg border border-border/60 bg-muted/40",
                    state?.loading ? "" : "hover:border-primary",
                  )}
                  aria-label={url ? "Open image" : "Image unavailable"}
                >
                  {isLoading ? (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Loading…
                    </div>
                  ) : url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={image.title ?? lessonTitle} className="h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                      <div className="absolute bottom-1 right-1 rounded-full bg-background/80 p-1 text-foreground shadow">
                        <Maximize2 className="h-4 w-4" />
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No image</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Files</p>
          <div className="flex flex-wrap gap-2">
            {files.map((file) => {
              const isDownloading = downloadingFile === file.name && (isPending || Boolean(downloadingFile))
              const extension = file.name.includes(".") ? file.name.split(".").pop() : ""
              return (
                <Button
                  key={file.path}
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(file)}
                  className="flex items-center gap-2"
                  disabled={isDownloading}
                >
                  {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <span className="truncate max-w-[10rem]" title={file.name}>
                    {file.name}
                  </span>
                  {extension ? (
                    <span className="rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">{extension}</span>
                  ) : null}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(openImage)} onOpenChange={(open) => !open && setOpenImage(null)}>
        <DialogContent className="max-w-3xl">
          {openImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={openImage} alt={lessonTitle} className="h-full w-full rounded-lg object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
