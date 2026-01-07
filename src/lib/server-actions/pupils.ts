"use server"

import { z } from "zod"

import {
  GroupMembershipsWithGroupSchema,
  ProfileSchema,
  FeedbacksSchema,
  AssignmentsWithUnitSchema,
  AssignmentWithUnitSchema,
  UnitSchema,
  type AssignmentWithUnit,
} from "@/types"
import { query } from "@/lib/db"

const PupilReportSchema = z.object({
  profile: ProfileSchema.nullable(),
  memberships: GroupMembershipsWithGroupSchema,
  assignments: AssignmentsWithUnitSchema,
  feedback: FeedbacksSchema,
})

export type PupilReport = z.infer<typeof PupilReportSchema>

export async function readPupilReportAction(pupilId: string) {
  try {
    const [profileRes, membershipRes, feedbackRes] = await Promise.all([
      query(
        `
          select user_id, first_name, last_name, is_teacher
          from profiles
          where user_id = $1
          limit 1
        `,
        [pupilId],
      ),
      query(
        `
          select gm.group_id, gm.user_id, 'member' as role, g.group_id as g_group_id, g.subject, g.join_code, g.active
          from group_membership gm
          join groups g on g.group_id = gm.group_id
          where gm.user_id = $1
        `,
        [pupilId],
      ),
      query(
        `
          select *
          from feedback
          where user_id = $1
        `,
        [pupilId],
      ),
    ])

    const profileRow = profileRes.rows[0] ?? null
    const profile = profileRow ? ProfileSchema.parse(profileRow) : null

    const memberships = GroupMembershipsWithGroupSchema.parse(
      (membershipRes.rows ?? []).map((row) => ({
        group_id: row.group_id,
        user_id: row.user_id,
        role: row.role,
        group: {
          group_id: row.g_group_id,
          subject: row.subject,
          join_code: row.join_code,
          active: row.active,
        },
      })),
    )

    const feedback = FeedbacksSchema.parse(feedbackRes.rows ?? [])

    const groupIds = memberships.map((membership) => membership.group_id)

    type RawAssignment = z.infer<typeof AssignmentWithUnitSchema>
    let legacyAssignments: RawAssignment[] = []
    let lessonAssignments: Array<{ group_id: string; lesson_id: string; start_date: string }> = []

    if (groupIds.length > 0) {
      const [assignmentsRes, lessonAssignmentsRes] = await Promise.all([
        query<RawAssignment>(
          `
            select group_id, unit_id, start_date, end_date, active
            from assignments
            where group_id = any($1::text[])
              and active = true
          `,
          [groupIds],
        ),
        query<{ group_id: string; lesson_id: string; start_date: string }>(
          `
            select group_id, lesson_id, start_date
            from lesson_assignments
            where group_id = any($1::text[])
          `,
          [groupIds],
        ),
      ])

      legacyAssignments = assignmentsRes.rows ?? []
      lessonAssignments = (lessonAssignmentsRes.rows ?? []).map((row) => ({
        group_id: row.group_id,
        lesson_id: row.lesson_id,
        start_date: row.start_date,
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
      const { rows: lessonsData } = await query<{
        lesson_id: string
        unit_id: string
        units?: unknown
      }>(
        `
          select lesson_id, unit_id, units.*
          from lessons l
          left join units on units.unit_id = l.unit_id
          where l.lesson_id = any($1::text[])
        `,
        [lessonIds],
      )

      lessonsById = new Map(
        (lessonsData ?? []).map((row) => {
          const unitRecord = row.unit_id ? UnitSchema.parse({
            unit_id: row.unit_id,
            title: (row as any).title ?? null,
            subject: (row as any).subject ?? null,
            description: (row as any).description ?? null,
            year: (row as any).year ?? null,
            active: (row as any).active ?? null,
          }) : null
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
      const { rows: unitsData } = await query(
        `
          select *
          from units
          where unit_id = any($1::text[])
        `,
        [Array.from(unitIds)],
      )

      unitsById = new Map(
        (unitsData ?? []).map((row) => [row.unit_id as string, UnitSchema.parse(row)]),
      )
    }

    const normalizedLegacyAssignments: AssignmentWithUnit[] = legacyAssignments.map((assignment) => ({
      group_id: assignment.group_id,
      unit_id: assignment.unit_id,
      start_date: assignment.start_date,
      end_date: assignment.end_date ?? "",
      active: assignment.active ?? true,
      unit: (assignment as any).unit,
    }))

    const mappedLessonAssignments = lessonAssignments
      .map((assignment) => {
        const lesson = lessonsById.get(assignment.lesson_id) ?? null
        const unitId = lesson?.unit_id ?? null
        const unit = unitId ? unitsById.get(unitId) ?? null : null

        if (!unitId || !unit) {
          return null
        }

        return {
          group_id: assignment.group_id,
          unit_id: unitId,
          start_date: assignment.start_date,
          end_date: "",
          active: true,
          unit,
        } as AssignmentWithUnit
      })
      .filter((assignment): assignment is AssignmentWithUnit => assignment !== null)

    const assignments: AssignmentWithUnit[] = [...normalizedLegacyAssignments, ...mappedLessonAssignments]

    return {
      data: PupilReportSchema.parse({
        profile,
        memberships,
        assignments,
        feedback,
      }),
      error: null,
    }
  } catch (error) {
    console.error("[pupils] Failed to read pupil report", error)
    const message = error instanceof Error ? error.message : "Unable to load pupil report."
    return { data: null as PupilReport | null, error: message }
  }
}
