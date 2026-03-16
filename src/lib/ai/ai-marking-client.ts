export interface AiMarkingParams {
  question: string;
  model_answer: string;
  pupil_answer: string;
  // Callback and context for async processing
  webhook_url?: string;
  group_assignment_id?: string;
  activity_id?: string;
  pupil_id?: string;
  submission_id?: string;
}

export interface AiMarkingResult {
  score: number;
  feedback: string;
  reasoning?: string;
}

export async function invokeAiMarking(params: AiMarkingParams): Promise<AiMarkingResult> {
  const url = process.env.N8N_MARKING_WEBHOOK_URL;
  const auth = process.env.N8N_MARKING_AUTH;

  if (!url) {
    throw new Error("N8N_MARKING_WEBHOOK_URL is not configured.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    headers["x-marking-key"] = auth;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`n8n marking webhook request failed (${response.status}): ${errorText}`);
  }

  // n8n processes asynchronously and posts results back via webhook_url
  return { score: 0, feedback: "Awaiting n8n callback..." };
}
