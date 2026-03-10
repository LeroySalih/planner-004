import { requireRole } from "@/lib/auth";
import { readAllGroupsAction } from "@/lib/server-updates";
import { TeacherPlannerClient } from "./TeacherPlannerClient";

export default async function ActionsPage() {
  await requireRole("teacher");
  const { data: groups } = await readAllGroupsAction();
  return <TeacherPlannerClient groups={groups ?? []} />;
}
