// URLs shared by the server and the browser (no server-only imports).

/** One pupil's feedback PDF on an assessment paper, built when it is downloaded. */
export function assessmentFeedbackPdfUrl(activityId: string, pupilId: string): string {
  return `/api/assessment-paper/${encodeURIComponent(activityId)}/feedback-pdf?pupilId=${encodeURIComponent(pupilId)}`
}
