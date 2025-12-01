"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Client } from "pg"

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

import {
  getAuthenticatedProfile,
  hashPassword,
  requireAuthenticatedProfile,
  type AuthenticatedProfile as BaseAuthenticatedProfile,
} from "@/lib/auth"
import { query } from "@/lib/db"
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
export type AuthenticatedProfile = BaseAuthenticatedProfile

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

function resolveConnectionString() {
  return process.env.POSTSQL_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? null
}

function createPgClient() {
  const connectionString = resolveConnectionString()
  if (!connectionString) {
    throw new Error("Database connection is not configured (POSTSQL_URL or SUPABASE_DB_URL missing).")
  }

  return new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  })
}

export async function createGroupAction(
  groupId: string,
  subject: string,
  options?: { currentProfile?: AuthenticatedProfile | null },
): Promise<GroupActionResult> {
  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!profile.isTeacher) {
    return GroupReturnValue.parse({ data: null, error: "You do not have permission to create groups." })
  }
  const joinCode = generateJoinCode()
  console.log("[v0] Server action started for group:", { groupId, subject, joinCode })

  const client = createPgClient()

  try {
    await client.connect()
    const { rows } = await client.query(
      "insert into groups (group_id, subject, join_code, active) values ($1, $2, $3, true) returning group_id, subject, join_code, active",
      [groupId, subject, joinCode],
    )
    const row = rows[0] ?? null
    const mapped = row ? GroupWithMembershipSchema.parse({ ...row, members: [] }) : null

    console.log("[v0] Server action completed for group:", { groupId, subject, joinCode })
    revalidatePath("/")
    return GroupReturnValue.parse({ data: mapped, error: null })
  } catch (error) {
    console.error("[v0] Server action failed for group:", error)
    const message = error instanceof Error ? error.message : "Unable to create group."
    return GroupReturnValue.parse({ data: null, error: message })
  } finally {
    try {
      await client.end()
    } catch {
      // ignore close errors
    }
  }
}

export async function readGroupAction(
  groupId: string,
  options?: { currentProfile?: AuthenticatedProfile | null },
) {
  console.log("[v0] Server action started for reading group:", { groupId })
  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!profile.isTeacher) {
    return GroupReturnValue.parse({ data: null, error: "You do not have permission to view groups." })
  }

  const client = createPgClient()

  try {
    await client.connect()

    const { rows: groupRows } = await client.query(
      "select group_id, subject, join_code, active from groups where group_id = $1 and active = true limit 1",
      [groupId],
    )
    const groupRow = groupRows[0] ?? null

    if (!groupRow) {
      return GroupReturnValue.parse({ data: null, error: "Group not found." })
    }

    const { rows: membershipRows } = await client.query(
      "select group_id, user_id, role from group_membership where group_id = $1 order by user_id asc",
      [groupId],
    )

    const parsedMembership = GroupMembershipsSchema.parse(membershipRows ?? [])
    let parsedProfiles: z.infer<typeof ProfilesSchema> = []

    if (parsedMembership.length > 0) {
      const memberIds = parsedMembership.map((member) => member.user_id)
      const { rows: profileRows } = await client.query(
        "select user_id, first_name, last_name, is_teacher from profiles where user_id = any($1::text[])",
        [memberIds],
      )
      parsedProfiles = ProfilesSchema.parse(profileRows ?? [])
    }

    const profileMap = new Map(parsedProfiles.map((profile) => [profile.user_id, profile]))
    const membershipWithProfiles = parsedMembership.map((member) => ({
      ...member,
      profile: profileMap.get(member.user_id) ?? member.profile,
    }))

    console.log("[v0] Server action completed for reading group:", { groupId })

    return GroupReturnValue.parse({
      data: GroupWithMembershipSchema.parse({ ...groupRow, members: membershipWithProfiles }),
      error: null,
    })
  } catch (error) {
    console.error("[v0] Server action failed for reading group:", error)
    const message = error instanceof Error ? error.message : "Unable to read group."
    return GroupReturnValue.parse({ data: null, error: message })
  } finally {
    try {
      await client.end()
    } catch {
      // ignore close errors
    }
  }
}

