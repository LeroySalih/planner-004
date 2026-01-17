"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { startRevision } from "@/actions/revisions"
import { Loader2, RefreshCw, Play } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function StartRevisionButton({ lessonId, compact }: { lessonId: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleStart = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    try {
      const revisionId = await startRevision(lessonId)
      router.push(`/revisions/${revisionId}`)
    } catch (error) {
      console.error("Failed to start revision:", error)
      toast.error(error instanceof Error ? error.message : "Failed to start revision")
      setLoading(false)
    }
  }

  if (compact) {
    return (
      <Button
        onClick={handleStart}
        disabled={loading}
        size="icon"
        variant="ghost"
        className="h-6 w-6 text-muted-foreground hover:text-primary"
        title="Start Revision"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        <span className="sr-only">Start Revision</span>
      </Button>
    )
  }

  return (
    <Button onClick={handleStart} disabled={loading} variant="outline" className="gap-2 text-primary">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Practise Revision
    </Button>
  )
}
