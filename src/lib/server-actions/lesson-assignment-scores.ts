"use server"

import { z } from "zod"

import { LessonAssignmentScoreSummariesSchema, type LessonAssignmentScoreSummaries } from "@/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireTeacherProfile } from "@/lib/auth"

const LessonAssignmentScoreSummaryInputSchema = z.object({
  pairs: z
    .array(
      z.object({
        groupId: z.string().min(1),
        lessonId: z.string().min(1),
      }),
    )
    .max(500),
})

const LessonAssignmentScoreSummaryResultSchema = z.object({
  data: LessonAssignmentScoreSummariesSchema.nullable(),
  error: z.string().nullable(),
})

type TeacherProfile = Awaited<ReturnType<typeof requireTeacherProfile>>

export async function readLessonAssignmentScoreSummariesAction(
  input: z.infer<typeof LessonAssignmentScoreSummaryInputSchema>,
  options?: { profile?: TeacherProfile },
) {
  const payload = LessonAssignmentScoreSummaryInputSchema.parse(input)

  if (payload.pairs.length === 0) {
    return LessonAssignmentScoreSummaryResultSchema.parse({ data: [], error: null })
  }

  const profile = options?.profile ?? (await requireTeacherProfile())
  void profile

  const uniquePairs = Array.from(
    new Map(payload.pairs.map((pair) => [`${pair.groupId}::${pair.lessonId}`, pair])).values(),
  )

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc("lesson_assignment_score_summaries", { pairs: uniquePairs })

  if (error) {
    console.error("[lesson-assignment-scores] Failed to load lesson score summaries", error)
    return LessonAssignmentScoreSummaryResultSchema.parse({
      data: null,
      error: error.message ?? "Unable to load lesson scores.",
    })
  }

  const parsed = LessonAssignmentScoreSummariesSchema.safeParse(data ?? [])

  if (!parsed.success) {
    console.error("[lesson-assignment-scores] Invalid payload from lesson_assignment_score_summaries", parsed.error)
    return LessonAssignmentScoreSummaryResultSchema.parse({ data: null, error: "Invalid lesson score payload." })
  }

  return LessonAssignmentScoreSummaryResultSchema.parse({ data: parsed.data, error: null })
}
