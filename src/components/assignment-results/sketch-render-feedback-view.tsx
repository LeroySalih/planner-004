"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { readSubmissionByIdAction } from "@/lib/server-updates"
import { SketchRenderSubmissionBodySchema, type Submission } from "@/types"
import { Loader2, ArrowRight } from "lucide-react"

interface SketchRenderFeedbackViewProps {
  activityId: string
  submissionId: string
  pupilName: string
  lessonId: string
}

export function SketchRenderFeedbackView({
  activityId,
  submissionId,
  lessonId,
}: SketchRenderFeedbackViewProps) {
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSubmission(null)

    readSubmissionByIdAction(submissionId)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data) {
          setSubmission(result.data)
        } else {
          setError(result.error || "Failed to load submission")
        }
      })
      .catch(() => {
        if (!cancelled) setError("An error occurred")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [submissionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return <div className="text-destructive p-4 text-sm">{error}</div>
  }

  if (!submission) {
    return <div className="text-muted-foreground p-4 text-sm">No submission found.</div>
  }

  const parsedBody = SketchRenderSubmissionBodySchema.safeParse(submission.body)
  if (!parsedBody.success) {
    return <div className="text-destructive p-4 text-sm">Invalid submission data received.</div>
  }

  const { original_file_path, rendered_file_path, prompt } = parsedBody.data

  const getDownloadUrl = (fileName: string) =>
    `/api/activity-files/download?lessonId=${lessonId}&activityId=${activityId}&fileName=${fileName}`

  return (
    <div className="space-y-6">
      {/* Prompt Section */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Pupil Prompt</p>
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-sm italic text-foreground">
            {prompt || "No prompt provided."}
          </p>
        </div>
      </div>

      {/* Images Section */}
      <div className="grid gap-4">
        {original_file_path && (
            <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Original Sketch</p>
            <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-background">
                <Image
                src={getDownloadUrl(original_file_path)}
                alt="Original sketch"
                fill
                unoptimized
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 300px"
                />
            </div>
            </div>
        )}

        {rendered_file_path ? (
             <div className="space-y-2">
             <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 flex items-center gap-2">
               <ArrowRight className="h-3 w-3" /> AI Result
             </p>
             <div className="relative aspect-video w-full overflow-hidden rounded-md border border-purple-200 bg-purple-50/50">
                <Image
                src={getDownloadUrl(rendered_file_path)}
                alt="AI Rendered result"
                fill
                unoptimized
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 300px"
                />
            </div>
            </div>
        ) : (
            <div className="rounded-md border border-dashed border-border p-4 text-center">
                <p className="text-xs text-muted-foreground">No AI generation yet.</p>
            </div>
        )}

        {!original_file_path && !rendered_file_path && (
            <p className="text-sm text-muted-foreground">No images uploaded/generated.</p>
        )}
      </div>
    </div>
  )
}
