"use client"

import { createPortal } from "react-dom"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { MouseEvent } from "react"
import { ZoomIn, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ActivityImagePreviewProps {
  imageUrl: string
  alt: string
  className?: string
  objectFit?: "cover" | "contain"
  imageClassName?: string
}

export function ActivityImagePreview({
  imageUrl,
  alt,
  className,
  objectFit = "cover",
  imageClassName,
}: ActivityImagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  const handleOverlayClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      setIsOpen(false)
    }
  }, [])

  const standardImage = useMemo(
    () => (
      <div className={cn("relative w-full overflow-hidden rounded-lg border border-border", className)}>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="sr-only">Expand image</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={alt}
            className={cn(
              "h-auto w-full object-cover transition",
              objectFit === "contain" && "object-contain",
              imageClassName,
            )}
            loading="lazy"
          />
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white shadow-sm transition group-hover:bg-black/80">
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
            Zoom
          </span>
        </button>
      </div>
    ),
    [alt, className, imageClassName, imageUrl, objectFit],
  )

  if (!isMounted) {
    return standardImage
  }

  return (
    <>
      {standardImage}
      {isOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[80] flex flex-col bg-black/90 text-white"
              onClick={handleOverlayClick}
            >
              <div className="flex items-center justify-end gap-3 px-4 py-4">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="bg-white/10 text-white shadow-sm transition hover:bg-white/20"
                >
                  <X className="mr-2 h-4 w-4" aria-hidden="true" />
                  Close
                </Button>
              </div>
              <div className="flex flex-1 items-center justify-center px-4 pb-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={alt}
                  className="max-h-[calc(100vh-8rem)] w-full max-w-5xl object-contain"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
