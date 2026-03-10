"use client";

import { cn } from "@/lib/utils";

type Group = { group_id: string; subject: string };

type Props = {
  groups: Group[];
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
};

export function TeacherSidebar({ groups, selectedGroupId, onSelect }: Props) {
  // Group by subject
  const bySubject = groups.reduce<Record<string, Group[]>>((acc, g) => {
    const key = g.subject ?? "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(g);
    return acc;
  }, {});

  return (
    <aside className="w-56 shrink-0 border-r bg-muted/20 h-full overflow-y-auto p-3">
      <nav className="flex flex-col gap-3">
        {Object.entries(bySubject).map(([subject, subjectGroups]) => (
          <div key={subject}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-2">
              {subject}
            </p>
            <div className="flex flex-col gap-0.5">
              {subjectGroups.map((group) => (
                <button
                  key={group.group_id}
                  onClick={() => onSelect(group.group_id)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    selectedGroupId === group.group_id && "bg-accent text-accent-foreground font-medium"
                  )}
                >
                  {group.group_id}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
