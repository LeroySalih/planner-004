import {
  readGroupsAction,
  readGroupAction,
  readLessonAssignmentsAction,
  readLessonAction,
} from "@/lib/server-updates"

export type PupilLessonLesson = {
  lessonId: string
  title: string
  unitId: string
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