export async function readGroupsAction(options?: {
  authEndTime?: number | null
  routeTag?: string
  currentProfile?: AuthenticatedProfile | null
  filter?: string | null
}) {
  const routeTag = options?.routeTag ?? "/groups:readGroups"

  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!profile.isTeacher) {
    return GroupsReturnValue.parse({ data: null, error: "You do not have permission to view groups." })
  }

  return withTelemetry(
    {
      routeTag,
      functionName: "readGroupsAction",
      params: { filter: options?.filter ?? null },
      authEndTime: options?.authEndTime ?? null,
    },
    async () => {
      console.log("[v0] Server action started for reading groups:")

      let error: string | null = null

      const connectionStart = Date.now()
      const client = createPgClient()

      let data: z.infer<typeof GroupsSchema> | null = null

      try {
        await client.connect()
        const queryStart = Date.now()
        const filters: Array<string | boolean> = []
        const values: Array<string | boolean> = []
        filters.push("g.active = true")

        if (options?.filter && options.filter.trim().length > 0) {
          const pattern = `%${options.filter.trim().replace(/\?/g, "%")}%`
          filters.push("(g.group_id ILIKE $1 OR g.subject ILIKE $1)")
          values.push(pattern)
        }

        const whereClause = filters.length > 0 ? `where ${filters.join(" AND ")}` : ""

        const sql = `
          select g.group_id, g.subject, g.join_code, g.active, count(m.user_id) as member_count
          from groups g
          left join group_membership m on m.group_id = g.group_id
          ${whereClause}
          group by g.group_id, g.subject, g.join_code, g.active
          order by g.group_id asc;
        `

        const result = await client.query(sql, values)
        const queryEnd = Date.now()
        data = result.rows
        console.log(`[v0] Direct PG connect took ${queryStart - connectionStart} ms, query took ${queryEnd - queryStart} ms.`)
      } catch (queryError) {
        error = queryError instanceof Error ? queryError.message : "Unable to read groups."
        console.error("[v0] Failed to read groups via direct PG client", queryError)
      } finally {
        try {
          await client.end()
        } catch {
          // ignore close errors
        }
      }

      data = data ? GroupsSchema.parse(data) : null

      console.log("[v0] Server action completed for reading groups:", error)

      return GroupsReturnValue.parse({ data, error })
    },
  )
}

export async function listPupilsWithGroupsAction(): Promise<PupilListing[]> {
  let payload: unknown = null
  try {
    const { rows } = await query<{ reports_list_pupils_with_groups: unknown }>(
      "select reports_list_pupils_with_groups() as reports_list_pupils_with_groups",
    )
    payload = rows[0]?.reports_list_pupils_with_groups ?? null
  } catch (error) {
    console.error("[reports] Failed to load pupil report listings", error)
    return []
  }

  const parsed = ReportsPupilListingsSchema.safeParse(Array.isArray(payload) ? payload : [])

  if (!parsed.success) {
    console.error("[reports] Invalid payload from reports_list_pupils_with_groups", parsed.error)
    return []
  }

  return parsed.data
}


export async function updateGroupAction(
  oldGroupId: string,
  newGroupId: string,
  subject: string,
  options?: { currentProfile?: AuthenticatedProfile | null },
) {
  console.log("[v0] Server action started for group update:", { oldGroupId, newGroupId, subject })

  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!profile.isTeacher) {
    return { success: false, error: "You do not have permission to update groups." }
  }

  const client = createPgClient()

  try {
    await client.connect()
    const { rowCount } = await client.query(
      "update groups set group_id = $2, subject = $3 where group_id = $1",
      [oldGroupId, newGroupId, subject],
    )

    if (rowCount === 0) {
      console.error("[v0] Server action failed for group update: no rows updated")
      return { success: false, error: "Group not found." }
    }

    console.log("[v0] Server action completed for group update:", { oldGroupId, newGroupId, subject })
  } catch (error) {
    console.error("[v0] Server action failed for group update:", error)
    const message = error instanceof Error ? error.message : "Unable to update group."
    return { success: false, error: message }
  } finally {
    try {
      await client.end()
    } catch {
      // ignore close errors
    }
  }

  revalidatePath("/")
  return { success: true, oldGroupId, newGroupId, subject }
}

