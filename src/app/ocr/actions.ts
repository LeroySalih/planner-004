"use server"

import { GoogleGenerativeAI } from "@google/generative-ai"
import sharp from "sharp"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const OCR_PROMPT =
  "Convert the handwritten notes in the image into clean, accurate digital text. " +
  "Preserve the original wording, language, spelling, punctuation, and line breaks as closely as possible. " +
  "Do not summarize, paraphrase, or add new content. " +
  "If any word is unclear, make the best possible interpretation based on context without adding explanations. " +
  "Output only the copied text."

export interface ExtractHandwritingResponse {
  success: boolean
  text?: string
  error?: string
}

export interface SaveHandwritingScanResponse {
  success: boolean
  scanId?: string
  similarity?: number
  error?: string
}

async function toJpegIfHeic(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    const output = await sharp(buffer).jpeg({ quality: 80 }).toBuffer()
    return { buffer: output, mimeType: "image/jpeg" }
  }
  return { buffer, mimeType }
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

function similarityScore(original: string, edited: string): number {
  if (original === edited) return 1
  const maxLen = Math.max(original.length, edited.length)
  if (maxLen === 0) return 1
  const distance = levenshteinDistance(original, edited)
  return 1 - distance / maxLen
}

export async function extractHandwritingAction(
  formData: FormData,
): Promise<ExtractHandwritingResponse> {
  await requireAuthenticatedProfile()

  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    return { success: false, error: "GOOGLE_API_KEY is not set" }
  }

  const file = formData.get("file") as File | null
  const mimeType = (formData.get("mimeType") as string) || "image/jpeg"

  if (!file) {
    return { success: false, error: "No file provided" }
  }

  try {
    const ai = new GoogleGenerativeAI(apiKey)
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" })

    const rawBuffer = Buffer.from(await file.arrayBuffer())
    const converted = await toJpegIfHeic(rawBuffer, mimeType)
    const base64 = converted.buffer.toString("base64")

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64,
                mimeType: converted.mimeType,
              },
            },
            { text: OCR_PROMPT },
          ],
        },
      ],
    })

    const response = result.response
    const candidates = response.candidates
    if (!candidates || candidates.length === 0) {
      return { success: false, error: "No response from AI model" }
    }

    const text = candidates[0].content.parts[0].text
    if (!text) {
      return { success: false, error: "AI model did not return text" }
    }

    return { success: true, text }
  } catch (error: any) {
    console.error("[ocr] Extract error:", error)
    return { success: false, error: error.message || "Failed to extract text" }
  }
}

export async function saveHandwritingScanAction(
  formData: FormData,
): Promise<SaveHandwritingScanResponse> {
  const profile = await requireAuthenticatedProfile()

  const file = formData.get("file") as File | null
  const fileName = (formData.get("fileName") as string) || "scan.jpg"
  const mimeType = (formData.get("mimeType") as string) || "image/jpeg"
  const originalText = (formData.get("originalText") as string) || ""
  const editedText = (formData.get("editedText") as string) || ""

  if (!file) {
    return { success: false, error: "No file provided" }
  }

  try {
    const storage = createLocalStorageClient("ocr")
    const scanId = crypto.randomUUID()

    const rawBuffer = Buffer.from(await file.arrayBuffer())
    const converted = await toJpegIfHeic(rawBuffer, mimeType)
    const storeName = converted.mimeType === "image/jpeg" && !fileName.toLowerCase().endsWith(".jpg")
      ? fileName.replace(/\.[^.]+$/, ".jpg")
      : fileName
    const storagePath = `${scanId}/${storeName}`

    const { error: uploadError } = await storage.upload(storagePath, converted.buffer, {
      contentType: converted.mimeType,
      uploadedBy: profile.userId,
    })

    if (uploadError) {
      return { success: false, error: uploadError.message }
    }

    const score = similarityScore(originalText, editedText)

    await query(
      `INSERT INTO handwriting_scans (scan_id, user_id, image_path, original_text, edited_text, similarity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [scanId, profile.userId, storagePath, originalText, editedText, score.toFixed(4)],
    )

    return { success: true, scanId, similarity: score }
  } catch (error: any) {
    console.error("[ocr] Save error:", error)
    return { success: false, error: error.message || "Failed to save scan" }
  }
}
