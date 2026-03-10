"use client";

import { useState, useTransition } from "react";
import { TeacherSidebar } from "@/components/weekly-planner/TeacherSidebar";
import { WeekSection } from "@/components/weekly-planner/WeekSection";
import { NoteEditor } from "@/components/weekly-planner/NoteEditor";
import { readWeeklyPlannerTeacherAction } from "@/lib/server-updates";
import { getWeekRange, defaultPupilDateRange } from "@/lib/weekly-planner-utils";
import { WeeklyPlanGroup } from "@/types";

type Group = { group_id: string; name: string };

type WeekEntry = { weekStart: string; group: WeeklyPlanGroup };

type Props = { groups: Group[] };

export function TeacherPlannerClient({ groups }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [weekEntries, setWeekEntries] = useState<WeekEntry[]>([]);
  const [noteTarget, setNoteTarget] = useState<{ groupId: string; weekStart: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    const { from, to } = defaultPupilDateRange();
    const weeks = getWeekRange(from, to);

    startTransition(async () => {
      const results = await Promise.all(
        weeks.map(async (weekStart) => {
          const iso = weekStart.toISOString().split("T")[0];
          const { data } = await readWeeklyPlannerTeacherAction(groupId, iso);
          return { weekStart: iso, group: data! };
        })
      );
      setWeekEntries(results.filter((e) => e.group !== null));
    });
  };

  return (
    <div className="flex h-full">
      <TeacherSidebar
        groups={groups}
        selectedGroupId={selectedGroupId}
        onSelect={loadGroup}
      />
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">Actions</h1>
        {!selectedGroupId && (
          <p className="text-muted-foreground">Select a class from the sidebar.</p>
        )}
        {selectedGroupId && isPending && (
          <p className="text-muted-foreground text-sm">Loading...</p>
        )}
        {selectedGroupId && !isPending && weekEntries.map(({ weekStart, group }) => (
          <WeekSection
            key={weekStart}
            weekStart={weekStart}
            groups={[group]}
            isTeacher
            onAddNote={(ws) => setNoteTarget({ groupId: selectedGroupId, weekStart: ws })}
          />
        ))}
        {noteTarget && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-background rounded-lg shadow-lg w-full max-w-lg p-6">
              <h2 className="font-semibold mb-3">Add note for week of {noteTarget.weekStart}</h2>
              <NoteEditor
                groupId={noteTarget.groupId}
                weekStartDate={noteTarget.weekStart}
                onSaved={() => {
                  setNoteTarget(null);
                  loadGroup(noteTarget.groupId);
                }}
              />
              <button
                className="mt-3 text-sm text-muted-foreground underline"
                onClick={() => setNoteTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
