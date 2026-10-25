import { readPupilUnitsBootstrapAction } from "@/lib/server-updates";

export type PupilUnitLesson = {
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number | null;
  startDate: string | null;
  groupId: string;
  subject: string | null;
  feedbackVisible: boolean;
  isEnrolled: boolean;
  locked: boolean;
  /** One sentence for pupils on what the lesson achieves (migration 124). */
  description: string | null;
  /** The active sub unit it is grouped under, shown as a heading (migration 126). */
  subUnitId: string | null;
  subUnitTitle: string | null;
  revisionScore: number | null;
  revisionMaxScore: number | null;
  revisionDate: string | null;
  lessonScore: number | null;
  lessonMaxScore: number | null;
  lessonScorePercentage: number | null;
  resubmitCount: number;
  avgSubmissionsPerActivity: number | null;
};

export type PupilUnitEntry = {
  unitId: string;
  unitTitle: string;
  firstLessonDate: string | null;
  unitScore?: number | null;
  unitMaxScore?: number | null;
  lessons: PupilUnitLesson[];
};

export type PupilUnitSubject = {
  subject: string | null;
  units: PupilUnitEntry[];
};

export type PupilUnitsDetail = {
  pupilId: string;
  pupilName: string;
  subjects: PupilUnitSubject[];
};

function buildPupilName(
  first: string | null | undefined,
  last: string | null | undefined,
  fallback: string,
) {
  const merged = `${first ?? ""} ${last ?? ""}`.trim();
  return merged.length > 0 ? merged : fallback;
}

export async function loadPupilUnitsDetail(
  pupilId: string,
): Promise<PupilUnitsDetail> {
  const result = await readPupilUnitsBootstrapAction(pupilId);

  if (result.error) {
    throw new Error(result.error);
  }

  const data = result.data;
  if (!data) {
    throw new Error("No pupil units available.");
  }

  const pupilName = buildPupilName(
    data.profile?.first_name ?? null,
    data.profile?.last_name ?? null,
    pupilId,
  );

  return {
    pupilId,
    pupilName,
    subjects: data.subjects,
  };
}
