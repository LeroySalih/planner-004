import { requireAuthenticatedProfile } from "@/lib/auth";
import { readWeeklyPlannerPupilAction } from "@/lib/server-updates";
import { getWeekRange, defaultPupilDateRange } from "@/lib/weekly-planner-utils";
import { WeeklyPlanGroup } from "@/types";
import { WeekSection } from "@/components/weekly-planner/WeekSection";

export default async function MyActionsPage() {
  await requireAuthenticatedProfile();

  const { from, to } = defaultPupilDateRange();
  const weeks = getWeekRange(from, to);

  const weekData = await Promise.all(
    weeks.map(async (weekStart) => {
      const iso = weekStart.toISOString().split("T")[0];
      const { data } = await readWeeklyPlannerPupilAction(iso);
      return { weekStart: iso, groups: (data ?? []) as WeeklyPlanGroup[] };
    })
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">My Actions</h1>
      <div className="flex flex-col">
        {weekData.map(({ weekStart, groups }) => (
          <WeekSection key={weekStart} weekStart={weekStart} groups={groups} />
        ))}
      </div>
    </div>
  );
}
