"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { GroupsSchema, GroupWithMembershipSchema, GroupMembershipsSchema, ProfilesSchema } from "@/types"

import { createSupabaseServerClient } from "@/lib/supabase/server"

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

export type GroupActionResult = z.infer<typeof GroupReturnValue>

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

export async function readGroupsAction() {

  console.log("[v0] Server action started for reading groups:")
  
  let error: string | null = null;

  const supabase = await createSupabaseServerClient()

  const { data, error: readError } = await supabase
    .from("groups")
    .select("*")
    .eq("active", true);

  if (readError) {
    error = readError.message;
    console.error(error);
  }

  console.log("[v0] Server action completed for reading groups:", error)

  return GroupsReturnValue.parse({ data, error })
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
