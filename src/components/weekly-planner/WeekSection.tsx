import { formatDate } from "@/lib/weekly-planner-utils";
import { WeeklyPlanGroup } from "@/types";
import { GroupSection } from "./GroupSection";

type Props = {
  weekStart: string;
  groups: WeeklyPlanGroup[];
  isTeacher?: boolean;
  pupilId?: string;
  onAddNote?: (weekStart: string) => void;
  onEditNote?: (weekStart: string, currentContent: string) => void;
  onDeleteNote?: (weekStart: string) => void;
};

export function WeekSection({ weekStart, groups, isTeacher, pupilId, onAddNote, onEditNote, onDeleteNote }: Props) {
  const label = formatDate(new Date(weekStart));

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Week of {label}</h2>
        {isTeacher && onAddNote && (
          <button
            onClick={() => onAddNote(weekStart)}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            + Add note
          </button>
        )}
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <GroupSection
            key={group.group_id}
            group={group}
            isTeacher={isTeacher}
            pupilId={pupilId}
            onEditNote={onEditNote ? (content) => onEditNote(weekStart, content) : undefined}
            onDeleteNote={onDeleteNote ? () => onDeleteNote(weekStart) : undefined}
          />
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">No lessons scheduled this week.</p>
        )}
      </div>
    </section>
  );
}
