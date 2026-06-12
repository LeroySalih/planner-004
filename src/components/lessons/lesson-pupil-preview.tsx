"use client"

import { X } from "lucide-react"

import type { LessonActivity, LessonLearningObjective } from "@/types"
import { LessonActivityView } from "@/components/lessons/activity-view"
import type { LessonFileInfo, LessonLinkInfo } from "@/components/units/lesson-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface LessonPupilPreviewProps {
  lessonId: string
  lessonTitle: string
  unitTitle: string
  activities: LessonActivity[]
  activityFilesMap: Record<string, LessonFileInfo[]>
  lessonFiles: LessonFileInfo[]
  lessonLinks: LessonLinkInfo[]
  lessonObjectives: LessonLearningObjective[]
  fetchActivityFileUrl: (activityId: string, fileName: string) => Promise<string | null>
  onClose: () => void
}

export function LessonPupilPreview({
  lessonId,
  lessonTitle,
  unitTitle,
  activities,
  activityFilesMap,
  lessonFiles,
  lessonLinks,
  lessonObjectives,
  fetchActivityFileUrl,
  onClose,
}: LessonPupilPreviewProps) {
  const orderedActivities = activities
    .filter((activity) => activity.active !== false)
    .slice()
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
        <header className="rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-8 py-6 text-white shadow-lg">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <Badge variant="secondary" className="bg-white/15 text-white">
                Pupil preview
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="bg-white/10 text-white hover:bg-white/20"
                onClick={onClose}
              >
                <X className="mr-2 h-4 w-4" /> Close
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-3xl font-semibold text-white">{lessonTitle}</h1>
              <p className="text-sm text-slate-100">Unit: {unitTitle}</p>
            </div>
            <p className="text-sm text-slate-100">Here&apos;s everything you need for this lesson.</p>
          </div>
        </header>

        {lessonObjectives.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">Learning Objectives</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {lessonObjectives.map((objective) => (
                  <li key={objective.learning_objective_id}>
                    {objective.learning_objective?.title ?? objective.title}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">Lesson Activities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {orderedActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground">There aren&apos;t any activities attached yet.</p>
            ) : (
              <ol className="space-y-4">
                {orderedActivities.map((activity, index) => (
                  <li
                    key={activity.activity_id}
                    className="rounded-md border border-border/60 bg-muted/40 px-4 py-4"
                  >
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Step {index + 1}
                    </p>
                    <LessonActivityView
                      mode="present"
                      activity={activity}
                      lessonId={lessonId}
                      files={activityFilesMap[activity.activity_id] ?? []}
                      onDownloadFile={() => {}}
                      fetchActivityFileUrl={fetchActivityFileUrl}
                      viewerCanReveal={false}
                      previewMode
                    />
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {lessonLinks.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">Helpful Links</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {lessonLinks.map((link) => (
                  <li key={link.lesson_link_id} className="rounded-md bg-muted/40 px-3 py-2">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {link.description?.trim() || link.url}
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {lessonFiles.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground">Resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Ask your teacher for the latest copy of these resources:</p>
              <ul className="space-y-1">
                {lessonFiles.map((file) => (
                  <li key={file.path} className="rounded-md bg-muted/30 px-3 py-2">
                    {file.name}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
