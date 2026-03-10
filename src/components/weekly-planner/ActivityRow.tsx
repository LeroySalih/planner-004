"use client";

import { useState } from "react";
import { WeeklyPlanActivity } from "@/types";
import { QuestionThread } from "./QuestionThread";
import { MessageCircle } from "lucide-react";

type Props = {
  activity: WeeklyPlanActivity;
  lessonId: string;
  isTeacher?: boolean;
};

export function ActivityRow({ activity, lessonId, isTeacher }: Props) {
  const [showThread, setShowThread] = useState(false);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b last:border-b-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground inline-block" />
          <p className="text-sm">{activity.title}</p>
          <span className="text-xs text-muted-foreground capitalize">{activity.activity_type}</span>
        </div>
        <button
          onClick={() => setShowThread((v) => !v)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-label="Toggle questions"
        >
          <MessageCircle className="size-4" />
          {activity.question_count > 0 && (
            <span className="bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5">
              {activity.question_count}
            </span>
          )}
        </button>
      </div>
      {showThread && (
        <div className="px-4 py-3 bg-muted/40">
          <QuestionThread
            lessonId={lessonId}
            activityId={activity.activity_id}
            questions={activity.questions}
            replies={activity.replies}
            isTeacher={isTeacher}
          />
        </div>
      )}
    </div>
  );
}
