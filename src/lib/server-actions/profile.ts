"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CurrentProfileSchema } from "@/types";
import { query } from "@/lib/db";
import { hashPassword, requireAuthenticatedProfile } from "@/lib/auth";

const ReadCurrentProfileResultSchema = z.object({
  data: CurrentProfileSchema.nullable(),
  error: z.string().nullable(),
});

export type ReadCurrentProfileResult = z.infer<
  typeof ReadCurrentProfileResultSchema
>;
export type ReadProfileDetailResult = ReadCurrentProfileResult;

const ProfileIdSchema = z.object({
  profileId: z.string().min(1, "Profile identifier is required."),
});

export async function readCurrentProfileAction(): Promise<
  ReadCurrentProfileResult
> {
  const authProfile = await requireAuthenticatedProfile();
  const { rows } = await query<{
    user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    is_teacher: boolean | null;
  }>(
    "select user_id, email, first_name, last_name, is_teacher from profiles where user_id = $1 limit 1",
    [authProfile.userId],
  );

  const profileRow = rows[0] ?? null;

  const profile = CurrentProfileSchema.parse({
    user_id: authProfile.userId,
    email: profileRow?.email ?? authProfile.email ?? null,
    first_name: profileRow?.first_name ?? null,
    last_name: profileRow?.last_name ?? null,
    is_teacher: Boolean(profileRow?.is_teacher ?? authProfile.isTeacher),
  });

  return ReadCurrentProfileResultSchema.parse({
    data: profile,
    error: null,
  });
}

const ProfileNameInputSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(120, "First name must be 120 characters or fewer."),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(120, "Last name must be 120 characters or fewer."),
});

const UpdateCurrentProfileInputSchema = ProfileNameInputSchema;

const UpdateCurrentProfileResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  data: CurrentProfileSchema.nullable(),
});

export type UpdateCurrentProfileInput = z.infer<
  typeof UpdateCurrentProfileInputSchema
>;
export type UpdateCurrentProfileResult = z.infer<
  typeof UpdateCurrentProfileResultSchema
>;
export type UpdateProfileDetailInput = UpdateCurrentProfileInput & {
  profileId: string;
};
export type UpdateProfileDetailResult = UpdateCurrentProfileResult;

const UpdateProfileDetailInputSchema = ProfileNameInputSchema.extend({
  profileId: z.string().min(1, "Profile identifier is required."),
});

const UpdatePasswordInputSchema = z.object({
  profileId: z.string().min(1, "Profile identifier is required."),
  password: z
    .string()
    .trim()
    .min(6, "Password must be at least 6 characters long."),
});

const UpdatePasswordResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
});

export type UpdateProfilePasswordResult = z.infer<
  typeof UpdatePasswordResultSchema
>;

export async function updateCurrentProfileAction(
  input: UpdateCurrentProfileInput,
): Promise<UpdateCurrentProfileResult> {
  const parsed = UpdateCurrentProfileInputSchema.safeParse(input);

  if (!parsed.success) {
    const [firstError] = parsed.error.issues;
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid profile details provided.",
      data: null,
    });
  }

  const authProfile = await requireAuthenticatedProfile();
  const { firstName, lastName } = parsed.data;

  const { rows, rowCount } = await query<{
    email: string | null;
    is_teacher: boolean | null;
  }>(
    `
      update profiles
      set first_name = $1,
          last_name = $2
      where user_id = $3
      returning email, is_teacher
    `,
    [firstName, lastName, authProfile.userId],
  );

  if (rowCount === 0) {
    console.error("[profile] Failed to update profile: no matching row", {
      userId: authProfile.userId,
    });
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: "We couldn't save your profile just now. Please try again.",
      data: null,
    });
  }

  revalidatePath("/profiles");

  const profile = CurrentProfileSchema.parse({
    user_id: authProfile.userId,
    email: rows[0]?.email ?? authProfile.email ?? null,
    first_name: firstName,
    last_name: lastName,
    is_teacher: Boolean(rows[0]?.is_teacher ?? authProfile.isTeacher),
  });

  return UpdateCurrentProfileResultSchema.parse({
    success: true,
    error: null,
    data: profile,
  });
}

export async function updateProfilePasswordAction(
  input: z.infer<typeof UpdatePasswordInputSchema>,
): Promise<UpdateProfilePasswordResult> {
  const parsed = UpdatePasswordInputSchema.safeParse(input);

  if (!parsed.success) {
    const [firstError] = parsed.error.issues;
    return UpdatePasswordResultSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid password payload.",
    });
  }

  const authProfile = await requireAuthenticatedProfile();
  if (parsed.data.profileId !== authProfile.userId) {
    return UpdatePasswordResultSchema.parse({
      success: false,
      error: "You can only update your own password.",
    });
  }

  const hashedPassword = await hashPassword(parsed.data.password);
  const { rowCount } = await query(
    "update profiles set password_hash = $1 where user_id = $2",
    [
      hashedPassword,
      authProfile.userId,
    ],
  );

  if (rowCount === 0) {
    console.error("[profile] Failed to update password (no row found)", {
      userId: authProfile.userId,
    });
    return UpdatePasswordResultSchema.parse({
      success: false,
      error:
        "Unable to update your password right now. Please try again shortly.",
    });
  }

  return UpdatePasswordResultSchema.parse({
    success: true,
    error: null,
  });
}

