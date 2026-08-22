import "server-only"

import { callModel, type ModelPart } from "@/lib/ai/model-client"
import { resolveModelRoute } from "@/lib/ai/model-routing"

// The transcription rule is unchanged from the n8n flow it replaces (see
// docs/n8n/image-to-pupil-submission-workflow.md): transcribe faithfully,
// because SPAG is part of what is being marked downstream.
const SYSTEM = `You transcribe handwritten pupil work from images.

Transcribe EXACTLY what is written. Preserve the pupil's spelling, punctuation,
grammar and capitalisation precisely as they appear. Do NOT correct anything —
spelling, punctuation and grammar are part of what is being marked.

Do not add commentary, headings or explanation. Return the transcription only.
Where a page has numbered questions, keep the numbering.

If several images are supplied they are pages in order; separate each page's
transcription with a single blank line.

If an image contains no legible handwriting, return nothing for that page.`

export interface OcrImage {
  base64: string
  fileName: string
}

function inferMime(fileName: string): string {
  const name = fileName.toLowerCase()
  if (name.endsWith(".png")) return "image/png"
  if (name.endsWith(".webp")) return "image/webp"
  if (name.endsWith(".gif")) return "image/gif"
  return "image/jpeg"
}

/**
 * Transcribe pupil worksheet images to plain text.
 *
 * Returns the text directly — unlike the n8n flow this replaces, there is no
 * JSON envelope to unwrap, so `normaliseOcrText` in apply-ocr-text has nothing
 * to do and simply passes it through.
 */
export async function transcribeWithModel(images: OcrImage[]): Promise<string> {
  if (images.length === 0) return ""

  const parts: ModelPart[] = [
    { text: `Transcribe the ${images.length === 1 ? "image" : `${images.length} images`}.` },
  ]

  for (const image of images) {
    parts.push({
      inline_data: { mime_type: inferMime(image.fileName), data: image.base64 },
    })
  }

  // Its own surface rather than upload-worksheet's route: transcription and
  // marking are separate calls with different demands — reading handwriting is
  // vision-bound, judging the answer is not — so they should be tunable apart.
  const route = await resolveModelRoute("surface:worksheet-ocr")

  const result = await callModel({
    provider: route.provider,
    model: route.model,
    systemText: SYSTEM,
    parts,
    temperature: 0,
    timeoutMs: 180_000,
  })

  return result.text.trim()
}
