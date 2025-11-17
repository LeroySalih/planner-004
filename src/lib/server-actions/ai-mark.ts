"use server"

import { z } from "zod"

import { withTelemetry } from "@/lib/telemetry"

const AiMarkAnswerSchema = z.object({
  pupilId: z.string().min(1),
  provided_answer: z.string(),
})

const AiMarkPayloadSchema = z.object({
  requestid: z.string().min(1),
  question_text: z.string(),
  model_answer: z.string(),
  provided_answers: z.array(AiMarkAnswerSchema),
  group_assignment_id: z.string().min(3),
  activity_id: z.string().min(1),
})

export type AiMarkPayload = z.infer<typeof AiMarkPayloadSchema>

export async function requestAiMarkAction(
  input: AiMarkPayload,
  options?: { authEndTime?: number | null; routeTag?: string },
) {
  const parsed = AiMarkPayloadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid AI mark request.",
    }
  }

  const endpoint = process.env.AI_MARK_URL ?? process.env.NEXT_PUBLIC_AI_MARK_URL
  if (!endpoint) {
    return {
      success: false,
      error: "AI_MARK_URL is not configured.",
    }
  }

  const webhookUrl = process.env.AI_MARK_WEBHOOK_URL ?? process.env.NEXT_PUBLIC_AI_MARK_WEBHOOK_URL
  if (!webhookUrl) {
    return {
      success: false,
      error: "AI_MARK_WEBHOOK_URL is not configured.",
    }
  }

  const serviceKey = process.env.AI_MARK_SERVICE_KEY
  if (!serviceKey) {
    return {
      success: false,
      error: "AI_MARK_SERVICE_KEY is not configured.",
    }
  }

  const authEndTime = options?.authEndTime ?? Date.now()
  const routeTag = options?.routeTag ?? "/results/assignments"

  return withTelemetry(
    {
      routeTag,
      functionName: "requestAiMarkAction",
      params: { requestid: parsed.data.requestid },
      authEndTime,
    },
    async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "mark-service-Key": serviceKey,
          "mark-webhook-url": webhookUrl,
        },
        body: JSON.stringify({
          ...parsed.data,
          webhook_url: webhookUrl,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "AI mark endpoint returned an error.")
        return {
          success: false,
          error: errorText || "AI mark endpoint returned an error.",
        }
      }

      return {
        success: true,
        error: null,
      }
    },
  )
}
