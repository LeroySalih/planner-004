export {
  createGroupAction,
  readGroupAction,
  readGroupsAction,
  updateGroupAction,
  deleteGroupAction,
  type GroupActionResult,
} from "./server-actions/groups"

export {
  createUnitAction,
  readUnitAction,
  readUnitsAction,
  updateUnitAction,
  deleteUnitAction,
} from "./server-actions/units"

export {
  readLearningObjectivesByUnitAction,
  createLearningObjectiveAction,
  updateLearningObjectiveAction,
  deleteLearningObjectiveAction,
  reorderLearningObjectivesAction,
  type LearningObjectiveWithCriteria,
  type SuccessCriteriaInput,
} from "./server-actions/learning-objectives"

export {
  readLessonsByUnitAction,
  readLessonsAction,
  readLessonAction,
  createLessonAction,
  updateLessonAction,
  deactivateLessonAction,
  reorderLessonsAction,
} from "./server-actions/lessons"

export type { LessonWithObjectives } from "@/types"

export {
  createAssignmentAction,
  readAssignmentAction,
  readAssignmentsAction,
  readAssignmentsForGroupAction,
  updateAssignmentAction,
  deleteAssignmentAction,
  batchCreateAssignmentsAction,
  batchDeleteAssignmentsAction,
} from "./server-actions/assignments"

export {
  readLessonAssignmentsAction,
  upsertLessonAssignmentAction,
  deleteLessonAssignmentAction,
} from "./server-actions/lesson-assignments"

export { readSubjectsAction } from "./server-actions/subjects"

export {
  listUnitFilesAction,
  uploadUnitFileAction,
  deleteUnitFileAction,
  getUnitFileDownloadUrlAction,
} from "./server-actions/unit-files"

export {
  listLessonFilesAction,
  uploadLessonFileAction,
  deleteLessonFileAction,
  getLessonFileDownloadUrlAction,
} from "./server-actions/lesson-files"

export {
  listActivityFilesAction,
  uploadActivityFileAction,
  deleteActivityFileAction,
  getActivityFileDownloadUrlAction,
} from "./server-actions/lesson-activity-files"

export {
  listLessonLinksAction,
  createLessonLinkAction,
  updateLessonLinkAction,
  deleteLessonLinkAction,
} from "./server-actions/lesson-links"

export {
  listLessonActivitiesAction,
  createLessonActivityAction,
  updateLessonActivityAction,
  reorderLessonActivitiesAction,
  deleteLessonActivityAction,
} from "./server-actions/lesson-activities"

export { fetchLessonLinkMetadataAction } from "./server-actions/link-metadata"

export {
  readCurriculaAction,
  createCurriculumAction,
  updateCurriculumAction,
  readCurriculumDetailAction,
  createCurriculumAssessmentObjectiveAction,
  updateCurriculumAssessmentObjectiveAction,
  deleteCurriculumAssessmentObjectiveAction,
  reorderCurriculumAssessmentObjectivesAction,
  createCurriculumLearningObjectiveAction,
  updateCurriculumLearningObjectiveAction,
  deleteCurriculumLearningObjectiveAction,
  reorderCurriculumLearningObjectivesAction,
  createCurriculumSuccessCriterionAction,
  updateCurriculumSuccessCriterionAction,
  deleteCurriculumSuccessCriterionAction,
  reorderCurriculumSuccessCriteriaAction,
} from "./server-actions/curricula"

export {
  readFeedbackForLessonAction,
  upsertFeedbackAction,
  readLessonFeedbackSummariesAction,
} from "./server-actions/feedback"

export { readPupilReportAction } from "./server-actions/pupils"
