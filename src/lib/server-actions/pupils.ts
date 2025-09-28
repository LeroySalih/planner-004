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

  let assignmentsRows: Array<z.infer<typeof AssignmentWithUnitSchema>> = []
  if (groupIds.length > 0) {
    const { data: assignmentsData, error: assignmentsError } = await supabase
      .from("assignments")
      .select("group_id, unit_id, start_date, end_date, active")
      .in("group_id", groupIds)
      .eq("active", true)

    if (assignmentsError) {
      return {
        data: null as PupilReport | null,
        error: assignmentsError.message,
      }
    }

    assignmentsRows = (assignmentsData ?? []) as Array<z.infer<typeof AssignmentWithUnitSchema>>
  }

  let unitsById = new Map<string, z.infer<typeof UnitSchema>>()
  if (assignmentsRows.length > 0) {
    const unitIds = Array.from(new Set(assignmentsRows.map((row) => row.unit_id)))
    if (unitIds.length > 0) {
      const { data: unitsData, error: unitsError } = await supabase
        .from("units")
        .select("*")
        .in("unit_id", unitIds)

      if (unitsError) {
        return {
          data: null as PupilReport | null,
          error: unitsError.message,
        }
      }

      const parsedUnits = (unitsData ?? []).map((unit) => UnitSchema.parse(unit))
      unitsById = new Map(parsedUnits.map((unit) => [unit.unit_id, unit]))
    }
  }

  const assignments = AssignmentsWithUnitSchema.parse(
    assignmentsRows.map((row) => ({
      group_id: row.group_id,
      unit_id: row.unit_id,
      start_date: row.start_date,
      end_date: row.end_date,
      active: row.active,
      unit: unitsById.get(row.unit_id) ?? null,
    })),
  )

  return {
    data: PupilReportSchema.parse({ profile, memberships, assignments, feedback }),
    error: null,
  }
}
