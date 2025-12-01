export {
  createGroupAction,
  readGroupAction,
  readGroupsAction,
  listPupilsWithGroupsAction,
  updateGroupAction,
  deleteGroupAction,
  removeGroupMemberAction,
  resetPupilPasswordAction,
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
  triggerUnitUpdateJobAction,
  triggerUnitDeactivateJobAction,
} from "./server-actions/units"

export {
  readLearningObjectivesByUnitAction,
  readAllLearningObjectivesAction,
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
  readLessonDetailBootstrapAction,
  readLessonReferenceDataAction,
  createLessonAction,
  updateLessonAction,
  updateLessonHeaderAction,
  updateLessonHeaderMutation,
  triggerLessonCreateJobAction,
  setLessonSuccessCriteriaAction,
  createLessonLearningObjectiveAction,
  createLessonLearningObjectiveFormAction,
  createLessonSuccessCriterionAction,
  createLessonSuccessCriterionFormAction,
  deactivateLessonAction,
  reorderLessonsAction,
  type LessonHeaderUpdateState,
} from "./server-actions/lessons"

export type {
  LessonWithObjectives,
  LessonSuccessCriterion,
  SuccessCriterion,
} from "@/types"

export {
  createAssignmentAction,
  readAssignmentAction,
  readAssignmentsAction,
  readAssignmentsForGroupAction,
  updateAssignmentAction,
  deleteAssignmentAction,
} from "./server-actions/assignments"
export { readAssignmentsBootstrapAction } from "./server-actions/assignments-bootstrap"

export {
  readAssignmentResultsAction,
  updateAssignmentFeedbackVisibilityAction,
  overrideAssignmentScoreAction,
  resetAssignmentScoreAction,
  clearActivityAiMarksAction,
} from "./server-actions/assignment-results"
export { requestAiMarkAction } from "./server-actions/ai-mark"

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
  updatePupilSubmissionStatusAction,
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
  listLessonsSuccessCriteriaAction,
  linkLessonSuccessCriterionAction,
  unlinkLessonSuccessCriterionAction,
} from "./server-actions/lesson-success-criteria"

export { listLessonsLearningObjectivesAction } from "./server-actions/lesson-learning-objectives"

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

export {
  readQueueFiltersAction,
  readQueueItemsAction,
  updateUploadSubmissionStatusAction,
  readQueueAllItemsAction,
  getQueueFileDownloadUrlAction,
} from "./server-actions/upload-queue"

export { fetchLessonLinkMetadataAction } from "./server-actions/link-metadata"

export {
  readCurriculaAction,
  readAssessmentObjectivesAction,
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
export {
  readPupilLessonsSummaryBootstrapAction,
  readPupilLessonsDetailBootstrapAction,
  type PupilLessonsSummaryBootstrap,
  type PupilLessonsDetailBootstrap,
} from "./server-actions/pupil-lessons"

export {
  readCurrentProfileAction,
  updateCurrentProfileAction,
  type ReadCurrentProfileResult,
  type UpdateCurrentProfileInput,
  type UpdateCurrentProfileResult,
  readProfileDetailAction,
  updateProfileDetailAction,
  type ReadProfileDetailResult,
  type UpdateProfileDetailInput,
  type UpdateProfileDetailResult,
  updateProfilePasswordAction,
  type UpdateProfilePasswordResult,
} from "./server-actions/profile"

export { triggerFastUiUpdateAction } from "./server-actions/prototypes/fast-ui"

export { FAST_UI_INITIAL_STATE, FAST_UI_MAX_COUNTER, type FastUiActionState } from "./prototypes/fast-ui"
export { UNIT_MUTATION_INITIAL_STATE, type UnitMutationState } from "./prototypes/unit-mutations"
export { LESSON_MUTATION_INITIAL_STATE, type LessonMutationState } from "./prototypes/lesson-mutations"

export { runPupilReportRecalcAction } from "./server-actions/reports"
export {
  signinAction,
  signupAction,
  signoutAction,
  getSessionProfileAction,
} from "./server-actions/auth"
