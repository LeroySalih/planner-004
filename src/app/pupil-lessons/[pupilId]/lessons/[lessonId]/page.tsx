import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { format } from "date-fns"
import { Download, Music2, PlaySquare, TestTube, ArrowLeft } from "lucide-react"

import { requireAuthenticatedProfile } from "@/lib/auth"
import { loadPupilLessonsSummaries } from "@/lib/pupil-lessons-data"
import {
  readLessonAction,
  listLessonActivitiesAction,
  listLessonFilesAction,
  listActivityFilesAction,
  listPupilActivitySubmissionsAction,
} from "@/lib/server-updates"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PupilUploadActivity } from "@/components/pupil/pupil-upload-activity"

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return "No start date"
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return format(parsed, "PPP")
}

function formatActivityType(type: string | null | undefined): string {
  if (!type) return ""
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function selectActivityIcon(type: string | null | undefined, hasAudio: boolean, linkUrl: string | null) {
  if (!type) {
    return hasAudio ? <Music2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null
  }

  const normalized = type.toLowerCase()

  if (normalized.includes("test")) {
    return <TestTube className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("download") || normalized.includes("file")) {
    return <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("audio") || normalized.includes("voice") || hasAudio) {
    return <Music2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }
  if (normalized.includes("video") || (linkUrl && isYouTubeUrl(linkUrl))) {
    return <PlaySquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  }

  return null
}

function isYouTubeUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be")
  } catch {
    return false
  }
}

function extractActivityLink(activity: { body_data: unknown; title: string }) {
  const bodyData = activity.body_data
  if (typeof bodyData !== "object" || bodyData === null) {
    return null
  }

  const record = bodyData as Record<string, unknown>
  const candidateKeys = ["url", "fileUrl", "href", "videoUrl"]

  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  const nestedLink = record.link
  if (typeof nestedLink === "object" && nestedLink !== null) {
    const nestedUrl = (nestedLink as Record<string, unknown>).url
    if (typeof nestedUrl === "string" && nestedUrl.trim().length > 0) {
      return nestedUrl.trim()
    }
  }

  return null
}

function extractAudioUrl(activity: { body_data: unknown }) {
  const bodyData = activity.body_data
  if (typeof bodyData !== "object" || bodyData === null) {
    return null
  }

  const record = bodyData as Record<string, unknown>
  const candidateKeys = ["audioFile", "audioUrl", "voice", "fileUrl"]

  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  const nestedVoice = record.voice
  if (typeof nestedVoice === "object" && nestedVoice !== null) {
    const nestedUrl = (nestedVoice as Record<string, unknown>).audioFile ?? (nestedVoice as Record<string, unknown>).url
    if (typeof nestedUrl === "string" && nestedUrl.trim().length > 0) {
      return nestedUrl.trim()
    }
  }

  return null
}

function extractUploadInstructions(activity: { body_data: unknown }) {
  const bodyData = activity.body_data
  if (typeof bodyData !== "object" || bodyData === null) {
    return ""
  }

  const record = bodyData as Record<string, unknown>
  const instructions = record.instructions
  return typeof instructions === "string" ? instructions : ""
}