export async function deleteGroupAction(groupId: string, options?: { currentProfile?: AuthenticatedProfile | null }) {
  console.log("[v0] Server action started for group deletion:", { groupId })

  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!profile.isTeacher) {
    return { success: false, error: "You do not have permission to delete groups." }
  }

  const client = createPgClient()

  try {
    await client.connect()
    const { rowCount } = await client.query("update groups set active = false where group_id = $1", [groupId])

    if (rowCount === 0) {
      console.error("[v0] Server action failed for group deletion: no rows updated")
      return { success: false, error: "Group not found." }
    }
  } catch (error) {
    console.error("[v0] Server action failed for group deletion:", error)
    const message = error instanceof Error ? error.message : "Unable to delete group."
    return { success: false, error: message }
  } finally {
    try {
      await client.end()
    } catch {
      // ignore close errors
    }
  }

  console.log("[v0] Server action completed for group deletion:", { groupId })

  revalidatePath("/")
  return { success: true, groupId }
}

export async function removeGroupMemberAction(
  input: { groupId: string; userId: string },
  options?: { currentProfile?: AuthenticatedProfile | null },
) {
  const parsed = RemoveGroupMemberInputSchema.safeParse(input)
  if (!parsed.success) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Invalid group member removal payload.",
    })
  }

  const { groupId, userId } = parsed.data

  console.log("[v0] Server action started for removing group member:", { groupId, userId })

  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!profile.isTeacher) {
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "You do not have permission to remove pupils.",
    })
  }

  const client = createPgClient()

  try {
    await client.connect()
    const { rowCount } = await client.query(
      "delete from group_membership where group_id = $1 and user_id = $2",
      [groupId, userId],
    )

    if (rowCount === 0) {
      console.error("[v0] Server action failed for removing group member: no rows affected", { groupId, userId })
      return RemoveGroupMemberReturnSchema.parse({
        success: false,
        error: "Unable to remove pupil from group.",
      })
    }
  } catch (error) {
    console.error("[v0] Server action failed for removing group member:", { groupId, userId, error })
    return RemoveGroupMemberReturnSchema.parse({
      success: false,
      error: "Unable to remove pupil from group.",
    })
  } finally {
    try {
      await client.end()
    } catch {
      // ignore close errors
    }
  }

  revalidatePath(`/groups/${groupId}`)
  revalidatePath("/groups")

  console.log("[v0] Server action completed for removing group member:", { groupId, userId })

  return RemoveGroupMemberReturnSchema.parse({
    success: true,
    error: null,
  })
}

