export const ASSIGNMENT_RESULTS_CHANNEL_PREFIX = "results:assignments:" as const
export const ASSIGNMENT_RESULTS_UPDATE_EVENT = "assignment:results:update" as const
export const ASSIGNMENT_FEEDBACK_VISIBILITY_EVENT = "assignment:feedback:visibility" as const

export function buildAssignmentResultsChannelName(assignmentId: string): string {
  return `${ASSIGNMENT_RESULTS_CHANNEL_PREFIX}${assignmentId}`
}
