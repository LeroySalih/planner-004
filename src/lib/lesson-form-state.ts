import type { LearningObjectiveWithCriteria, SuccessCriterion } from "@/types"

export type LessonObjectiveFormState = {
  status: "idle" | "success" | "error"
  message: string | null
  learningObjective: LearningObjectiveWithCriteria | null
}

export const INITIAL_LESSON_OBJECTIVE_FORM_STATE: LessonObjectiveFormState = {
  status: "idle",
  message: null,
  learningObjective: null,
}

export type LessonSuccessCriterionFormState = {
  status: "idle" | "success" | "error"
  message: string | null
  successCriterion: SuccessCriterion | null
}

export const INITIAL_LESSON_SUCCESS_CRITERION_FORM_STATE: LessonSuccessCriterionFormState = {
  status: "idle",
  message: null,
  successCriterion: null,
}
