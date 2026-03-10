import { requireAuthenticatedProfile } from "@/lib/auth";
import { readWeeklyPlannerPupilAction } from "@/lib/server-updates";
import { getWeekRange, defaultPupilDateRange } from "@/lib/weekly-planner-utils";
import { WeeklyPlanGroup } from "@/types";
import { PupilPlannerClient } from "./PupilPlannerClient";

export default async function MyActionsPage() {
  await requireAuthenticatedProfile();

  const { from, to } = defaultPupilDateRange();
  const weeks = getWeekRange(from, to);

  const initialWeeks = await Promise.all(
    weeks.map(async (weekStart) => {
      const iso = weekStart.toISOString().split("T")[0];
      const { data } = await readWeeklyPlannerPupilAction(iso);
      return { weekStart: iso, groups: (data ?? []) as WeeklyPlanGroup[] };
    })
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">My Actions</h1>
      <PupilPlannerClient initialWeeks={initialWeeks} />
    </div>
  );
}
