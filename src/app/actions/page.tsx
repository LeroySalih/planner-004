import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { TeacherPlannerClient } from "./TeacherPlannerClient";

export default async function ActionsPage() {
  await requireRole("teacher");

  const result = await query<{ group_id: string; name: string }>(
    `SELECT group_id, name FROM groups ORDER BY name`
  );
  const groups = result.rows;

  return <TeacherPlannerClient groups={groups} />;
}
