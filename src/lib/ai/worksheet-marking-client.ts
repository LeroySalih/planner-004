export interface WorksheetMarkingImage {
  base64: string
  fileName: string
}

export interface WorksheetMarkingParams {
  submission_id: string
  activity_id: string
  pupil_id: string
  webhook_url: string
  group_assignment_id?: string
  max_marks: number
  marking_guidance: string
  /** The pupil's submitted worksheet images. */
  pupil_images: WorksheetMarkingImage[]
  /** The teacher's answer-sheet / model-answer images. */
  answer_images: WorksheetMarkingImage[]
}

/**
 * Fire-and-forget call to the n8n "AI-MARK-WORKSHEET" workflow. Unlike the exam
 * flow there is NO OCR step: the pupil images (plus the teacher's answer-sheet
 * images and marking guidance) are sent directly. n8n marks them and POSTs the
 * result back to `webhook_url` (the existing /webhooks/ai-mark contract).
 */
export async function invokeWorksheetMarking(params: WorksheetMarkingParams): Promise<void> {
  const url = process.env.N8N_MARK_WORKSHEET_WEBHOOK_URL
  const auth = process.env.N8N_MARK_WORKSHEET_AUTH

  if (!url) {
    throw new Error("N8N_MARK_WORKSHEET_WEBHOOK_URL is not configured.")
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (auth) {
    headers["x-marking-key"] = auth
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`n8n worksheet-marking webhook failed (${response.status}): ${errorText}`)
  }
}
