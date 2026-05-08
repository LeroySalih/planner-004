"use server";

import { z } from "zod";

import { LessonAssignmentsSchema } from "@/types";
import { query } from "@/lib/db";
import { normalizeDateOnly } from "@/lib/utils";

const LessonAssignmentsReturnValue = z.object({
  data: LessonAssignmentsSchema.nullable(),
  error: z.string().nullable(),
});

export async function readLessonAssignmentsAction() {
  console.log("[v0] Server action started for reading lesson assignments");

  try {
    const { rows } = await query<{
      group_id: string;
      lesson_id: string;
      start_date: string | Date | null;
      hidden: boolean;
    }>("select * from lesson_assignments");
    const normalized = (rows ?? []).map((row) => ({
      ...row,
      start_date: normalizeDateOnly(row.start_date) ??
        (row.start_date instanceof Date
          ? row.start_date.toISOString().slice(0, 10)
          : (row.start_date ?? "")),
    }));
    console.log("[v0] Server action completed for reading lesson assignments");
    return LessonAssignmentsReturnValue.parse({
      data: normalized ?? [],
      error: null,
    });
  } catch (error) {
    console.error(
      "[v0] Server action failed for reading lesson assignments:",
      error,
    );
    const message = error instanceof Error
      ? error.message
      : "Unable to load lesson assignments.";
    return LessonAssignmentsReturnValue.parse({ data: null, error: message });
  }
}

export async function checkLessonAccessForPupilAction(
  pupilId: string,
  lessonId: string,
): Promise<{ accessible: boolean; reason: "hidden" | "locked" | null }> {
  try {
    const { rows } = await query<{ hidden: boolean; locked: boolean }>(
      `
        select
          coalesce(la.hidden, false) as hidden,
          coalesce(la.locked, false) as locked
        from lesson_assignments la
        join group_membership gm on gm.group_id = la.group_id
        where gm.user_id = $1
          and la.lesson_id = $2
        limit 1
      `,
      [pupilId, lessonId],
    );

    if (rows.length === 0) {
      return { accessible: true, reason: null };
    }

    const row = rows[0];
    if (row.hidden) {
      return { accessible: false, reason: "hidden" };
    }
    if (row.locked) {
      return { accessible: false, reason: "locked" };
    }

    return { accessible: true, reason: null };
  } catch (error) {
    console.error("[lesson-assignments] checkLessonAccessForPupilAction failed:", error);
    return { accessible: true, reason: null };
  }
}
