import { WeeklyPlanGroup } from "@/types";
import { LessonRow } from "./LessonRow";

type Props = {
  group: WeeklyPlanGroup;
  isTeacher?: boolean;
};

export function GroupSection({ group, isTeacher }: Props) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="font-medium text-sm text-muted-foreground mb-3 uppercase tracking-wide">
        {group.group_name}
      </h3>
      {group.note && (
        <div
          className="prose prose-sm dark:prose-invert mb-4 p-3 bg-muted rounded-md"
          dangerouslySetInnerHTML={{ __html: group.note.content }}
        />
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
