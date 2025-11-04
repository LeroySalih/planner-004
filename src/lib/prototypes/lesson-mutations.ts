import { LessonMutationStateSchema } from "@/types"
import type { LessonMutationState } from "@/types"

export const LESSON_MUTATION_INITIAL_STATE: LessonMutationState =
  LessonMutationStateSchema.parse({
    status: "idle",
    jobId: null,
    message: null,
  })

export type { LessonMutationState }
