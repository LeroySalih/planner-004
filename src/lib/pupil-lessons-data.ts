import { compareDesc, format, parseISO, startOfWeek } from "date-fns"

import {
  readPupilLessonsSummaryBootstrapAction,
  readPupilLessonsDetailBootstrapAction,
  listLessonsLearningObjectivesAction,
  listLessonsSuccessCriteriaAction,
  type PupilLessonsSummaryBootstrap,
  type PupilLessonsDetailBootstrap,
} from "@/lib/server-updates"
import type { LessonSuccessCriterion } from "@/types"

export type PupilLessonLesson = {
  lessonId: string
  title: string
  unitId: string
  startDate: string | null
  feedbackVisible: boolean
}

export type PupilLessonGroup = {
  groupId: string
  subject: string | null
  lessons: PupilLessonLesson[]
}

export type PupilLessonSection = {
  date: string
  groups: PupilLessonGroup[]
}

export type PupilLessonsSummary = {
  pupilId: string
  name: string
  groups: string[]
  sections: PupilLessonSection[]
}

export type PupilHomeworkItem = {
  activityId: string
  activityTitle: string
  lessonId: string
  lessonTitle: string
  unitId: string
  subject: string | null
  groupId: string
  date: string | null
}

export type PupilHomeworkSection = {
  date: string | null
  items: PupilHomeworkItem[]
}

export type PupilLessonSuccessCriterion = {
  id: string
  description: string
  level: number | null
}

export type PupilLessonObjective = {
  id: string
  title: string
  assessmentObjectiveCode: string | null
  successCriteria: PupilLessonSuccessCriterion[]
  isUnlinked?: boolean
}

export type PupilLessonWeekSubject = {
  subject: string | null
  lessons: Array<{
    lessonId: string
    lessonTitle: string
    unitId: string
    unitTitle: string
    date: string
    groupId: string
    hasHomework: boolean
    objectives: PupilLessonObjective[]
    feedbackVisible: boolean
    assignmentId: string
  }>
}

export type PupilLessonWeek = {
  weekStart: string
  label: string
  subjects: PupilLessonWeekSubject[]
}

export type PupilSubjectUnitsEntry = {
  subject: string
  units: Array<{
    unitId: string
    unitTitle: string
    learningObjectives: Array<{
      id: string
      title: string
      assessmentObjectiveCode: string | null
      successCriteria: Array<{
        id: string
        description: string
        level: number | null
      }>
    }>
  }>
}

export type PupilLessonsDetail = {
  summary: PupilLessonsSummary | null
  assignments: PupilLessonAssignment[]
  homework: PupilHomeworkSection[]
  weeks: PupilLessonWeek[]
  units: PupilSubjectUnitsEntry[]
}

export type PupilLessonAssignment = {
  lessonId: string
  lessonTitle: string
  unitId: string
  subject: string | null
  groupId: string
  date: string | null
  feedbackVisible: boolean
  assignmentId: string
}

type SummaryBootstrapPayload = PupilLessonsSummaryBootstrap

type SummaryBootstrapPupil = SummaryBootstrapPayload["pupils"][number]
type SummaryBootstrapMembership = SummaryBootstrapPayload["memberships"][number]
type SummaryBootstrapAssignment = SummaryBootstrapPayload["lessonAssignments"][number]

type GroupEntry = {
  subject: string | null
  pupils: Set<string>
}

type PupilInfoEntry = {
  name: string
  groups: Set<string>
}

type LessonGroupEntry = {
  groupId: string
  subject: string | null
  lessons: PupilLessonLesson[]
}

type DateMap = Map<string, Map<string, LessonGroupEntry>>

const EMPTY_SUMMARY_PAYLOAD: SummaryBootstrapPayload = {
  pupils: [],
  memberships: [],
  lessonAssignments: [],
}

function createDisplayName(first: string | null | undefined, last: string | null | undefined, fallback: string) {
  const trimmedFirst = first?.trim() ?? ""
  const trimmedLast = last?.trim() ?? ""
  const merged = `${trimmedFirst} ${trimmedLast}`.trim()
  return merged.length > 0 ? merged : fallback
}