export async function resetPupilPasswordAction(input: { userId: string }, options?: { currentProfile?: AuthenticatedProfile | null }) {
  // Password reset must go through Supabase auth admin API; keep this path using Supabase.
  const profile = options?.currentProfile ?? (await requireAuthenticatedProfile())
  if (!profile.isTeacher) {
    return ResetPupilPasswordResultSchema.parse({
      success: false,
      error: "You do not have permission to reset passwords.",
    })
  }

  const parsed = ResetPupilPasswordInputSchema.safeParse(input)
  if (!parsed.success) {
    return ResetPupilPasswordResultSchema.parse({
      success: false,
      error: "Invalid pupil reset payload.",
    })
  }

  const { userId } = parsed.data
  console.info("[groups] Resetting pupil password.", { userId })

  const hashedPassword = await hashPassword(DEFAULT_PUPIL_PASSWORD)

  try {
    const client = createPgClient()
    try {
      await client.connect()
      const { rowCount } = await client.query(
        "update profiles set password_hash = $1 where user_id = $2",
        [hashedPassword, userId],
      )

      if (rowCount === 0) {
        console.error("[groups] No profile found while resetting password.", { userId })
        return ResetPupilPasswordResultSchema.parse({
          success: false,
          error: "Unable to reset pupil password.",
        })
      }
    } finally {
      try {
        await client.end()
      } catch {
        // ignore close errors
      }
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
  let resolvedProfile = ProfileSchema.parse({
    user_id: authProfile.userId,
    first_name: null,
    last_name: null,
    is_teacher: authProfile.isTeacher,
  })

  try {
    const { rows: profileRows } = await query(
      "select user_id, first_name, last_name, is_teacher from profiles where user_id = $1 limit 1",
      [authProfile.userId],
    )
    const profileRow = profileRows?.[0]
    if (profileRow) {
      resolvedProfile = ProfileSchema.parse({
        user_id: profileRow.user_id ?? authProfile.userId,
        first_name: profileRow.first_name ?? null,
        last_name: profileRow.last_name ?? null,
        is_teacher: Boolean(profileRow.is_teacher ?? authProfile.isTeacher),
      })
    }
  } catch (profileError) {
    console.error("[profile-groups] Failed to load profile", profileError)
  }

  let memberships: Array<z.infer<typeof GroupMembershipsWithGroupSchema.element>> = []
  try {
    const { rows } = await query(
      `
        select gm.group_id,
               gm.user_id,
               gm.role,
               g.group_id as group_group_id,
               g.subject as group_subject,
               g.join_code as group_join_code,
               g.active as group_active
        from group_membership gm
        join groups g on g.group_id = gm.group_id
        where gm.user_id = $1
          and g.active = true
        order by gm.group_id asc
      `,
      [authProfile.userId],
    )

    memberships = GroupMembershipsWithGroupSchema.parse(
      (rows ?? []).map((membership) => ({
        group_id: membership.group_id,
        user_id: membership.user_id,
        role: membership.role,
        group: {
          group_id: membership.group_group_id,
          subject: membership.group_subject,
          join_code: membership.group_join_code,
          active: membership.group_active,
        },
      })),
    )
  } catch (membershipError) {
    console.error("[profile-groups] Failed to load memberships", membershipError)
    error = "Unable to load your groups right now. Please try again shortly."
  }

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

  let group: { group_id: string; subject: string | null; active: boolean | null } | null = null
  try {
    const { rows } = await query("select group_id, subject, active from groups where join_code = $1 limit 1", [
      joinCode,
    ])
    const rawGroup = rows?.[0] ?? null
    if (rawGroup && typeof rawGroup.group_id === "string") {
      group = {
        group_id: rawGroup.group_id,
        subject: typeof rawGroup.subject === "string" ? rawGroup.subject : null,
        active: typeof rawGroup.active === "boolean" ? rawGroup.active : null,
      }
    }
  } catch (groupError) {
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

  try {
    const { rows: existingMembership } = await query(
      "select 1 from group_membership where group_id = $1 and user_id = $2 limit 1",
      [group.group_id, authProfile.userId],
    )

    if (existingMembership && existingMembership.length > 0) {
      return JoinGroupReturnSchema.parse({
        success: false,
        error: "You are already a member of that group.",
        groupId: null,
        subject: null,
      })
    }

    const role = authProfile.isTeacher ? "teacher" : "pupil"

    await query("insert into group_membership (group_id, user_id, role) values ($1, $2, $3)", [
      group.group_id,
      authProfile.userId,
      role,
    ])
  } catch (insertError) {
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

  try {
    const { rowCount } = await query(
      "delete from group_membership where group_id = $1 and user_id = $2",
      [parsed.data.groupId, authProfile.userId],
    )

    if (!rowCount || rowCount === 0) {
      return LeaveGroupReturnSchema.parse({
        success: false,
        error: "You are not a member of that group.",
      })
    }
  } catch (deleteError) {
    console.error("[profile-groups] Failed to leave group", { groupId: parsed.data.groupId, userId: authProfile.userId }, deleteError)
    return LeaveGroupReturnSchema.parse({
      success: false,
      error: "Unable to leave that group right now.",
    })
  }

  revalidatePath("/profile/groups")

  return LeaveGroupReturnSchema.parse({
    success: true,
    error: null,
  })
}
