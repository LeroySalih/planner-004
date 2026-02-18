"use client"

import { useRouter } from "next/navigation"
import { AlertTriangle, Flag, MessageSquare } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"

interface Group {
  groupId: string
}

interface Unit {
  unitId: string
  title: string | null
}

interface Lesson {
  lessonId: string
  title: string
  orderBy: number
}

interface Comment {
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
}

interface PeerReviewAdminProps {
  groups: Group[]
  units: Unit[]
  lessons: Lesson[]
  comments: Comment[]
  selectedGroupId: string | null
  selectedUnitId: string | null
  selectedLessonId: string | null
}

function buildUrl(params: Record<string, string | null>) {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value)
  }
  const qs = sp.toString()
  return `/feedback/peer-review${qs ? `?${qs}` : ""}`
}

export function PeerReviewAdmin({
  groups,
  units,
  lessons,
  comments,
  selectedGroupId,
  selectedUnitId,
  selectedLessonId,
}: PeerReviewAdminProps) {
  const router = useRouter()

  const handleGroupChange = (groupId: string) => {
    router.push(buildUrl({ groupId }))
  }

  const handleUnitChange = (unitId: string) => {
    router.push(buildUrl({ groupId: selectedGroupId, unitId }))
  }

  const handleLessonChange = (lessonId: string) => {
    router.push(buildUrl({ groupId: selectedGroupId, unitId: selectedUnitId, lessonId }))
  }

  const flaggedComments = comments.filter((c) => c.isFlagged)
  const normalComments = comments.filter((c) => !c.isFlagged)

  return (
    <div className="mt-6 space-y-6">
      {/* Cascading filters */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Class filter */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Class</label>
          <Select
            value={selectedGroupId ?? undefined}
            onValueChange={handleGroupChange}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select a class..." />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.groupId} value={group.groupId}>
                  {group.groupId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Unit filter */}
        {selectedGroupId && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Unit</label>
            <Select
              value={selectedUnitId ?? undefined}
              onValueChange={handleUnitChange}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select a unit..." />
              </SelectTrigger>
              <SelectContent>
                {units.map((unit) => (
                  <SelectItem key={unit.unitId} value={unit.unitId}>
                    {unit.title ?? unit.unitId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Lesson filter */}
        {selectedUnitId && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Lesson</label>
            <Select
              value={selectedLessonId ?? undefined}
              onValueChange={handleLessonChange}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select a lesson..." />
              </SelectTrigger>
              <SelectContent>
                {lessons.map((lesson) => (
                  <SelectItem key={lesson.lessonId} value={lesson.lessonId}>
                    {lesson.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* State messages */}
      {!selectedGroupId ? (
        <p className="text-sm text-muted-foreground">
          Select a class to get started.
        </p>
      ) : !selectedUnitId ? (
        <p className="text-sm text-muted-foreground">
          Select a unit to continue.
        </p>
      ) : !selectedLessonId ? (
        <p className="text-sm text-muted-foreground">
          Select a lesson to view its peer review comments.
        </p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No peer review comments for this lesson yet.
        </p>
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span>{comments.length} total comment{comments.length !== 1 ? "s" : ""}</span>
            </div>
            {flaggedComments.length > 0 && (
              <div className="flex items-center gap-1.5 text-amber-600">
                <Flag className="h-4 w-4" />
                <span>{flaggedComments.length} flagged</span>
              </div>
            )}
          </div>

          {/* Flagged comments first */}
          {flaggedComments.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-amber-600 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Flagged Comments
              </h2>
              <div className="space-y-2">
                {flaggedComments.map((comment) => (
                  <CommentCard key={comment.commentId} comment={comment} />
                ))}
              </div>
            </div>
          )}

          {/* All other comments */}
          {normalComments.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">
                {flaggedComments.length > 0 ? "Other Comments" : "All Comments"}
              </h2>
              <div className="space-y-2">
                {normalComments.map((comment) => (
                  <CommentCard key={comment.commentId} comment={comment} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CommentCard({ comment }: { comment: Comment }) {
  const date = new Date(comment.createdAt)
  const formatted = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`

  return (
    <div
      className={`rounded-md border p-4 text-sm ${
        comment.isFlagged
          ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{comment.authorName}</span>
            <span>&rarr;</span>
            <span className="font-medium text-foreground">{comment.targetName}</span>
            <span>&middot;</span>
            <span>{formatted}</span>
          </div>
          <p className="text-foreground">{comment.commentText}</p>
        </div>
        {comment.isFlagged && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600 border-amber-300">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Flagged
          </Badge>
        )}
      </div>
    </div>
  )
}
