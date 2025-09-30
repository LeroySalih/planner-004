"use client"

import { useState } from "react"
import { FileDown, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface ExportPdfButtonProps {
  pupilId: string
  fileName: string
  groupId?: string
}

export function ExportPdfButton({ pupilId, fileName, groupId }: ExportPdfButtonProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (isExporting) return

    setIsExporting(true)

    try {
      const basePath = `/reports/${encodeURIComponent(pupilId)}/export`
      const url = groupId ? `${basePath}?groupId=${encodeURIComponent(groupId)}` : basePath

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/pdf",
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to export PDF (${response.status})`)
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.error("[reports] Failed to export PDF", error)
      window.alert("Sorry, we couldn't generate the PDF. Please try again.")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isExporting}
      aria-label="Export report to PDF"
    >
      {isExporting ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <FileDown className="size-4" />
          Export PDF
        </>
      )}
    </Button>
  )
}
