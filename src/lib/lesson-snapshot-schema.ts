import { z } from "zod"

import { pastVersionNames } from "@/lib/storage/file-versions"
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
  // All from the lesson's own folder, so versions are judged across the list.
  lessonFiles: z
    .array(LessonFileMetadataSchema)
    .default([])
    .transform((files) => {
      const pastVersions = pastVersionNames(files.map((file) => file.name))
      return files.map((file) => ({ ...file, past_version: pastVersions.has(file.name) }))
    }),
})

export type LessonDetailPayload = z.infer<typeof LessonDetailPayloadSchema>