export default async function PupilLessonFriendlyPage({
  params,
}: {
  params: Promise<{ pupilId: string; lessonId: string }>
}) {
  const profile = await requireAuthenticatedProfile()
  const { pupilId, lessonId } = await params

  if (!profile.isTeacher && profile.userId !== pupilId) {
    redirect(`/pupil-lessons/${encodeURIComponent(profile.userId)}`)
  }

  const [summaries, lessonResult, activitiesResult, filesResult] = await Promise.all([
    loadPupilLessonsSummaries(pupilId),
    readLessonAction(lessonId),
    listLessonActivitiesAction(lessonId),
    listLessonFilesAction(lessonId),
  ])

  const summary = summaries[0]
  const lesson = lessonResult.data
  if (!lesson) {
    notFound()
  }

  const activities = activitiesResult.data ?? []
  const lessonFiles = filesResult.data ?? []

  const uploadActivities = activities.filter((activity) => activity.type === "upload-file")

  const uploadActivityData = await Promise.all(
    uploadActivities.map(async (activity) => {
      const [resourcesResult, submissionsResult] = await Promise.all([
        listActivityFilesAction(lesson.lesson_id, activity.activity_id),
        listPupilActivitySubmissionsAction(lesson.lesson_id, activity.activity_id, pupilId),
      ])

      return {
        activityId: activity.activity_id,
        resources: resourcesResult.error ? [] : resourcesResult.data ?? [],
        submissions: submissionsResult.error ? [] : submissionsResult.data ?? [],
      }
    }),
  )

  const resourceMap = new Map(uploadActivityData.map((item) => [item.activityId, item.resources]))
  const submissionMap = new Map(uploadActivityData.map((item) => [item.activityId, item.submissions]))

  const canUpload = !profile.isTeacher && profile.userId === pupilId

  const assignments = summary
    ? summary.sections.flatMap((section) =>
        section.groups
          .filter((group) => group.lessons.some((l) => l.lessonId === lesson.lesson_id))
          .map((group) => ({
            date: section.date,
            groupId: group.groupId,
            subject: group.subject,
          })),
      )
    : []

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-3">
          <div>
            <Link
              href={`/pupil-lessons/${encodeURIComponent(pupilId)}`}
              className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to My Lessons
            </Link>
          </div>
          <h1 className="text-3xl font-semibold text-white">{lesson.title}</h1>
          <p className="text-sm text-slate-100">Unit: {lesson.unit_id}</p>
          {summary ? (
            <p className="text-sm text-slate-100">Hello {summary.name}, here&apos;s everything you need for this lesson.</p>
          ) : (
            <p className="text-sm text-slate-100">Here&apos;s everything you need for this lesson.</p>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Lesson Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          {assignments.length > 0 ? (
            <ul className="space-y-2">
              {assignments.map((assignment, index) => (
                <li key={`${assignment.groupId}-${assignment.date}-${index}`} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="font-medium text-foreground">Group: {assignment.groupId}</div>
                  {assignment.subject ? <div>Subject: {assignment.subject}</div> : null}
                  <div>Starts: {formatDateLabel(assignment.date)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p>This lesson isn’t currently linked to your assignments, but you can still review its resources below.</p>
          )}
        </CardContent>
      </Card>

      {lesson.lesson_objectives && lesson.lesson_objectives.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">Learning Objectives</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              {lesson.lesson_objectives.map((objective) => (
                <li key={objective.learning_objective_id}>
                  {objective.learning_objective?.title ?? objective.learning_objective_id}
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
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">There aren&apos;t any activities attached yet.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {activities.map((activity, index) => {
                const linkUrl = extractActivityLink(activity)
                const audioUrl = extractAudioUrl(activity)
                const icon = selectActivityIcon(activity.type, Boolean(audioUrl), linkUrl)

                return (
                  <li
                    key={activity.activity_id}
                    className="rounded-md border border-border/60 bg-muted/40 px-3 py-3"
                  >
                    {activity.type === "upload-file" ? (
                      <PupilUploadActivity
                        lessonId={lesson.lesson_id}
                        activity={activity}
                        pupilId={pupilId}
                        instructions={extractUploadInstructions(activity)}
                        resourceFiles={resourceMap.get(activity.activity_id) ?? []}
                        initialSubmissions={submissionMap.get(activity.activity_id) ?? []}
                        canUpload={canUpload}
                        stepNumber={index + 1}
                      />
                    ) : (
                      <>
                        <div className="flex items-start gap-2">
                          <span className="text-xs font-semibold text-muted-foreground">{index + 1}.</span>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              {icon}
                              {linkUrl ? (
                                <Link
                                  href={linkUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-primary underline-offset-4 hover:underline"
                                >
                                  {activity.title}
                                </Link>
                              ) : (
                                <span className="font-medium text-foreground">{activity.title}</span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">{formatActivityType(activity.type)}</span>
                            {linkUrl ? <span className="break-all text-xs text-muted-foreground">{linkUrl}</span> : null}
                          </div>
                        </div>

                        {audioUrl && activity.type !== "show-video" ? (
                          <audio className="mt-3 w-full" controls preload="none" src={audioUrl}>
                            Your browser does not support the audio element.
                          </audio>
                        ) : null}
                      </>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {(lesson.lesson_links?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">Helpful Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ul className="space-y-2">
              {lesson.lesson_links!.map((link) => (
                <li key={link.lesson_link_id} className="rounded-md bg-muted/40 px-3 py-2">
                  <Link
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {link.description?.trim() || link.url}
                  </Link>
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
    </main>
  )
}
