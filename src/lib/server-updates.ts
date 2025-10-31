export {
  createGroupAction,
  readGroupAction,
  readGroupsAction,
  updateGroupAction,
  deleteGroupAction,
  removeGroupMemberAction,
  readProfileGroupsForCurrentUserAction,
  joinGroupByCodeAction,
  leaveGroupAction,
  type GroupActionResult,
  type ProfileGroupsResult,
  type JoinGroupResult,
  type LeaveGroupResult,
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
  readAssignmentResultsAction,
  overrideAssignmentScoreAction,
  resetAssignmentScoreAction,
} from "./server-actions/assignment-results"

export {
  readLessonAssignmentsAction,
  upsertLessonAssignmentAction,
  deleteLessonAssignmentAction,
} from "./server-actions/lesson-assignments"

export { readLessonAssignmentScoreSummariesAction } from "./server-actions/lesson-assignment-scores"

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
  listPupilActivitySubmissionsAction,
  uploadPupilActivitySubmissionAction,
  deletePupilActivitySubmissionAction,
  getPupilActivitySubmissionUrlAction,
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

export {
  listLessonSuccessCriteriaAction,
  linkLessonSuccessCriterionAction,
  unlinkLessonSuccessCriterionAction,
} from "./server-actions/lesson-success-criteria"

export {
  getLatestSubmissionForActivityAction,
  readLessonSubmissionSummariesAction,
  upsertMcqSubmissionAction,
} from "./server-actions/submissions"

export {
  saveShortTextAnswerAction,
  listShortTextSubmissionsAction,
  markShortTextActivityAction,
  overrideShortTextSubmissionScoreAction,
} from "./server-actions/short-text"

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
} from "./server-actions/feedback"

export { readPupilReportAction } from "./server-actions/pupils"
