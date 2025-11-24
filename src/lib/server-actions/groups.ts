"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  GroupsSchema,
  GroupWithMembershipSchema,
  GroupMembershipsSchema,
  GroupMembershipsWithGroupSchema,
  ProfileSchema,
  ProfilesSchema,
  ReportsPupilListingSchema,
  ReportsPupilListingsSchema,
} from "@/types"

import { getAuthenticatedProfile, requireAuthenticatedProfile, requireTeacherProfile } from "@/lib/auth"
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server"
import { withTelemetry } from "@/lib/telemetry"

const GroupReturnValue = z.object({
  data: GroupWithMembershipSchema.nullable(),
  error: z.string().nullable(),
})

const GroupsReturnValue = z.object({
  data: GroupsSchema.nullable(),
  error: z.string().nullable(),
})

const RemoveGroupMemberInputSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().min(1),
})

const RemoveGroupMemberReturnSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
})

const ProfileGroupsDataSchema = z.object({
  profile: ProfileSchema,
  memberships: GroupMembershipsWithGroupSchema,
})

const ProfileGroupsResultSchema = z.object({
  data: ProfileGroupsDataSchema.nullable(),
  error: z.string().nullable(),
})

const JoinGroupInputSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value.length === 5, {
      message: "Join codes must be 5 characters long.",
    }),
})

const JoinGroupReturnSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  groupId: z.string().nullable(),
  subject: z.string().nullable(),
})

const LeaveGroupInputSchema = z.object({
  groupId: z.string().min(1),
})

const LeaveGroupReturnSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
})

const ResetPupilPasswordInputSchema = z.object({
  userId: z.string().min(1),
})

const ResetPupilPasswordResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
})

const DEFAULT_PUPIL_PASSWORD = "bisak123"

export type GroupActionResult = z.infer<typeof GroupReturnValue>
export type ProfileGroupsResult = z.infer<typeof ProfileGroupsResultSchema>
export type JoinGroupResult = z.infer<typeof JoinGroupReturnSchema>
export type LeaveGroupResult = z.infer<typeof LeaveGroupReturnSchema>
export type PupilListing = z.infer<typeof ReportsPupilListingSchema>

function generateJoinCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export async function createGroupAction(groupId: string, subject: string): Promise<GroupActionResult> {
  const joinCode = generateJoinCode()
  console.log("[v0] Server action started for group:", { groupId, subject, joinCode })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("groups")
    .insert({
      group_id: groupId,
      subject,
      join_code: joinCode,
      active: true,
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Server action failed for group:", error)
    return GroupReturnValue.parse({ data: null, error: error.message })
  }

  console.log("[v0] Server action completed for group:", { groupId, subject, joinCode })
  revalidatePath("/")
  const mapped = data ? { ...data, members: [] } : null

  return GroupReturnValue.parse({ data: mapped, error: null })
}

export async function readGroupAction(groupId: string) {
  console.log("[v0] Server action started for reading group:", { groupId })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("group_id", groupId)
    .eq("active", true)
    .single()

  if (error) {
    console.error("[v0] Server action failed for reading group:", error)
    return GroupReturnValue.parse({ data: null, error: error.message })
  }

  const { data: membership, error: membershipError } = await supabase
    .from("group_membership")
    .select("*")
    .eq("group_id", groupId)
    .order("user_id", { ascending: true })

  let parsedMembership: z.infer<typeof GroupMembershipsSchema> = []
  let membershipErrorMessage: string | null = null

  if (membershipError) {
    console.error("[v0] Server action failed for reading group membership:", membershipError)
    membershipErrorMessage = membershipError.message
  } else {
    parsedMembership = GroupMembershipsSchema.parse(membership ?? [])
  }

  let parsedProfiles: z.infer<typeof ProfilesSchema> = []
  if (parsedMembership.length > 0) {
    const memberIds = parsedMembership.map((member) => member.user_id)
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name, is_teacher")
      .in("user_id", memberIds)

    if (profilesError) {
      console.error("[v0] Server action failed for reading profiles:", profilesError)
    } else {
      parsedProfiles = ProfilesSchema.parse(profiles ?? [])
    }
  }

  const profileMap = new Map(parsedProfiles.map((profile) => [profile.user_id, profile]))
  const membershipWithProfiles = parsedMembership.map((member) => ({
    ...member,
    profile: profileMap.get(member.user_id) ?? member.profile,
  }))

  console.log("[v0] Server action completed for reading group:", { groupId })

  return GroupReturnValue.parse({
    data: data ? { ...data, members: membershipWithProfiles } : null,
    error: membershipErrorMessage,
  })
}

export async function readGroupsAction(options?: { authEndTime?: number | null; routeTag?: string }) {
  const routeTag = options?.routeTag ?? "/groups:readGroups"

  return withTelemetry(
    {
      routeTag,
      functionName: "readGroupsAction",
      params: null,
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading groups:")

      let error: string | null = null

      const s1 = Date.now();
      const supabase = await createSupabaseServerClient()
      const s2 = Date.now();
      const { data, error: readError } = await supabase
        .from("groups")
        .select("*")
        .eq("active", true);

      const E = Date.now();

      console.log(`[v0] Supabase client creation took ${s2 - s1} ms, query took ${E - s2} ms.`);

      if (readError) {
        error = readError.message
        console.error(error)
      }

      console.log("[v0] Server action completed for reading groups:", error)

      return GroupsReturnValue.parse({ data, error })
    },
  )
}

export async function listPupilsWithGroupsAction(): Promise<PupilListing[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc("reports_list_pupils_with_groups")

  if (error) {
    console.error("[reports] Failed to load pupil report listings", error)
    return []
  }

  const parsed = ReportsPupilListingsSchema.safeParse(data ?? [])

  if (!parsed.success) {
    console.error("[reports] Invalid payload from reports_list_pupils_with_groups", parsed.error)
    return []
  }

  return parsed.data
}


export async function updateGroupAction(oldGroupId: string, newGroupId: string, subject: string) {
  console.log("[v0] Server action started for group update:", { oldGroupId, newGroupId, subject })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("groups")
    .update({ group_id: newGroupId, subject })
    .eq("group_id", oldGroupId)

  if (error) {
    console.error("[v0] Server action failed for group update:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for group update:", { oldGroupId, newGroupId, subject })

  revalidatePath("/")
  return { success: true, oldGroupId, newGroupId, subject }
}

export async function deleteGroupAction(groupId: string) {
  console.log("[v0] Server action started for group deletion:", { groupId })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from("groups")
    .update({ active: false })
    .eq("group_id", groupId)

  if (error) {
    console.error("[v0] Server action failed for group deletion:", error)
    return { success: false, error: error.message }
  }

  console.log("[v0] Server action completed for group deletion:", { groupId })

  revalidatePath("/")
  return { success: true, groupId }
}

export async function removeGroupMemberAction(input: { groupId: string; userId: string }) {
  const parsed = RemoveGroupMemberInputSchema.safeParse(input)
  if (!parsed.success) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Invalid group member removal payload.",
    })
  }

  const { groupId, userId } = parsed.data

  console.log("[v0] Server action started for removing group member:", { groupId, userId })

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from("group_membership")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId)

  if (error) {
    console.error("[v0] Server action failed for removing group member:", { groupId, userId, error })
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Unable to remove pupil from group.",
    })
  }

  revalidatePath(`/groups/${groupId}`)
  revalidatePath("/groups")

  console.log("[v0] Server action completed for removing group member:", { groupId, userId })

  return RemoveGroupMemberReturnSchema.parse({
    success: true,
    error: null,
  })
}

export async function resetPupilPasswordAction(input: { userId: string }) {
  await requireTeacherProfile()

  const parsed = ResetPupilPasswordInputSchema.safeParse(input)
  if (!parsed.success) {
    return ResetPupilPasswordResultSchema.parse({
      success: false,
      error: "Invalid pupil reset payload.",
    })
  }

  const { userId } = parsed.data
  console.info("[groups] Resetting pupil password.", { userId })

  try {
    const supabase = await createSupabaseServiceClient()
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: DEFAULT_PUPIL_PASSWORD,
    })

    if (error) {
      console.error("[groups] Failed to reset pupil password.", { userId, error })
      return ResetPupilPasswordResultSchema.parse({
        success: false,
        error: "Unable to reset pupil password.",
      })
    }
  } catch (error) {
    console.error("[groups] Unexpected error resetting pupil password.", { userId, error })
    return ResetPupilPasswordResultSchema.parse({
      success: false,
      error: "Unable to reset pupil password.",
    })
  }

  return ResetPupilPasswordResultSchema.parse({
    success: true,
    error: null,
  })
}

