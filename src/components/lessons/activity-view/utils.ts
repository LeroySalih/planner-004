"use client"

import type { LessonActivity } from "@/types"

export interface VoiceBody {
  audioFile: string | null
  mimeType?: string | null
  duration?: number | null
  size?: number | null
  [key: string]: unknown
}

export interface ImageBody {
  imageFile: string | null
  imageUrl?: string | null
  [key: string]: unknown
}

export function isAbsoluteUrl(value: string | null): boolean {
  if (!value) return false
  return /^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("/")
}

export function getActivityTextValue(activity: LessonActivity): string {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return ""
  }
  const record = activity.body_data as Record<string, unknown>
  const text = record.text
  if (typeof text === "string") {
    return text
  }
  const instructions = record.instructions
  if (typeof instructions === "string") {
    return instructions
  }
  return ""
}

export function getActivityFileUrlValue(activity: LessonActivity): string {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return ""
  }
  const fileUrl = (activity.body_data as Record<string, unknown>).fileUrl
  return typeof fileUrl === "string" ? fileUrl : ""
}

export function getVoiceBody(activity: LessonActivity): VoiceBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { audioFile: null }
  }

  const body = activity.body_data as Record<string, unknown>
  const audioFile = typeof body.audioFile === "string" ? body.audioFile : null
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : null
  const duration = typeof body.duration === "number" ? body.duration : null
  const size = typeof body.size === "number" ? body.size : null

  return {
    ...body,
    audioFile,
    mimeType,
    duration,
    size,
  }
}

export function getImageBody(activity: LessonActivity): ImageBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { imageFile: null, imageUrl: null }
  }

  const body = activity.body_data as Record<string, unknown>
  const rawImageFile = typeof body.imageFile === "string" ? body.imageFile : null
  const rawImageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null
  const rawFileUrl = typeof body.fileUrl === "string" ? body.fileUrl : null

  let imageFile = rawImageFile
  let imageUrl = rawImageUrl

  if (!imageFile && rawFileUrl && !isAbsoluteUrl(rawFileUrl)) {
    imageFile = rawFileUrl
  }

  if (!imageUrl && rawFileUrl && isAbsoluteUrl(rawFileUrl)) {
    imageUrl = rawFileUrl
  }

  return {
    ...(body as ImageBody),
    imageFile,
    imageUrl: imageUrl ?? null,
  }
}
