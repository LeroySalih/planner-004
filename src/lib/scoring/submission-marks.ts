// Marks-based counterpart to compute_submission_marks (src/migrations/077-marks-based-scoring.sql),
// mirrored in TypeScript for callers that compute scores client-side rather than via SQL.
// Priority: marks_override -> MCQ/matcher is_correct (scaled to maxMarks) -> STQ
// teacher_ai_marks/ai_marks/marks/auto_marks -> generic marks/auto_marks. Returns null if unmarked.
export function computeSubmissionMarks(
  body: unknown,
  activityType: string,
  maxMarks: number,
): number | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const clamp = (value: number | null | undefined): number | null => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }
    return Math.min(Math.max(value, 0), maxMarks);
  };
  const asInt = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : null;

  const override = asInt(record.marks_override);
  if (override !== null) return clamp(override);

  if (activityType === "multiple-choice-question" || activityType === "matcher") {
    if (typeof record.is_correct === "boolean") {
      return record.is_correct ? maxMarks : 0;
    }
    return clamp(asInt(record.marks) ?? asInt(record.auto_marks));
  }

  if (activityType === "short-text-question") {
    const value = asInt(record.teacher_ai_marks) ??
      asInt(record.ai_marks) ??
      asInt(record.marks) ??
      asInt(record.auto_marks);
    return clamp(value);
  }

  return clamp(asInt(record.marks) ?? asInt(record.auto_marks));
}