export async function readProfileDetailAction(
  profileId: string,
): Promise<ReadProfileDetailResult> {
  const parsed = ProfileIdSchema.safeParse({ profileId });

  if (!parsed.success) {
    const [firstError] = parsed.error.issues;
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: firstError?.message ?? "Invalid profile identifier provided.",
    });
  }

  const authProfile = await requireAuthenticatedProfile();
  const { rows } = await query<{
    user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    is_teacher: boolean | null;
  }>(
    `
      select user_id, email, first_name, last_name, is_teacher
      from profiles
      where user_id = $1
      limit 1
    `,
    [parsed.data.profileId],
  );

  const profileRow = rows[0] ?? null;

  if (!profileRow) {
    return ReadCurrentProfileResultSchema.parse({
      data: null,
      error: "Profile not found.",
    });
  }

  const email = authProfile.userId === profileRow.user_id
    ? profileRow.email ?? null
    : null;

  const profile = CurrentProfileSchema.parse({
    user_id: profileRow.user_id,
    email,
    first_name: profileRow.first_name ?? null,
    last_name: profileRow.last_name ?? null,
    is_teacher: Boolean(profileRow.is_teacher ?? false),
  });

  return ReadCurrentProfileResultSchema.parse({
    data: profile,
    error: null,
  });
}

export async function updateProfileDetailAction(
  input: UpdateProfileDetailInput,
): Promise<UpdateProfileDetailResult> {
  const parsed = UpdateProfileDetailInputSchema.safeParse(input);

  if (!parsed.success) {
    const [firstError] = parsed.error.issues;
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: firstError?.message ?? "Invalid profile details provided.",
      data: null,
    });
  }

  const { profileId, firstName, lastName } = parsed.data;

  const authProfile = await requireAuthenticatedProfile();
  const { rows, rowCount } = await query<{
    user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    is_teacher: boolean | null;
  }>(
    `
      update profiles
      set first_name = $1,
          last_name = $2
      where user_id = $3
      returning user_id, email, first_name, last_name, is_teacher
    `,
    [firstName, lastName, profileId],
  );

  if (rowCount === 0) {
    return UpdateCurrentProfileResultSchema.parse({
      success: false,
      error: "Profile not found.",
      data: null,
    });
  }

  const updatedRow = rows[0];

  revalidatePath(`/profiles/${profileId}`);
  revalidatePath("/profiles");
  revalidatePath(`/profiles/${profileId}/dashboard`);

  const email = authProfile.userId === profileId
    ? updatedRow.email ?? null
    : null;

  const profile = CurrentProfileSchema.parse({
    user_id: updatedRow.user_id,
    email,
    first_name: updatedRow.first_name ?? null,
    last_name: updatedRow.last_name ?? null,
    is_teacher: Boolean(updatedRow.is_teacher ?? false),
  });

  return UpdateCurrentProfileResultSchema.parse({
    success: true,
    error: null,
    data: profile,
  });
}

export async function toggleUserTeacherStatusAction(
  userId: string,
): Promise<{ success: boolean; error: string | null }> {
  const authProfile = await requireAuthenticatedProfile();
  if (!authProfile.isTeacher) {
    return {
      success: false,
      error: "You do not have permission to change teacher status.",
    };
  }

  if (authProfile.userId === userId) {
    return {
      success: false,
      error: "You cannot change your own teacher status.",
    };
  }

  try {
    const { rows } = await query<{ is_teacher: boolean }>(
      "select is_teacher from profiles where user_id = $1",
      [userId],
    );

    if (rows.length === 0) {
      return { success: false, error: "User not found." };
    }

    const currentStatus = Boolean(rows[0].is_teacher);
    const newStatus = !currentStatus;

    await query("update profiles set is_teacher = $1 where user_id = $2", [
      newStatus,
      userId,
    ]);

    if (newStatus) {
      // Promoted to teacher: Add teacher role, remove pupil role
      await query(
        "insert into user_roles (user_id, role_id) values ($1, 'teacher') on conflict do nothing",
        [userId],
      );
      await query(
        "delete from user_roles where user_id = $1 and role_id = 'pupil'",
        [userId],
      );
    } else {
      // Demoted from teacher: Remove teacher role, add pupil role
      await query(
        "delete from user_roles where user_id = $1 and role_id = 'teacher'",
        [userId],
      );
      await query(
        "insert into user_roles (user_id, role_id) values ($1, 'pupil') on conflict do nothing",
        [userId],
      );
    }

    revalidatePath("/reports");
    return { success: true, error: null };
  } catch (error) {
    console.error("[profile] Failed to toggle teacher status", error);
    return { success: false, error: "Failed to update teacher status." };
  }
}

export async function readAllProfilesAction() {
  const profile = await requireAuthenticatedProfile();
  // Manual check until I update imports
  if (!profile.roles.includes("admin")) {
    return { data: [], error: "Unauthorized" };
  }

  try {
    const { rows } = await query<{
      user_id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      is_teacher: boolean | null;
      roles: string[] | null;
    }>(`
      select p.user_id, p.email, p.first_name, p.last_name, p.is_teacher,
             array_agg(ur.role_id) filter (where ur.role_id is not null) as roles
      from profiles p
      left join user_roles ur on ur.user_id = p.user_id
      group by p.user_id
      order by p.last_name, p.first_name
    `);

    const profiles = rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      roles: row.roles ?? (row.is_teacher ? ["teacher"] : ["pupil"]),
    }));

    return { data: profiles, error: null };
  } catch (error) {
    console.error("[profile] Failed to read all profiles", error);
    return { data: [], error: "Failed to load profiles" };
  }
}
