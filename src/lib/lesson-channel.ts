import { z } from "zod"

export const LESSON_CHANNEL_NAME = "lesson_updates" as const
export const LESSON_CREATED_EVENT = "lesson:created" as const
export const LESSON_MUTATION_EVENT = "lesson:mutation" as const

export const LessonMutationEventSchema = z.object({
  job_id: z.string(),
  lesson_id: z.string().nullable().optional(),
  unit_id: z.string().nullable().optional(),
  type: z.string(),
  status: z.enum(["queued", "completed", "error"]),
  message: z.string().nullable().optional(),
  data: z.unknown().optional(),
})

export type LessonMutationEvent = z.infer<typeof LessonMutationEventSchema>