function normalizeSummaryDatasetFromDetail(detail: PupilLessonsDetailBootstrap | null): SummaryBootstrapPayload {
  if (!detail) {
    return EMPTY_SUMMARY_PAYLOAD
  }

  const pupils: SummaryBootstrapPupil[] = detail.pupilProfile
    ? [
        {
          user_id: detail.pupilProfile.user_id,
          display_name: createDisplayName(
            detail.pupilProfile.first_name,
            detail.pupilProfile.last_name,
            detail.pupilProfile.user_id,
          ),
          first_name: detail.pupilProfile.first_name ?? null,
          last_name: detail.pupilProfile.last_name ?? null,
        },
      ]
    : []

  const lessonAssignments: SummaryBootstrapAssignment[] = (detail.lessonAssignments ?? []).map((assignment) => ({
    group_id: assignment.group_id,
    lesson_id: assignment.lesson_id,
    start_date: assignment.start_date ?? null,
    lesson_title: assignment.lesson_title ?? null,
    unit_id: assignment.unit_id ?? null,
    subject: assignment.subject ?? null,
    feedback_visible: assignment.feedback_visible ?? null,
  }))

  return {
    pupils,
    memberships: detail.memberships ?? [],
    lessonAssignments,
  }
}

function buildSummariesFromBootstrap(payload: SummaryBootstrapPayload, targetPupilId?: string) {
  const groupInfoMap = new Map<string, GroupEntry>()
  const pupilInfoMap = new Map<string, PupilInfoEntry>()

  payload.pupils.forEach((pupil) => {
    const name = pupil.display_name?.trim().length
      ? pupil.display_name.trim()
      : createDisplayName(pupil.first_name, pupil.last_name, pupil.user_id)
    pupilInfoMap.set(pupil.user_id, {
      name,
      groups: new Set<string>(),
    })
  })

  payload.memberships.forEach((membership) => {
    if (!membership.user_id || !membership.group_id) {
      return
    }

    const info = pupilInfoMap.get(membership.user_id) ?? {
      name: createDisplayName(null, null, membership.user_id),
      groups: new Set<string>(),
    }
    info.groups.add(membership.group_id)
    pupilInfoMap.set(membership.user_id, info)

    const groupEntry = groupInfoMap.get(membership.group_id) ?? {
      subject: membership.subject ?? null,
      pupils: new Set<string>(),
    }
    if (!groupEntry.subject) {
      groupEntry.subject = membership.subject ?? null
    }
    groupEntry.pupils.add(membership.user_id)
    groupInfoMap.set(membership.group_id, groupEntry)
  })

  if (targetPupilId && !pupilInfoMap.has(targetPupilId)) {
    return []
  }

  const lessonStructure = new Map<string, DateMap>()

  payload.lessonAssignments.forEach((assignment) => {
    const groupId = assignment.group_id
    const lessonId = assignment.lesson_id
    if (!groupId || !lessonId) {
      return
    }

    const groupInfo = groupInfoMap.get(groupId)
    if (!groupInfo) {
      return
    }

    const candidatePupilIds = targetPupilId
      ? groupInfo.pupils.has(targetPupilId)
        ? [targetPupilId]
        : []
      : Array.from(groupInfo.pupils)

    if (candidatePupilIds.length === 0) {
      return
    }

    const dateKey = assignment.start_date ?? ""
    const subject = assignment.subject ?? groupInfo.subject ?? null
    const lessonTitle = assignment.lesson_title?.trim() || "Untitled lesson"
    const unitId = assignment.unit_id ?? "unknown"

    candidatePupilIds.forEach((pupilId) => {
      const dateMap: DateMap = lessonStructure.get(pupilId) ?? new Map<string, Map<string, LessonGroupEntry>>()
      const groupsMap = dateMap.get(dateKey) ?? new Map<string, LessonGroupEntry>()
      const groupEntry = groupsMap.get(groupId) ?? {
        groupId,
        subject,
        lessons: [],
      }

      if (!groupEntry.subject) {
        groupEntry.subject = subject
      }

      groupEntry.lessons.push({
        lessonId,
        title: lessonTitle,
        unitId,
        startDate: assignment.start_date ?? null,
        feedbackVisible: Boolean(assignment.feedback_visible),
      })

      groupsMap.set(groupId, groupEntry)
      dateMap.set(dateKey, groupsMap)
      lessonStructure.set(pupilId, dateMap)
    })
  })

  const basePupilIds = targetPupilId ? [targetPupilId] : Array.from(pupilInfoMap.keys())
  const results: PupilLessonsSummary[] = []

  basePupilIds.forEach((pupilId) => {
    const info = pupilInfoMap.get(pupilId)
    if (!info) {
      return
    }

    const dateMap: DateMap = lessonStructure.get(pupilId) ?? new Map<string, Map<string, LessonGroupEntry>>()

    const sections: PupilLessonSection[] = Array.from(dateMap.entries())
      .map(([date, groupsMap]) => ({
        date,
        groups: Array.from(groupsMap.values())
          .map((entry) => ({
            groupId: entry.groupId,
            subject: entry.subject,
            lessons: entry.lessons.sort((a, b) => a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => a.groupId.localeCompare(b.groupId)),
      }))
      .sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : Number.NEGATIVE_INFINITY
        const dateB = b.date ? new Date(b.date).getTime() : Number.NEGATIVE_INFINITY
        return dateA - dateB
      })

    results.push({
      pupilId,
      name: info.name,
      groups: Array.from(info.groups).sort((a, b) => a.localeCompare(b)),
      sections,
    })
  })

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null
  }

  try {
    const parsed = parseISO(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  } catch (error) {
    console.error("[pupil-lessons] Failed to parse date", value, error)
    return null
  }
}

function createWeekLabel(date: Date) {
  try {
    return format(date, "'w/c' d MMM yyyy")
  } catch (error) {
    console.error("[pupil-lessons] Failed to format week label", date, error)
    return format(date, "yyyy-MM-dd")
  }
}

const UNLINKED_OBJECTIVE_ID = "__unlinked__"
const UNLINKED_OBJECTIVE_TITLE = "Additional success criteria"

type LessonObjectiveLinkEntry = {
  learningObjectiveId: string
  orderIndex: number | null
}

type LearningObjectiveMeta = {
  id: string
  title: string
  assessmentObjectiveCode: string | null
}

function normalizeObjectiveTitle(title: string | null | undefined) {
  if (!title) {
    return "Learning objective"
  }

  const trimmed = title.trim()
  return trimmed.length > 0 ? trimmed : "Learning objective"
}

function normalizeCriterionDescription(title: string, description: string | null | undefined) {
  if (typeof description === "string" && description.trim().length > 0) {
    return description.trim()
  }
  return title
}

function buildLessonObjectivesForLesson({
  lessonId,
  links,
  successCriteria,
  learningObjectiveMeta,
}: {
  lessonId: string
  links: LessonObjectiveLinkEntry[]
  successCriteria: LessonSuccessCriterion[]
  learningObjectiveMeta: Map<string, LearningObjectiveMeta>
}): PupilLessonObjective[] {
  const orderMap = new Map<string, number>()
  links.forEach((link) => {
    const orderValue =
      typeof link.orderIndex === "number" && Number.isFinite(link.orderIndex)
        ? link.orderIndex
        : Number.MAX_SAFE_INTEGER
    orderMap.set(link.learningObjectiveId, orderValue)
  })

  const successCriteriaByObjective = new Map<string | null, LessonSuccessCriterion[]>()
  successCriteria.forEach((criterion) => {
    const objectiveId = criterion.learning_objective_id ?? null
    const list = successCriteriaByObjective.get(objectiveId) ?? []
    list.push(criterion)
    successCriteriaByObjective.set(objectiveId, list)
  })

  successCriteriaByObjective.forEach((list) =>
    list.sort((a, b) => {
      const levelA = typeof a.level === "number" ? a.level : Number.POSITIVE_INFINITY
      const levelB = typeof b.level === "number" ? b.level : Number.POSITIVE_INFINITY
      if (levelA !== levelB) {
        return levelA - levelB
      }
      return normalizeCriterionDescription(a.title, a.description).localeCompare(
        normalizeCriterionDescription(b.title, b.description),
      )
    }),
  )

  const hasUnlinkedCriteria = successCriteriaByObjective.has(null)
  const objectiveIds = new Set<string>()

  links.forEach((link) => objectiveIds.add(link.learningObjectiveId))
  successCriteria.forEach((criterion) => {
    if (criterion.learning_objective_id) {
      objectiveIds.add(criterion.learning_objective_id)
    } else if (hasUnlinkedCriteria) {
      objectiveIds.add(UNLINKED_OBJECTIVE_ID)
    }
  })

  const entries: Array<{ orderValue: number; objective: PupilLessonObjective }> = []

  objectiveIds.forEach((objectiveId) => {
    const isUnlinked = objectiveId === UNLINKED_OBJECTIVE_ID
    const meta = isUnlinked ? null : learningObjectiveMeta.get(objectiveId)
    const criteriaKey = isUnlinked ? null : objectiveId
    const criteria = (successCriteriaByObjective.get(criteriaKey) ?? []).map((criterion) => ({
      id: criterion.success_criteria_id,
      description: normalizeCriterionDescription(criterion.title, criterion.description),
      level: typeof criterion.level === "number" ? criterion.level : null,
    }))

    const orderValue = isUnlinked
      ? Number.MAX_SAFE_INTEGER
      : orderMap.get(objectiveId) ?? Number.MAX_SAFE_INTEGER

    entries.push({
      orderValue,
      objective: {
        id: meta?.id ?? (isUnlinked ? `${lessonId}-unlinked` : objectiveId),
        title: meta ? normalizeObjectiveTitle(meta.title) : isUnlinked ? UNLINKED_OBJECTIVE_TITLE : "Learning objective",
        assessmentObjectiveCode: meta?.assessmentObjectiveCode ?? null,
        successCriteria: criteria,
        isUnlinked: isUnlinked || undefined,
      },
    })
  })

  return entries
    .sort((a, b) => {
      if (a.orderValue !== b.orderValue) {
        return a.orderValue - b.orderValue
      }
      return a.objective.title.localeCompare(b.objective.title)
    })
    .map((entry) => entry.objective)
}

export async function loadPupilLessonsSummaries(targetPupilId?: string): Promise<PupilLessonsSummary[]> {
  const result = await readPupilLessonsSummaryBootstrapAction(targetPupilId)

  if (result.error) {
    throw new Error(result.error)
  }

  const payload = result.data ?? EMPTY_SUMMARY_PAYLOAD
  return buildSummariesFromBootstrap(payload, targetPupilId)
}

export async function loadPupilLessonsDetail(pupilId: string): Promise<PupilLessonsDetail> {
  const detailResult = await readPupilLessonsDetailBootstrapAction(pupilId)

  if (detailResult.error) {
    throw new Error(detailResult.error)
  }

  const detailData: PupilLessonsDetailBootstrap =
    detailResult.data ?? {
      pupilProfile: null,
      memberships: [],
      lessonAssignments: [],
      units: [],
      learningObjectives: [],
      successCriteria: [],
      successCriteriaUnits: [],
      homeworkActivities: [],
    }

  const summaryDataset = normalizeSummaryDatasetFromDetail(detailData)
  const summary = buildSummariesFromBootstrap(summaryDataset, pupilId)[0] ?? null

  const assignments = detailData.lessonAssignments
    .filter((assignment) => assignment.lesson_id && assignment.group_id)
    .map((assignment) => ({
      lessonId: assignment.lesson_id,
      lessonTitle: assignment.lesson_title?.trim() || "Untitled lesson",
      unitId: assignment.unit_id ?? "",
      subject: assignment.subject ?? null,
      groupId: assignment.group_id,
      date: assignment.start_date ?? null,
      feedbackVisible: Boolean(assignment.feedback_visible),
      assignmentId: `${assignment.group_id}__${assignment.lesson_id}`,
    }))

  const unitTitleMap = new Map<string, string>()
  const unitSubjectMap = new Map<string, string | null>()

  detailData.units.forEach((unit) => {
    unitTitleMap.set(unit.unit_id, unit.title?.trim() || unit.unit_id)
    unitSubjectMap.set(unit.unit_id, unit.subject ?? null)
  })

  const lessonHomeworkActivitiesMap = new Map<
    string,
    PupilLessonsDetailBootstrap["homeworkActivities"][number][]
  >()
  detailData.homeworkActivities.forEach((activity) => {
    if (!activity.lesson_id) {
      return
    }
    const list = lessonHomeworkActivitiesMap.get(activity.lesson_id) ?? []
    list.push(activity)
    lessonHomeworkActivitiesMap.set(activity.lesson_id, list)
  })

  const homeworkEntries: PupilHomeworkItem[] = assignments.flatMap((assignment) => {
    if (!assignment.lessonId) {
      return []
    }
    const activities = lessonHomeworkActivitiesMap.get(assignment.lessonId) ?? []
    if (activities.length === 0) {
      return []
    }

    return activities.map((activity) => ({
      activityId: activity.activity_id,
      activityTitle: activity.title?.trim() || "Untitled activity",
      lessonId: assignment.lessonId,
      lessonTitle: assignment.lessonTitle,
      unitId: assignment.unitId,
      subject: assignment.subject,
      groupId: assignment.groupId,
      date: assignment.date,
    }))
  })

  const homeworkByDate = new Map<string | null, PupilHomeworkItem[]>()
  homeworkEntries.forEach((entry) => {
    const list = homeworkByDate.get(entry.date) ?? []
    list.push(entry)
    homeworkByDate.set(entry.date, list)
  })

  const homeworkSections: PupilHomeworkSection[] = Array.from(homeworkByDate.entries())
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => a.lessonTitle.localeCompare(b.lessonTitle)),
    }))
    .sort((a, b) => {
      const dateA = parseDate(a.date)
      const dateB = parseDate(b.date)
      if (dateA && dateB) {
        return compareDesc(dateA, dateB)
      }
      if (dateA) {
        return -1
      }
      if (dateB) {
        return 1
      }
      return 0
    })

  const successCriteriaByObjective = new Map<
    string,
    PupilLessonsDetailBootstrap["successCriteria"][number][]
  >()
  detailData.successCriteria.forEach((criterion) => {
    const existing = successCriteriaByObjective.get(criterion.learning_objective_id) ?? []
    existing.push(criterion)
    successCriteriaByObjective.set(criterion.learning_objective_id, existing)
  })

  const successCriteriaUnitsMap = new Map<string, Set<string>>()
  detailData.successCriteriaUnits.forEach((entry) => {
    const list = successCriteriaUnitsMap.get(entry.success_criteria_id) ?? new Set<string>()
    list.add(entry.unit_id)
    successCriteriaUnitsMap.set(entry.success_criteria_id, list)
  })

  const unitIdsInAssignments = new Set(assignments.map((assignment) => assignment.unitId).filter((unitId) => unitId))

  type ObjectiveEntry = {
    id: string
    title: string
    assessmentObjectiveCode: string | null
    successCriteria: Array<{
      id: string
      description: string
      level: number | null
    }>
  }

  const unitObjectivesMap = new Map<string, ObjectiveEntry[]>()
  const learningObjectiveMeta = new Map<string, LearningObjectiveMeta>()

  detailData.learningObjectives.forEach((objective) => {
    learningObjectiveMeta.set(objective.learning_objective_id, {
      id: objective.learning_objective_id,
      title: objective.title,
      assessmentObjectiveCode: objective.assessment_objective_code ?? null,
    })

    const unitId = objective.assessment_objective_unit_id
    if (!unitId || !unitIdsInAssignments.has(unitId)) {
      return
    }

    const criteria = (successCriteriaByObjective.get(objective.learning_objective_id) ?? [])
      .filter((criterion) => {
        const allowedUnits = successCriteriaUnitsMap.get(criterion.success_criteria_id)
        return !allowedUnits || allowedUnits.size === 0 || allowedUnits.has(unitId)
      })
      .map((criterion, index) => ({
        id: criterion.success_criteria_id ?? `${objective.learning_objective_id}-${index}`,
        description: criterion.description ?? "No success criterion description provided.",
        level: criterion.level ?? null,
      }))
      .sort((a, b) => a.description.localeCompare(b.description))

    const list = unitObjectivesMap.get(unitId) ?? []
    list.push({
      id: objective.learning_objective_id,
      title: objective.title,
      assessmentObjectiveCode: objective.assessment_objective_code ?? null,
      successCriteria: criteria,
    })
    unitObjectivesMap.set(unitId, list)
  })

  const lessonIds = Array.from(
    new Set(assignments.map((assignment) => assignment.lessonId).filter((id): id is string => Boolean(id))),
  )

  let lessonSuccessCriteriaResult: Awaited<ReturnType<typeof listLessonsSuccessCriteriaAction>>
  let lessonObjectiveLinksResult: Awaited<ReturnType<typeof listLessonsLearningObjectivesAction>>

  if (lessonIds.length === 0) {
    lessonSuccessCriteriaResult = { data: [], error: null }
    lessonObjectiveLinksResult = { data: [], error: null }
  } else {
    ;[lessonSuccessCriteriaResult, lessonObjectiveLinksResult] = await Promise.all([
      listLessonsSuccessCriteriaAction(lessonIds),
      listLessonsLearningObjectivesAction(lessonIds),
    ])
  }

  if (lessonSuccessCriteriaResult.error) {
    throw new Error(lessonSuccessCriteriaResult.error)
  }
  if (lessonObjectiveLinksResult.error) {
    throw new Error(lessonObjectiveLinksResult.error)
  }

  lessonObjectiveLinksResult.data.forEach((entry) => {
    if (!entry.learningObjectiveId) {
      return
    }

    const nextTitle = typeof entry.learningObjectiveTitle === "string" ? entry.learningObjectiveTitle.trim() : ""
    const lessonLinkTitle =
      typeof entry.lessonObjectiveTitle === "string" ? entry.lessonObjectiveTitle.trim() : ""
    const resolvedTitle = nextTitle || lessonLinkTitle
    const nextAssessmentCode =
      typeof entry.assessmentObjectiveCode === "string" && entry.assessmentObjectiveCode.length > 0
        ? entry.assessmentObjectiveCode
        : null
    const existing = learningObjectiveMeta.get(entry.learningObjectiveId)

    if (!existing) {
      if (!resolvedTitle && !nextAssessmentCode) {
        return
      }
      learningObjectiveMeta.set(entry.learningObjectiveId, {
        id: entry.learningObjectiveId,
        title: resolvedTitle || "Learning objective",
        assessmentObjectiveCode: nextAssessmentCode,
      })
      return
    }

    let shouldUpdate = false
    const updated = { ...existing }

    if (
      resolvedTitle &&
      (!updated.title || updated.title.trim().length === 0 || updated.title === "Learning objective")
    ) {
      updated.title = resolvedTitle
      shouldUpdate = true
    }

    if (nextAssessmentCode && !updated.assessmentObjectiveCode) {
      updated.assessmentObjectiveCode = nextAssessmentCode
      shouldUpdate = true
    }

    if (shouldUpdate) {
      learningObjectiveMeta.set(entry.learningObjectiveId, updated)
    }
  })

  const lessonSuccessCriteriaMap = new Map<string, LessonSuccessCriterion[]>()
  lessonSuccessCriteriaResult.data.forEach((entry) => {
    if (!entry.lesson_id) {
      return
    }
    const list = lessonSuccessCriteriaMap.get(entry.lesson_id) ?? []
    list.push(entry)
    lessonSuccessCriteriaMap.set(entry.lesson_id, list)
  })

  const lessonObjectiveLinksMap = new Map<string, LessonObjectiveLinkEntry[]>()
  lessonObjectiveLinksResult.data.forEach((entry) => {
    if (!entry.lessonId || !entry.learningObjectiveId) {
      return
    }
    const list = lessonObjectiveLinksMap.get(entry.lessonId) ?? []
    list.push({
      learningObjectiveId: entry.learningObjectiveId,
      orderIndex: entry.orderIndex ?? null,
    })
    lessonObjectiveLinksMap.set(entry.lessonId, list)
  })

  const now = new Date()
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 0 })

  const weeksMap = new Map<
    string,
    {
      weekStart: string
      label: string
      subjects: Map<string, PupilLessonWeekSubject>
    }
  >()

  const subjectUnitsMap = new Map<string, Set<string>>()

  assignments.forEach((assignment) => {
    const dateValue = parseDate(assignment.date)
    if (!dateValue) {
      return
    }

    const weekStartDate = startOfWeek(dateValue, { weekStartsOn: 0 })
    if (weekStartDate > currentWeekStart) {
      return
    }

    const weekKey = weekStartDate.toISOString()
    const existingWeek = weeksMap.get(weekKey) ?? {
      weekStart: weekStartDate.toISOString(),
      label: createWeekLabel(weekStartDate),
      subjects: new Map<string, PupilLessonWeekSubject>(),
    }

    const subjectKey = assignment.subject ?? unitSubjectMap.get(assignment.unitId) ?? "Subject not set"
    const subjectEntry = existingWeek.subjects.get(subjectKey) ?? {
      subject: assignment.subject ?? unitSubjectMap.get(assignment.unitId) ?? null,
      lessons: [] as PupilLessonWeekSubject["lessons"],
    }

    if (assignment.lessonId && assignment.date) {
      const lessonDate = parseDate(assignment.date)
      const homeworkActivities = lessonHomeworkActivitiesMap.get(assignment.lessonId) ?? []
      const lessonObjectives = buildLessonObjectivesForLesson({
        lessonId: assignment.lessonId,
        links: lessonObjectiveLinksMap.get(assignment.lessonId) ?? [],
        successCriteria: lessonSuccessCriteriaMap.get(assignment.lessonId) ?? [],
        learningObjectiveMeta,
      })
      subjectEntry.lessons.push({
        lessonId: assignment.lessonId,
        lessonTitle: assignment.lessonTitle,
        unitId: assignment.unitId,
        unitTitle: unitTitleMap.get(assignment.unitId) ?? assignment.unitId,
        date: lessonDate ? lessonDate.toISOString() : assignment.date,
        groupId: assignment.groupId,
        hasHomework: homeworkActivities.length > 0,
        objectives: lessonObjectives,
        feedbackVisible: assignment.feedbackVisible ?? false,
        assignmentId: assignment.assignmentId,
      })
    }

    existingWeek.subjects.set(subjectKey, subjectEntry)
    weeksMap.set(weekKey, existingWeek)

    if (assignment.unitId) {
      const unitSet = subjectUnitsMap.get(subjectKey) ?? new Set<string>()
      unitSet.add(assignment.unitId)
      subjectUnitsMap.set(subjectKey, unitSet)
    }
  })

  const weeks: PupilLessonWeek[] = Array.from(weeksMap.values())
    .map((week) => ({
      weekStart: week.weekStart,
      label: week.label,
      subjects: Array.from(week.subjects.values()).map((subject) => ({
        subject: subject.subject,
        lessons: subject.lessons
          .sort((a, b) => compareDesc(parseISO(a.date), parseISO(b.date)))
          .map((lesson) => ({
            ...lesson,
            date: lesson.date,
          })),
      })),
    }))
    .sort((a, b) => compareDesc(parseISO(a.weekStart), parseISO(b.weekStart)))

  const units: PupilSubjectUnitsEntry[] = Array.from(subjectUnitsMap.entries())
    .map(([subject, unitSet]) => {
      const unitsList = Array.from(unitSet)
        .map((unitId) => {
          const objectives = (unitObjectivesMap.get(unitId) ?? []).sort((a, b) => a.title.localeCompare(b.title))
          return {
            unitId,
            unitTitle: unitTitleMap.get(unitId) ?? unitId,
            learningObjectives: objectives.map((objective) => ({
              id: objective.id,
              title: objective.title,
              assessmentObjectiveCode: objective.assessmentObjectiveCode,
              successCriteria: objective.successCriteria,
            })),
          }
        })
        .sort((a, b) => a.unitTitle.localeCompare(b.unitTitle))

      return {
        subject,
        units: unitsList,
      }
    })
    .sort((a, b) => a.subject.localeCompare(b.subject))

  return {
    summary,
    assignments,
    homework: homeworkSections,
    weeks,
    units,
  }
}
