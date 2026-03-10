"use client";

import { useState } from "react";
import Link from "next/link";
import { WeeklyPlanLesson } from "@/types";
import { QuestionThread } from "./QuestionThread";
import { formatDate } from "@/lib/weekly-planner-utils";
import { MessageCircle } from "lucide-react";

type Props = {
  lesson: WeeklyPlanLesson;
  isTeacher?: boolean;
  pupilId?: string;
};

export function LessonRow({ lesson, isTeacher, pupilId }: Props) {
  const [showThread, setShowThread] = useState(false);

  return (
    <div className="border rounded-md bg-background">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          {pupilId ? (
            <Link
              href={`/pupil-lessons/${encodeURIComponent(pupilId)}/lessons/${encodeURIComponent(lesson.lesson_id)}`}
              className="font-medium text-sm hover:underline"
            >
              {lesson.title}
            </Link>
          ) : (
            <p className="font-medium text-sm">{lesson.title}</p>
          )}
          <p className="text-xs text-muted-foreground">{formatDate(lesson.start_date)}</p>
        </div>
        <div className="flex items-center gap-2">
          {pupilId && lesson.lesson_max_score !== null && lesson.lesson_max_score > 0 && (
            <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 tabular-nums">
              {Math.round((lesson.lesson_score ?? 0) * 10) / 10}/{lesson.lesson_max_score} ({Math.round(((lesson.lesson_score ?? 0) / lesson.lesson_max_score) * 100)}%)
            </span>
          )}
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
    </div>
  );
}
