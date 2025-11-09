import {
  readGroupsAction,
  readGroupAction,
  readLessonAssignmentsAction,
  readLessonAction,
  readUnitsAction,
  readLearningObjectivesByUnitAction,
  listLessonActivitiesAction,
} from "@/lib/server-updates"
import { compareDesc, format, parseISO, startOfWeek } from "date-fns"
import type { LessonActivity } from "@/types"

export type PupilLessonLesson = {
  lessonId: string
  title: string
  unitId: string
  startDate: string | null
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

export type PupilLessonWeekSubject = {
  subject: string | null
  lessons: Array<{
    lessonId: string
    lessonTitle: string
    unitId: string
    unitTitle: string
    date: string
    groupId: string
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
  homework: PupilHomeworkSection[]
  weeks: PupilLessonWeek[]
  units: PupilSubjectUnitsEntry[]
}

export async function loadPupilLessonsSummaries(targetPupilId?: string): Promise<PupilLessonsSummary[]> {
  type GroupEntry = {
    groupId: string
    subject: string | null
    lessons: PupilLessonLesson[]
  }

  type DateMap = Map<string, Map<string, GroupEntry>>

  const [groupsResult, lessonAssignmentsResult] = await Promise.all([
    readGroupsAction(),
    readLessonAssignmentsAction(),
  ])

  if (groupsResult.error) {
    throw new Error(groupsResult.error)
  }

  if (lessonAssignmentsResult.error) {
    throw new Error(lessonAssignmentsResult.error)
  }

  const groups = groupsResult.data ?? []
  const lessonAssignments = (lessonAssignmentsResult.data ?? []).filter(
    (assignment) => Boolean(assignment.group_id) && Boolean(assignment.lesson_id),
  )

  const groupInfoMap = new Map<
    string,
    {
      subject: string | null
      pupils: Set<string>
    }
  >()
  const pupilInfoMap = new Map<
    string,
    {
      name: string
      groups: Set<string>
    }
  >()

  await Promise.all(
    groups.map(async (group) => {
      try {
        const detail = await readGroupAction(group.group_id)
        if (!detail.data) {
          return
        }

        const subject = detail.data.subject ?? group.subject ?? null
        const members = detail.data.members ?? []

        const pupilIds = new Set<string>()

        members
          .filter((member) => member.role.toLowerCase() === "pupil")
          .forEach((member) => {
            const first = member.profile?.first_name?.trim() ?? ""
            const last = member.profile?.last_name?.trim() ?? ""
            const display = `${first} ${last}`.trim() || member.user_id

            pupilIds.add(member.user_id)

            const existing = pupilInfoMap.get(member.user_id)
            if (existing) {
              existing.groups.add(group.group_id)
            } else {
              pupilInfoMap.set(member.user_id, {
                name: display,
                groups: new Set([group.group_id]),
              })
            }
          })

        groupInfoMap.set(group.group_id, {
          subject,
          pupils: pupilIds,
        })
      } catch (error) {
        console.error("[pupil-lessons] Failed to load group detail", group.group_id, error)
      }
    }),
  )

  if (targetPupilId && !pupilInfoMap.has(targetPupilId)) {
    return []
  }

  const filteredAssignments: Array<{
    groupId: string
    lessonId: string
    startDate: string | null
    pupilIds: string[]
  }> = []

  const lessonIds = new Set<string>()

  lessonAssignments.forEach((assignment) => {
    const groupId = assignment.group_id ?? ""
    const lessonId = assignment.lesson_id ?? ""

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

    lessonIds.add(lessonId)
    filteredAssignments.push({
      groupId,
      lessonId,
      startDate: assignment.start_date ?? null,
      pupilIds: candidatePupilIds,
    })
  })

  if (filteredAssignments.length === 0) {
    const baseList = targetPupilId
      ? [targetPupilId]
      : Array.from(pupilInfoMap.keys())
    return baseList
      .filter((pupilId) => pupilInfoMap.has(pupilId))
      .map((pupilId) => {
        const info = pupilInfoMap.get(pupilId)!
        return {
          pupilId,
          name: info.name,
          groups: Array.from(info.groups).sort((a, b) => a.localeCompare(b)),
          sections: [],
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const lessonEntries = await Promise.all(
    Array.from(lessonIds).map(async (lessonId) => {
      try {
        const result = await readLessonAction(lessonId)
        return [lessonId, result.data ?? null] as const
      } catch (error) {
        console.error("[pupil-lessons] Failed to load lesson detail", lessonId, error)
        return [lessonId, null] as const
      }
    }),
  )

  const lessonMap = new Map(
    lessonEntries.filter((entry): entry is [string, NonNullable<typeof lessonEntries[number]>[1]] => entry[1] !== null),
  )

  const pupilLessonStructure = new Map<string, DateMap>()

  filteredAssignments.forEach(({ groupId, lessonId, startDate, pupilIds }) => {
    const lesson = lessonMap.get(lessonId)
    if (!lesson) {
      return
    }

    const groupInfo = groupInfoMap.get(groupId)
    const subject = groupInfo?.subject ?? null
    const dateKey = startDate ?? ""

    pupilIds.forEach((pupilId) => {
      const dateMap: DateMap = pupilLessonStructure.get(pupilId) ?? new Map<string, Map<string, GroupEntry>>()
      const groupsMap: Map<string, GroupEntry> = dateMap.get(dateKey) ?? new Map<string, GroupEntry>()
      const groupEntry: GroupEntry = groupsMap.get(groupId) ?? {
        groupId,
        subject,
        lessons: [],
      }

      groupEntry.lessons.push({
        lessonId,
        title: lesson.title,
        unitId: lesson.unit_id,
        startDate,
      })

      groupsMap.set(groupId, groupEntry)
      dateMap.set(dateKey, groupsMap)
      pupilLessonStructure.set(pupilId, dateMap)
    })
  })

  const result: PupilLessonsSummary[] = []

  const basePupilIds = targetPupilId
    ? [targetPupilId]
    : Array.from(pupilInfoMap.keys())

  basePupilIds.forEach((pupilId) => {
    const info = pupilInfoMap.get(pupilId)
    if (!info) {
      return
    }

      const dateMap: DateMap = pupilLessonStructure.get(pupilId) ?? new Map<string, Map<string, GroupEntry>>()

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

    result.push({
      pupilId,
      name: info.name,
      groups: Array.from(info.groups).sort((a, b) => a.localeCompare(b)),
      sections,
    })
  })

  return result.sort((a, b) => a.name.localeCompare(b.name))
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

export async function loadPupilLessonsDetail(pupilId: string): Promise<PupilLessonsDetail> {
  const summaries = await loadPupilLessonsSummaries(pupilId)
  const summary = summaries[0] ?? null

  const lessonAssignments = summary
    ? summary.sections.flatMap((section) =>
        section.groups.flatMap((group) =>
          group.lessons.map((lesson) => ({
            lessonId: lesson.lessonId,
            lessonTitle: lesson.title,
            unitId: lesson.unitId,
            date: section.date ?? lesson.startDate ?? null,
            groupId: group.groupId,
            subject: group.subject,
          })),
        ),
      )
    : []

  const uniqueLessonIds = Array.from(new Set(lessonAssignments.map((entry) => entry.lessonId)))
  const uniqueUnitIds = Array.from(new Set(lessonAssignments.map((entry) => entry.unitId)))

  const unitTitleMap = new Map<string, string>()
  const unitSubjectMap = new Map<string, string | null>()

  if (uniqueUnitIds.length > 0) {
    try {
      const unitsResult = await readUnitsAction()
      if (unitsResult.error) {
        console.error("[pupil-lessons] Failed to load units", unitsResult.error)
      }

      unitsResult.data
        ?.filter((unit) => uniqueUnitIds.includes(unit.unit_id))
        .forEach((unit) => {
          unitTitleMap.set(unit.unit_id, unit.title ?? unit.unit_id)
          unitSubjectMap.set(unit.unit_id, unit.subject ?? null)
        })
    } catch (error) {
      console.error("[pupil-lessons] Unexpected error loading units", error)
    }
  }

  const unitObjectivesMap = new Map<string, Awaited<ReturnType<typeof readLearningObjectivesByUnitAction>>["data"]>()

  await Promise.all(
    uniqueUnitIds.map(async (unitId) => {
      try {
        const result = await readLearningObjectivesByUnitAction(unitId)
        if (result.error) {
          console.error("[pupil-lessons] Failed to load learning objectives", unitId, result.error)
          return
        }
        unitObjectivesMap.set(unitId, result.data ?? [])
      } catch (error) {
        console.error("[pupil-lessons] Unexpected error loading learning objectives", unitId, error)
      }
    }),
  )

  const activityResults = await Promise.all(
    uniqueLessonIds.map(async (lessonId) => {
      try {
        const result = await listLessonActivitiesAction(lessonId)
        if (result.error) {
          console.error("[pupil-lessons] Failed to read lesson activities", lessonId, result.error)
          return [lessonId, []] as const
        }
        const activities = result.data?.filter((activity) => activity.is_homework) ?? []
        return [lessonId, activities] as const
      } catch (error) {
        console.error("[pupil-lessons] Unexpected error reading lesson activities", lessonId, error)
        return [lessonId, []] as const
      }
    }),
  )

  const homeworkActivitiesMap = new Map<string, LessonActivity[]>()
  activityResults.forEach(([lessonId, activities]) => {
    homeworkActivitiesMap.set(lessonId, Array.from(activities))
  })

  const homeworkEntries = lessonAssignments.flatMap((assignment) => {
    const activities = homeworkActivitiesMap.get(assignment.lessonId) ?? []
    if (activities.length === 0) {
      return []
    }

    return activities.map((activity) => ({
      activityId: activity.activity_id,
      activityTitle: activity.title ?? "Untitled activity",
      lessonId: assignment.lessonId,
      lessonTitle: assignment.lessonTitle,
      unitId: assignment.unitId,
      subject: assignment.subject ?? null,
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

  const now = new Date()
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 })

  const weeksMap = new Map<
    string,
    {
      weekStart: string
      label: string
      subjects: Map<string, PupilLessonWeekSubject>
    }
  >()

  const subjectUnitsMap = new Map<string, Set<string>>()

  lessonAssignments.forEach((assignment) => {
    const dateValue = parseDate(assignment.date)
    if (!dateValue) {
      return
    }

    if (!dateValue || dateValue >= currentWeekStart) {
      return
    }

    const weekStartDate = startOfWeek(dateValue, { weekStartsOn: 1 })
    const weekKey = weekStartDate.toISOString()

    const existingWeek = weeksMap.get(weekKey) ?? {
      weekStart: weekStartDate.toISOString(),
      label: createWeekLabel(weekStartDate),
      subjects: new Map<string, PupilLessonWeekSubject>(),
    }

    const subjectKey = assignment.subject ?? "Subject not set"
    const subjectEntry = existingWeek.subjects.get(subjectKey) ?? {
      subject: assignment.subject ?? null,
      lessons: [] as PupilLessonWeekSubject["lessons"],
    }

    subjectEntry.lessons.push({
      lessonId: assignment.lessonId,
      lessonTitle: assignment.lessonTitle,
      unitId: assignment.unitId,
      unitTitle: unitTitleMap.get(assignment.unitId) ?? assignment.unitId,
      date: dateValue.toISOString(),
      groupId: assignment.groupId,
    })

    existingWeek.subjects.set(subjectKey, subjectEntry)
    weeksMap.set(weekKey, existingWeek)

    const subjectName = assignment.subject ?? unitSubjectMap.get(assignment.unitId) ?? "Subject not set"
    const unitSet = subjectUnitsMap.get(subjectName) ?? new Set<string>()
    unitSet.add(assignment.unitId)
    subjectUnitsMap.set(subjectName, unitSet)
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
          const objectives = unitObjectivesMap.get(unitId) ?? []
          return {
            unitId,
            unitTitle: unitTitleMap.get(unitId) ?? unitId,
            learningObjectives: (objectives ?? []).map((objective, objectiveIndex) => ({
              id: objective.learning_objective_id ?? `${unitId}-objective-${objectiveIndex}`,
              title: objective.title ?? "Untitled objective",
              assessmentObjectiveCode: objective.assessment_objective_code ?? null,
              successCriteria: (objective.success_criteria ?? []).map((criterion, criterionIndex) => ({
                id: criterion.success_criteria_id ?? `${unitId}-${objectiveIndex}-criterion-${criterionIndex}`,
                description: criterion.description ?? "No success criterion description provided.",
                level: criterion.level ?? null,
              })),
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
    homework: homeworkSections,
    weeks,
    units,
  }
}