export async function readProfileGroupsForCurrentUserAction(): Promise<ProfileGroupsResult> {
  let error: string | null = null
  const authProfile = await requireAuthenticatedProfile()
  const supabase = await createSupabaseServerClient()

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, first_name, last_name, is_teacher")
    .eq("user_id", authProfile.userId)
    .maybeSingle()

  if (profileError && profileError.code !== "PGRST116") {
    console.error("[profile-groups] Failed to load profile", profileError)
  }

  const resolvedProfile = ProfileSchema.parse({
    user_id: profileRow?.user_id ?? authProfile.userId,
    first_name: profileRow?.first_name ?? null,
    last_name: profileRow?.last_name ?? null,
    is_teacher: Boolean(profileRow?.is_teacher ?? authProfile.isTeacher),
  })

  const { data: membershipRows, error: membershipError } = await supabase
    .from("group_membership")
    .select("group_id, user_id, role, group:groups(group_id, subject, join_code, active)")
    .eq("user_id", authProfile.userId)
    .order("group_id", { ascending: true })

  if (membershipError) {
    console.error("[profile-groups] Failed to load memberships", membershipError)
    error = "Unable to load your groups right now. Please try again shortly."
  }

  const memberships = GroupMembershipsWithGroupSchema.parse(
    (membershipRows ?? [])
      .map((membership) => {
        const group = Array.isArray(membership.group) ? membership.group[0] : membership.group
        if (group && group.active === false) {
          return {
            group_id: membership.group_id,
            user_id: membership.user_id,
            role: membership.role,
          }
        }

        return {
          group_id: membership.group_id,
          user_id: membership.user_id,
          role: membership.role,
          group: group ?? undefined,
        }
      })
      .filter((membership) => membership.group !== undefined),
  )

  return ProfileGroupsResultSchema.parse({
    data: {
      profile: resolvedProfile,
      memberships,
    },
    error,
  })
}

export async function joinGroupByCodeAction(input: { joinCode: string }): Promise<JoinGroupResult> {
  const parsed = JoinGroupInputSchema.safeParse({ joinCode: input.joinCode })

  if (!parsed.success) {
    const [firstError] = parsed.error.issues
    return JoinGroupReturnSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid join code.",
      groupId: null,
      subject: null,
    })
  }

  const { joinCode } = parsed.data

  const authProfile = await getAuthenticatedProfile()

  if (!authProfile) {
    return JoinGroupReturnSchema.parse({
      success: false,
      error: "You must be signed in to join a group.",
      groupId: null,
      subject: null,
    })
  }

  const supabase = await createSupabaseServerClient()

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("group_id, subject, active")
    .eq("join_code", joinCode)
    .maybeSingle()

  if (groupError) {
    console.error("[profile-groups] Failed to find group by join code", joinCode, groupError)
    return JoinGroupReturnSchema.parse({
      success: false,
      error: "We couldn't validate that join code. Please try again.",
      groupId: null,
      subject: null,
    })
  }

  if (!group || group.active === false) {
    return JoinGroupReturnSchema.parse({
      success: false,
      error: "No group found with that join code.",
      groupId: null,
      subject: null,
    })
  }

  const { data: existingMembership } = await supabase
    .from("group_membership")
    .select("group_id")
    .eq("group_id", group.group_id)
    .eq("user_id", authProfile.userId)
    .maybeSingle()

  if (existingMembership) {
    return JoinGroupReturnSchema.parse({
      success: false,
      error: "You are already a member of that group.",
      groupId: null,
      subject: null,
    })
  }

  const role = authProfile.isTeacher ? "teacher" : "pupil"

  const { error: insertError } = await supabase.from("group_membership").insert({
    group_id: group.group_id,
    user_id: authProfile.userId,
    role,
  })

  if (insertError) {
    console.error("[profile-groups] Failed to join group", { joinCode, userId: authProfile.userId }, insertError)
    return JoinGroupReturnSchema.parse({
      success: false,
      error: "Unable to join that group right now.",
      groupId: null,
      subject: null,
    })
  }

  revalidatePath("/profile/groups")

  return JoinGroupReturnSchema.parse({
    success: true,
    error: null,
    groupId: group.group_id,
    subject: group.subject,
  })
}

export async function leaveGroupAction(input: { groupId: string }): Promise<LeaveGroupResult> {
  const parsed = LeaveGroupInputSchema.safeParse(input)

  if (!parsed.success) {
    const [firstError] = parsed.error.issues
    return LeaveGroupReturnSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid leave group payload.",
    })
  }

  const authProfile = await getAuthenticatedProfile()

  if (!authProfile) {
    return LeaveGroupReturnSchema.parse({
      success: false,
      error: "You must be signed in to leave a group.",
    })
  }

  const supabase = await createSupabaseServerClient()

  const { data: deletedRows, error: deleteError } = await supabase
    .from("group_membership")
    .delete()
    .eq("group_id", parsed.data.groupId)
    .eq("user_id", authProfile.userId)
    .select("group_id")

  if (deleteError) {
    console.error("[profile-groups] Failed to leave group", { groupId: parsed.data.groupId, userId: authProfile.userId }, deleteError)
    return LeaveGroupReturnSchema.parse({
      success: false,
      error: "Unable to leave that group right now.",
    })
  }

  if (!deletedRows || deletedRows.length === 0) {
    return LeaveGroupReturnSchema.parse({
      success: false,
      error: "You are not a member of that group.",
    })
  }

  revalidatePath("/profile/groups")

  return LeaveGroupReturnSchema.parse({
    success: true,
    error: null,
  })
}
