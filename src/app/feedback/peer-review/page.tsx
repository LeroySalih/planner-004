import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import {
  readPeerReviewFilterOptionsAction,
  readAllPeerReviewCommentsForLessonAction,
} from "@/lib/server-updates"
import { PeerReviewAdmin } from "./peer-review-admin"

export default async function PeerReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ groupId?: string; unitId?: string; lessonId?: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  if (!profile.roles.includes("teacher")) {
    redirect("/")
  }

  const params = await searchParams
  const selectedGroupId = params.groupId ?? null
  const selectedUnitId = params.unitId ?? null
  const selectedLessonId = params.lessonId ?? null

  // Load filter options — only groups/units/lessons that have peer review comments
  const filterResult = await readPeerReviewFilterOptionsAction({
    groupId: selectedGroupId ?? undefined,
    unitId: selectedUnitId ?? undefined,
  })

  const groups = filterResult.success && filterResult.data ? filterResult.data.groups : []
  const units = filterResult.success && filterResult.data ? filterResult.data.units : []
  const lessons = filterResult.success && filterResult.data ? filterResult.data.lessons : []

  // Load comments for selected lesson
  let comments: Array<{
    commentId: string
    commentText: string
    isFlagged: boolean
    flaggedAt: string | null
    createdAt: string
    reviewActivityId: string
    activityTitle: string | null
    authorName: string
    targetName: string
    authorUserId: string
    targetUserId: string
  }> = []

  if (selectedLessonId) {
    const commentsResult = await readAllPeerReviewCommentsForLessonAction(selectedLessonId)
    if (commentsResult.success && commentsResult.data) {
      comments = commentsResult.data
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground">Peer Review Comments</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Filter by class, unit, and lesson to view peer review comments.
      </p>

      <PeerReviewAdmin
        groups={groups}
        units={units}
        lessons={lessons}
        comments={comments}
        selectedGroupId={selectedGroupId}
        selectedUnitId={selectedUnitId}
        selectedLessonId={selectedLessonId}
      />
    </div>
  )
}
