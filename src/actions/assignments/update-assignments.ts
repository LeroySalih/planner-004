import { Assignment, AssignmentSchema } from "./types";
import { z} from "zod";
import { revalidatePath } from "next/cache";

import { query } from "@/lib/db"


const ReturnValueSchema = z.object({
    data: AssignmentSchema.nullable(),
    error: z.string().nullable()
});

type ReturnValue = z.infer<typeof ReturnValueSchema>;

export const updateAssignment = async (
  prev: { data: Assignment | null; error: string | null },
  assignment: Assignment,
): Promise<ReturnValue> => {
  let data = null,
    error = null
  try {
    const { rows } = await query(
      `
        insert into assignments (group_id, unit_id, start_date, end_date, active)
        values ($1, $2, $3, $4, true)
        on conflict (group_id, unit_id, start_date)
        do update set end_date = excluded.end_date, active = true
        returning *
      `,
      [assignment.group_id, assignment.unit_id, assignment.start_date, assignment.end_date],
    )
    data = rows?.[0] ?? null

    revalidatePath("/assignments")
  } catch (err) {
    error = (err as Error).message
    console.error("Error updating assignment:", err)
  } finally {
    return ReturnValueSchema.parse({ data, error })
  }
}
