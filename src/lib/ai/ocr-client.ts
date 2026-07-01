export interface ImageOcrParams {
  submission_id: string;
  activity_id: string;
  pupil_id: string;
  webhook_url: string;
  group_assignment_id?: string;
  images: Array<{ url: string; fileName: string }>;
}

/**
 * Fire-and-forget call to the n8n "Image -> Pupil Submission" (OCR) workflow.
 * n8n transcribes the images faithfully and POSTs the text back to webhook_url.
 */
export async function invokeImageOcr(params: ImageOcrParams): Promise<void> {
  const url = process.env.N8N_OCR_WEBHOOK_URL;
  const auth = process.env.N8N_OCR_AUTH;

  if (!url) {
    throw new Error("N8N_OCR_WEBHOOK_URL is not configured.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    headers["x-ocr-key"] = auth;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`n8n OCR webhook request failed (${response.status}): ${errorText}`);
  }
}
