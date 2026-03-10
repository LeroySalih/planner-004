"use client";

import { useState } from "react";
import { WeeklyPlanLesson } from "@/types";
import { ActivityRow } from "./ActivityRow";
import { QuestionThread } from "./QuestionThread";
import { formatDate } from "@/lib/weekly-planner-utils";
import { MessageCircle } from "lucide-react";

type Props = {
  lesson: WeeklyPlanLesson;
  isTeacher?: boolean;
};

export function LessonRow({ lesson, isTeacher }: Props) {
  const [showThread, setShowThread] = useState(false);

  return (
    <div className="border rounded-md bg-background">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="font-medium text-sm">{lesson.title}</p>
          <p className="text-xs text-muted-foreground">{formatDate(lesson.start_date)}</p>
        </div>
        <button
          onClick={() => setShowThread((v) => !v)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-label="Toggle questions"
        >
          <MessageCircle className="size-4" />
          {lesson.question_count > 0 && (
            <span className="bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5">
              {lesson.question_count}
            </span>
          )}
        </button>
      </div>
      {showThread && (
        <div className="border-t px-4 py-3">
          <QuestionThread
            lessonId={lesson.lesson_id}
            activityId={null}
            questions={lesson.questions}
            replies={lesson.replies}
            isTeacher={isTeacher}
          />
        </div>
      )}
      {lesson.activities.length > 0 && (
        <div className="border-t">
          {lesson.activities.map((activity) => (
            <ActivityRow
              key={activity.activity_id}
              activity={activity}
              lessonId={lesson.lesson_id}
              isTeacher={isTeacher}
            />
          ))}
        </div>
      )}
    </div>
  );
}
