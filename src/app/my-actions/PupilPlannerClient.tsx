"use client";

import { useState, useTransition } from "react";
import { WeekSection } from "@/components/weekly-planner/WeekSection";
import { readWeeklyPlannerPupilAction } from "@/lib/server-updates";
import { getWeekRange } from "@/lib/weekly-planner-utils";
import { Button } from "@/components/ui/button";
import { WeeklyPlanGroup } from "@/types";

type WeekEntry = { weekStart: string; groups: WeeklyPlanGroup[] };

type Props = { initialWeeks: WeekEntry[] };

export function PupilPlannerClient({ initialWeeks }: Props) {
  const [weeks, setWeeks] = useState<WeekEntry[]>(initialWeeks);
  const [isPending, startTransition] = useTransition();

  const earliest = weeks[weeks.length - 1]?.weekStart;
  const latest = weeks[0]?.weekStart;

  const loadPast = () => {
    if (!earliest) return;
    startTransition(async () => {
      const newTo = new Date(earliest);
      newTo.setDate(newTo.getDate() - 7);
      const newFrom = new Date(newTo);
      newFrom.setDate(newFrom.getDate() - 14);
      const newWeeks = getWeekRange(newFrom, newTo);
      const entries = await Promise.all(
        newWeeks.map(async (ws) => {
          const iso = ws.toISOString().split("T")[0];
          const { data } = await readWeeklyPlannerPupilAction(iso);
          return { weekStart: iso, groups: (data ?? []) as WeeklyPlanGroup[] };
        })
      );
      setWeeks((prev) => [...prev, ...entries]);
    });
  };

  const loadFuture = () => {
    if (!latest) return;
    startTransition(async () => {
      const newFrom = new Date(latest);
      newFrom.setDate(newFrom.getDate() + 7);
      const newTo = new Date(newFrom);
      newTo.setDate(newTo.getDate() + 14);
      const newWeeks = getWeekRange(newFrom, newTo);
      const entries = await Promise.all(
        newWeeks.map(async (ws) => {
          const iso = ws.toISOString().split("T")[0];
          const { data } = await readWeeklyPlannerPupilAction(iso);
          return { weekStart: iso, groups: (data ?? []) as WeeklyPlanGroup[] };
        })
      );
      setWeeks((prev) => [...entries, ...prev]);
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex justify-center mb-4">
        <Button variant="outline" size="sm" disabled={isPending} onClick={loadFuture}>
          {isPending ? "Loading..." : "Load future weeks"}
        </Button>
      </div>
      {weeks.map(({ weekStart, groups }) => (
        <WeekSection key={weekStart} weekStart={weekStart} groups={groups} />
      ))}
      <div className="flex justify-center mt-4">
        <Button variant="outline" size="sm" disabled={isPending} onClick={loadPast}>
          {isPending ? "Loading..." : "Load past weeks"}
        </Button>
      </div>
    </div>
  );
}
