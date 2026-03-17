"use server"

import { z } from "zod"
import { query } from "@/lib/db"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { emitSseEvent } from "@/lib/sse/hub"

const AddCommentInputSchema = z.object({
  submissionId: z.string().min(1),
  comment: z.string().trim().min(1).max(2000),
})

const AddCommentResultSchema = z.object({
  data: z.object({ commentId: z.string() }).nullable(),
  error: z.string().nullable(),
})

export async function addSubmissionCommentAction(
  input: z.infer<typeof AddCommentInputSchema>,
) {
  const profile = await requireAuthenticatedProfile()

  const parsed = AddCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    return AddCommentResultSchema.parse({ data: null, error: "Invalid input." })
  }

  // Verify the submission belongs to the calling user
  try {
    const { rows: ownerRows } = await query<{ submission_id: string }>(
      "SELECT submission_id FROM submissions WHERE submission_id = $1 AND user_id = $2 LIMIT 1",
      [parsed.data.submissionId, profile.userId],
    )
    if (!ownerRows?.[0]) {
      return AddCommentResultSchema.parse({
        data: null,
        error: "Submission not found or does not belong to you.",
      })
    }
  } catch (error) {
    console.error("[submission-comments] ownership check failed", error)
    return AddCommentResultSchema.parse({ data: null, error: "Unable to verify submission." })
  }

  // Insert comment
  let commentId: string
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO submission_comments (submission_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [parsed.data.submissionId, profile.userId, parsed.data.comment],
    )
    commentId = rows[0].id
  } catch (error) {
    console.error("[submission-comments] insert failed", error)
    return AddCommentResultSchema.parse({ data: null, error: "Unable to save comment." })
  }

  // Broadcast via SSE so the dashboard badge updates live
  await emitSseEvent({
    topic: "submissions",
    type: "submission.comment_added",
    payload: { commentId, submissionId: parsed.data.submissionId, userId: profile.userId },
  })

  return AddCommentResultSchema.parse({ data: { commentId }, error: null })
}
