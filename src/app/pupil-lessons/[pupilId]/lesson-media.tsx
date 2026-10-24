"use client"

import { useEffect, useState, useTransition } from "react"
import { Download, Loader2 } from "lucide-react"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { MediaImage } from "@/components/ui/media-image"
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

  // Nothing to show is left out rather than announced on every lesson.
  if (!hasImages && files.length === 0) return null

  return (
    <div className="mt-4 space-y-3">
      {hasImages ? (
        <ul className="flex flex-wrap gap-3" aria-label="Lesson images">
          {images.map((image) => {
            const state = imageState[image.activityId] ?? { url: null, loading: true }
            const url = state.url
            const isLoading = state.loading

            return (
              <li key={image.activityId}>
                <button
                  type="button"
                  onClick={() => url && setOpenImage(url)}
                  disabled={Boolean(isLoading || !url)}
                  className={cn(
                    "relative block h-24 w-32 overflow-hidden rounded-lg border border-la-border bg-la-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green",
                    !isLoading && url && "cursor-zoom-in hover:border-la-green",
                  )}
                  aria-label={url ? `Open image: ${image.title ?? lessonTitle}` : "Image unavailable"}
                >
                  {isLoading ? (
                    <span className="flex h-full items-center justify-center text-la-muted">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span className="sr-only">Loading image</span>
                    </span>
                  ) : url ? (
                    <MediaImage
                      src={url}
                      alt={image.title ?? lessonTitle}
                      fill
                      sizes="(max-width: 768px) 50vw, 200px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-la-muted">No image</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Lesson files">
          {files.map((file) => {
            const isDownloading = downloadingFile === file.name && (isPending || Boolean(downloadingFile))
            const extension = file.name.includes(".") ? file.name.split(".").pop() : ""
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => handleDownload(file)}
                  disabled={isDownloading}
                  className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-la-border bg-la-card px-3 text-sm font-medium text-la-ink hover:border-la-green focus-visible:outline-2 focus-visible:outline-la-green disabled:opacity-70"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 flex-none animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-4 w-4 flex-none text-la-green" aria-hidden="true" />
                  )}
                  <span className="max-w-[12rem] truncate" title={file.name}>
                    {file.name}
                  </span>
                  {extension ? (
                    <span className="rounded bg-la-green-pale px-1.5 text-[11px] font-semibold uppercase text-la-green">{extension}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
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
