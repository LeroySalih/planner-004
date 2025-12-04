import { readPupilUnitsBootstrapAction } from "@/lib/server-updates"

export type PupilUnitLessonMediaImage = {
  activityId: string
  title: string | null
  orderBy: number | null
  imageFile: string | null
  imageUrl: string | null
  fileUrl: string | null
}

export type PupilUnitLessonFile = {
  name: string
  path: string
  mimeType: string | null
  size: number | null
  updatedAt: string | null
}

export type PupilUnitLesson = {
  lessonId: string
  lessonTitle: string
  lessonOrder: number | null
  startDate: string | null
  groupId: string
  subject: string | null
  feedbackVisible: boolean
  isEnrolled: boolean
  objectives: Array<{
    id: string
    title: string
    orderIndex: number | null
  }>
  displayImages: PupilUnitLessonMediaImage[]
  files: PupilUnitLessonFile[]
}

export type PupilUnitEntry = {
  unitId: string
  unitTitle: string
  firstLessonDate: string | null
  lessons: PupilUnitLesson[]
}

export type PupilUnitSubject = {
  subject: string | null
  units: PupilUnitEntry[]
}

export type PupilUnitsDetail = {
  pupilId: string
  pupilName: string
  subjects: PupilUnitSubject[]
}

function buildPupilName(first: string | null | undefined, last: string | null | undefined, fallback: string) {
  const merged = `${first ?? ""} ${last ?? ""}`.trim()
  return merged.length > 0 ? merged : fallback
}

export async function loadPupilUnitsDetail(pupilId: string): Promise<PupilUnitsDetail> {
  const result = await readPupilUnitsBootstrapAction(pupilId)

  if (result.error) {
    throw new Error(result.error)
  }

  const data = result.data
  if (!data) {
    throw new Error("No pupil units available.")
  }

  const pupilName = buildPupilName(data.profile?.first_name ?? null, data.profile?.last_name ?? null, pupilId)

  return {
    pupilId,
    pupilName,
    subjects: data.subjects,
  }
}
