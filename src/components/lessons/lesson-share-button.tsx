"use client"

import { useCallback, useRef, useState } from "react"
import { QRCodeCanvas } from "qrcode.react"
import { Share2, Copy, Check, Image } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface LessonShareDialogProps {
  lessonId: string
  lessonTitle: string
}

function LessonShareDialog({ lessonId, lessonTitle }: LessonShareDialogProps) {
  const [linkCopied, setLinkCopied] = useState(false)
  const [imgCopied, setImgCopied] = useState(false)
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null)

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/go/lesson/${lessonId}`
      : `/go/lesson/${lessonId}`

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setLinkCopied(true)
      toast.success("Link copied to clipboard")
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      toast.error("Could not copy link")
    }
  }, [shareUrl])

  const copyCompositeImage = useCallback(async () => {
    const qrCanvas = qrCanvasRef.current
    if (!qrCanvas) return

    try {
      const width = 320
      const height = 360
      const composite = compositeCanvasRef.current
      if (!composite) return
      composite.width = width
      composite.height = height
      const ctx = composite.getContext("2d")
      if (!ctx) return

      // White background
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, width, height)

      // Lesson title
      ctx.fillStyle = "#0f172a"
      ctx.font = "bold 16px sans-serif"
      ctx.textAlign = "center"
      const maxWidth = width - 32
      const lines = wrapText(ctx, lessonTitle, maxWidth)
      let y = 28
      for (const line of lines) {
        ctx.fillText(line, width / 2, y)
        y += 20
      }

      // QR code from the rendered QRCodeCanvas
      const qrSize = 200
      const qrY = y + 8
      ctx.drawImage(qrCanvas, (width - qrSize) / 2, qrY, qrSize, qrSize)

      // URL text below QR
      ctx.fillStyle = "#94a3b8"
      ctx.font = "10px sans-serif"
      ctx.fillText(shareUrl, width / 2, qrY + qrSize + 20, maxWidth)

      const blob = await new Promise<Blob | null>((resolve) =>
        composite.toBlob(resolve, "image/png"),
      )
      if (!blob) throw new Error("Failed to generate image")

      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ])
      setImgCopied(true)
      toast.success("Image copied to clipboard")
      setTimeout(() => setImgCopied(false), 2000)
    } catch {
      toast.error("Could not copy image. Try right-clicking the QR code to save it.")
    }
  }, [lessonTitle, shareUrl])

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Share Lesson</DialogTitle>
        <DialogDescription>{lessonTitle}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4">
        <div className="rounded-lg border border-border bg-white p-3">
          <QRCodeCanvas
            ref={qrCanvasRef}
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
            {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {linkCopied ? "Copied!" : "Copy Link"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={copyCompositeImage}
          >
            {imgCopied ? <Check className="h-4 w-4" /> : <Image className="h-4 w-4" />}
            {imgCopied ? "Copied!" : "Copy Image"}
          </Button>
        </div>

        {/* Hidden canvas for composite image generation */}
        <canvas ref={compositeCanvasRef} className="hidden" />
      </div>
    </DialogContent>
  )
}

export function LessonShareButton({
  lessonId,
  lessonTitle,
}: LessonShareDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="bg-white/10 text-white hover:bg-white/20"
        >
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
      </DialogTrigger>
      <LessonShareDialog lessonId={lessonId} lessonTitle={lessonTitle} />
    </Dialog>
  )
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let currentLine = ""

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.length > 0 ? lines : [text]
}
