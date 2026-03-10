"use client";

import { cn } from "@/lib/utils";

type Group = { group_id: string; name: string };

type Props = {
  groups: Group[];
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
};

export function TeacherSidebar({ groups, selectedGroupId, onSelect }: Props) {
  return (
    <aside className="w-56 shrink-0 border-r bg-muted/20 h-full overflow-y-auto p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-2">
        Classes
      </p>
      <nav className="flex flex-col gap-0.5">
        {groups.map((group) => (
          <button
            key={group.group_id}
            onClick={() => onSelect(group.group_id)}
            className={cn(
              "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
              selectedGroupId === group.group_id && "bg-accent text-accent-foreground font-medium"
            )}
          >
            {group.name}
          </button>
        ))}
      </nav>
    </aside>
  );
}
