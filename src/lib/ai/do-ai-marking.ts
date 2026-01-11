import { z } from "zod";

export interface AiMarkingParams {
  question: string;
  model_answer: string;
  pupil_answer: string;
}

export interface AiMarkingResult {
  score: number;
  feedback: string;
  reasoning?: string;
}

export async function invokeDoAiMarking(params: AiMarkingParams): Promise<AiMarkingResult> {
  const url = process.env.AI_MARKING_URL;
  const auth = process.env.AI_MARKING_AUTH;

  if (!url || !auth) {
    throw new Error("AI_MARKING_URL or AI_MARKING_AUTH is not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": auth,
    },
    body: JSON.stringify(params),
    // 60 second timeout for AI marking
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI Marking FaaS request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  
  // The DO function returns a nested JSON string in data.body.result or data.result
  let resultStr = "";
  if (data.body && typeof data.body.result === 'string') {
    resultStr = data.body.result;
  } else if (typeof data.result === 'string') {
    resultStr = data.result;
  } else {
    // Fallback if it's already an object
    const resultObj = data.body?.result ?? data.result;
    if (resultObj && typeof resultObj === 'object') {
        return {
            score: typeof resultObj.score === 'number' ? resultObj.score : 0,
            feedback: typeof resultObj.feedback === 'string' ? resultObj.feedback : "",
            reasoning: typeof resultObj.reasoning === 'string' ? resultObj.reasoning : undefined,
        };
    }
    throw new Error("Invalid response format from AI Marking FaaS.");
  }

  try {
    const parsed = JSON.parse(resultStr);
    return {
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : "",
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    };
  } catch (e) {
    throw new Error("Failed to parse AI Marking result JSON.");
  }
}
