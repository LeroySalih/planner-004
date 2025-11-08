import { z } from "zod"

import {
  LessonActivitiesSchema,
  LessonWithObjectivesSchema,
  LessonsSchema,
  UnitSchema,
} from "@/types"

export const LessonFileMetadataSchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  last_accessed_at: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
})

export const LessonDetailPayloadSchema = z.object({
  lesson: LessonWithObjectivesSchema.nullable(),
  unit: UnitSchema.nullable().optional(),
  unitLessons: LessonsSchema.default([]),
  lessonActivities: LessonActivitiesSchema.default([]),
  lessonFiles: z.array(LessonFileMetadataSchema).default([]),
})

export type LessonDetailPayload = z.infer<typeof LessonDetailPayloadSchema>
