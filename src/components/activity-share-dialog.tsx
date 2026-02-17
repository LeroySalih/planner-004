"use client"

import { useCallback, useRef, useState } from "react"
import { QRCodeCanvas } from "qrcode.react"
import { Check, Copy, Image, QrCode } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

function ActivityShareDialog({
  activityId,
  activityTitle,
}: {
  activityId: string
  activityTitle: string
}) {
  const [linkCopied, setLinkCopied] = useState(false)
  const [qrCopied, setQrCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/go/${activityId}`
      : `/go/${activityId}`

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // Fallback: select the text input
    }
  }, [shareUrl])

  const copyQrCode = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      )
      if (!blob) return

      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ])
      setQrCopied(true)
      setTimeout(() => setQrCopied(false), 2000)
    } catch {
      // ClipboardItem not supported in all browsers
    }
  }, [])

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Share Activity</DialogTitle>
        <DialogDescription>{activityTitle}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4">
        <div className="rounded-lg border border-border bg-white p-3">
          <QRCodeCanvas
            ref={canvasRef}
            value={shareUrl}
            size={200}
            marginSize={1}
          />
        </div>

        <div className="flex w-full items-center gap-2">
          <input
            readOnly
            value={shareUrl}
            className="flex-1 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-foreground"
            onFocus={(e) => e.target.select()}
          />
        </div>

        <div className="flex w-full gap-2">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={copyLink}
          >
            {linkCopied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {linkCopied ? "Copied!" : "Copy Link"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={copyQrCode}
          >
            {qrCopied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Image className="h-4 w-4" />
            )}
            {qrCopied ? "Copied!" : "Copy QR Code"}
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}

export function ActivityShareButton({
  activityId,
  activityTitle,
}: {
  activityId: string
  activityTitle: string
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          title="Share activity"
          onClick={(e) => e.preventDefault()}
        >
          <QrCode className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <ActivityShareDialog
        activityId={activityId}
        activityTitle={activityTitle}
      />
    </Dialog>
  )
}
