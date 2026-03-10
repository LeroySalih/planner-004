"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { WeeklyPlanQuestion, WeeklyPlanReply } from "@/types";
import { createWeeklyPlanQuestionAction, createWeeklyPlanReplyAction } from "@/lib/server-updates";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  lessonId: string;
  activityId: string | null;
  questions: WeeklyPlanQuestion[];
  replies: WeeklyPlanReply[];
  isTeacher?: boolean;
};

export function QuestionThread({ lessonId, activityId, questions, replies, isTeacher }: Props) {
  const [localQuestions, setLocalQuestions] = useState(questions);
  const [localReplies, setLocalReplies] = useState(replies);
  const [newQuestion, setNewQuestion] = useState("");
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const repliesForQuestion = (qId: string) => localReplies.filter((r) => r.question_id === qId);

  const handleAskQuestion = () => {
    if (!newQuestion.trim()) return;
    const content = newQuestion.trim();
    startTransition(async () => {
      const { error } = await createWeeklyPlanQuestionAction(lessonId, activityId, content);
      if (error) {
        toast.error(error);
        return;
      }
      setNewQuestion("");
      toast.success("Question posted");
      setLocalQuestions((prev) => [...prev, {
        id: crypto.randomUUID(),
        lesson_id: lessonId,
        activity_id: activityId,
        user_id: "",
        display_name: "You",
        content,
        created_at: new Date().toISOString(),
      }]);
    });
  };

  const handleReply = (questionId: string) => {
    const content = replyContent[questionId]?.trim();
    if (!content) return;
    startTransition(async () => {
      const { error } = await createWeeklyPlanReplyAction(questionId, content);
      if (error) {
        toast.error(error);
        return;
      }
      setReplyContent((prev) => ({ ...prev, [questionId]: "" }));
      toast.success("Reply posted");
      setLocalReplies((prev) => [...prev, {
        id: crypto.randomUUID(),
        question_id: questionId,
        user_id: "",
        display_name: "You",
        content,
        created_at: new Date().toISOString(),
      }]);
    });
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      {localQuestions.length === 0 && (
        <p className="text-muted-foreground text-xs">No questions yet.</p>
      )}
      {localQuestions.map((q) => (
        <div key={q.id} className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <span className="font-medium shrink-0">{q.display_name}:</span>
            <span>{q.content}</span>
          </div>
          {repliesForQuestion(q.id).map((r) => (
            <div key={r.id} className="ml-4 flex items-start gap-2 text-xs text-muted-foreground">
              <span className="font-medium shrink-0">{r.display_name}:</span>
              <span>{r.content}</span>
            </div>
          ))}
          {isTeacher && (
            <div className="ml-4 flex gap-2 mt-1">
              <Textarea
                rows={1}
                placeholder="Reply..."
                value={replyContent[q.id] ?? ""}
                onChange={(e) => setReplyContent((prev) => ({ ...prev, [q.id]: e.target.value }))}
                className="text-xs min-h-0 py-1"
              />
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleReply(q.id)}>
                Reply
              </Button>
            </div>
          )}
        </div>
      ))}
      {!isTeacher && (
        <div className="flex gap-2 mt-1">
          <Textarea
            rows={1}
            placeholder="Ask a question..."
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            className="text-xs min-h-0 py-1"
          />
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleAskQuestion}>
            Ask
          </Button>
        </div>
      )}
    </div>
  );
}
