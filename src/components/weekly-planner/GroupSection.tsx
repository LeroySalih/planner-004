import DOMPurify from "isomorphic-dompurify";
import { WeeklyPlanGroup } from "@/types";
import { LessonRow } from "./LessonRow";

type Props = {
  group: WeeklyPlanGroup;
  isTeacher?: boolean;
  onEditNote?: (currentContent: string) => void;
  onDeleteNote?: () => void;
};

export function GroupSection({ group, isTeacher, onEditNote, onDeleteNote }: Props) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-medium text-sm text-muted-foreground mb-3 uppercase tracking-wide">
        {group.group_name}
      </h3>
      {group.note && (
        <div className="mb-4">
          <div
            className="prose prose-sm dark:prose-invert p-3 bg-muted rounded-md"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(group.note.content) }}
          />
          {isTeacher && (
            <div className="flex gap-3 mt-1.5">
              <button
                onClick={() => onEditNote?.(group.note!.content)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Edit
              </button>
              <button
                onClick={() => onDeleteNote?.()}
                className="text-xs text-destructive hover:text-destructive/80 underline"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {group.lessons.map((lesson) => (
          <LessonRow key={lesson.lesson_id} lesson={lesson} isTeacher={isTeacher} />
        ))}
        {group.lessons.length === 0 && (
          <p className="text-sm text-muted-foreground">No lessons assigned.</p>
        )}
      </div>
    </div>
  );
}
