"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

interface ImageLightboxProps {
  src: string
  alt: string
  label?: string
}

/**
 * "Open full image" trigger that shows the image in a full-screen modal in the
 * current tab (instead of opening a new tab). Closes on the X button, a
 * backdrop click, or Escape; locks body scroll while open.
 */
export function ImageLightbox({ src, alt, label = "Open full image" }: ImageLightboxProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        {label}
      </button>

      {open && mounted
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={alt}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                }}
                aria-label="Close image"
                className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
              >
                <X className="h-6 w-6" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                onClick={(event) => event.stopPropagation()}
                className="max-h-[90vh] max-w-[90vw] object-contain"
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
