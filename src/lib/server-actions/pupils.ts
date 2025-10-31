"use server"

import { z } from "zod"

import {
  GroupMembershipsWithGroupSchema,
  ProfileSchema,
  FeedbacksSchema,
  AssignmentsWithUnitSchema,
  AssignmentWithUnitSchema,
  UnitSchema,
} from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const PupilReportSchema = z.object({
  profile: ProfileSchema.nullable(),
  memberships: GroupMembershipsWithGroupSchema,
  assignments: AssignmentsWithUnitSchema,
  feedback: FeedbacksSchema,
})

export type PupilReport = z.infer<typeof PupilReportSchema>

export async function readPupilReportAction(pupilId: string) {
  const supabase = await createSupabaseServerClient()

  const [{ data: profileData, error: profileError }, { data: membershipData, error: membershipError }, { data: feedbackData, error: feedbackError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, first_name, last_name, is_teacher")
        .eq("user_id", pupilId)
        .maybeSingle(),
      supabase
        .from("group_membership")
        .select("group_id, user_id, role, groups(*)")
        .eq("user_id", pupilId),
      supabase
        .from("feedback")
        .select("*")
        .eq("user_id", pupilId),
    ])

  if (profileError || membershipError || feedbackError) {
    return {
      data: null as PupilReport | null,
      error: profileError?.message ?? membershipError?.message ?? feedbackError?.message ?? "Unknown error",
    }
  }

  const profile = profileData ? ProfileSchema.parse(profileData) : null
  const memberships = GroupMembershipsWithGroupSchema.parse(
    (membershipData ?? []).map((row) => ({
      group_id: row.group_id,
      user_id: row.user_id,
      role: row.role,
      group: row.groups ?? undefined,
    })),
  )
  const feedback = FeedbacksSchema.parse(feedbackData ?? [])

  const groupIds = memberships.map((membership) => membership.group_id)

  type RawAssignment = z.infer<typeof AssignmentWithUnitSchema>
  let legacyAssignments: RawAssignment[] = []
  let lessonAssignments: Array<{ group_id: string; lesson_id: string; start_date: string }> = []

  if (groupIds.length > 0) {
    const [{ data: assignmentsData, error: assignmentsError }, { data: lessonAssignmentsData, error: lessonAssignmentsError }] =
      await Promise.all([
        supabase
          .from("assignments")
          .select("group_id, unit_id, start_date, end_date, active")
          .in("group_id", groupIds)
          .eq("active", true),
        supabase
          .from("lesson_assignments")
          .select("group_id, lesson_id, start_date")
          .in("group_id", groupIds),
      ])

    if (assignmentsError) {
      return {
        data: null as PupilReport | null,
        error: assignmentsError.message,
      }
    }

    if (lessonAssignmentsError) {
      return {
        data: null as PupilReport | null,
        error: lessonAssignmentsError.message,
      }
    }

    legacyAssignments = (assignmentsData ?? []) as RawAssignment[]
    lessonAssignments = (lessonAssignmentsData ?? []).map((row) => ({
      group_id: row.group_id as string,
      lesson_id: row.lesson_id as string,
      start_date: row.start_date as string,
    }))
  }

  const lessonIds = Array.from(new Set(lessonAssignments.map((entry) => entry.lesson_id).filter(Boolean)))
  type LessonWithUnit = {
    lesson_id: string
    unit_id: string
    unit: z.infer<typeof UnitSchema> | null
  }
  let lessonsById = new Map<string, LessonWithUnit>()

  if (lessonIds.length > 0) {
    const { data: lessonsData, error: lessonsError } = await supabase
      .from("lessons")
      .select("lesson_id, unit_id, units:units(*)")
      .in("lesson_id", lessonIds)

    if (lessonsError) {
      return {
        data: null as PupilReport | null,
        error: lessonsError.message,
      }
    }

    lessonsById = new Map(
      (lessonsData ?? []).map((row) => {
        const unitRecord = row.units ? UnitSchema.parse(row.units) : null
        return [
          row.lesson_id as string,
          {
            lesson_id: row.lesson_id as string,
            unit_id: row.unit_id as string,
            unit: unitRecord,
          },
        ]
      }),
    )
  }

  const unitIds = new Set<string>()
  legacyAssignments.forEach((row) => unitIds.add(row.unit_id))
  lessonsById.forEach((lesson) => {
    if (lesson.unit_id) {
      unitIds.add(lesson.unit_id)
    }
  })

  let unitsById = new Map<string, z.infer<typeof UnitSchema>>()
  if (unitIds.size > 0) {
    const { data: unitsData, error: unitsError } = await supabase
      .from("units")
      .select("*")
      .in("unit_id", Array.from(unitIds))

    if (unitsError) {
      return {
        data: null as PupilReport | null,
        error: unitsError.message,
      }
    }

    const parsedUnits = (unitsData ?? []).map((unit) => UnitSchema.parse(unit))
    unitsById = new Map(parsedUnits.map((unit) => [unit.unit_id, unit]))
  }

  type NormalizedAssignmentRow = {
    group_id: string
    unit_id: string
    start_date: string
    end_date: string
    active: boolean
    unit: z.infer<typeof UnitSchema> | null
  }

  const assembledAssignments: NormalizedAssignmentRow[] = [
    ...legacyAssignments.map((row) => ({
      group_id: row.group_id,
      unit_id: row.unit_id,
      start_date: row.start_date,
      end_date: row.end_date,
      active: row.active,
      unit: unitsById.get(row.unit_id) ?? null,
    })),
    ...lessonAssignments
      .map((entry): NormalizedAssignmentRow | null => {
        const lesson = lessonsById.get(entry.lesson_id)
        if (!lesson || !lesson.unit_id) {
          return null
        }

        const unit = unitsById.get(lesson.unit_id) ?? lesson.unit ?? null
        const startDate = entry.start_date ?? new Date().toISOString()

        return {
          group_id: entry.group_id,
          unit_id: lesson.unit_id,
          start_date: startDate,
          end_date: startDate,
          active: true,
          unit,
        }
      })
      .filter((value): value is NormalizedAssignmentRow => value !== null),
  ]

  const assignments = AssignmentsWithUnitSchema.parse(assembledAssignments)

  return {
    data: PupilReportSchema.parse({ profile, memberships, assignments, feedback }),
    error: null,
  }
}
