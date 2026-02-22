import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readLiveFlashcardMonitorAction } from "@/lib/server-updates"
import { LiveFlashcardMonitor } from "./live-flashcard-monitor"

type PageProps = {
  params: Promise<{ groupId: string; lessonId: string }>
}

export default async function LiveFlashcardMonitorPage({ params }: PageProps) {
  const { groupId, lessonId } = await params
  const result = await readLiveFlashcardMonitorAction(groupId, lessonId)

  if (result.error || !result.data) {
    return (
      <TeacherPageLayout
        breadcrumbs={[
          { label: "Flashcard Monitor", href: "/flashcard-monitor" },
          { label: "Live Monitor" },
        ]}
        title="Live Monitor"
      >
        <p className="text-destructive">{result.error ?? "Failed to load data."}</p>
      </TeacherPageLayout>
    )
  }

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "Flashcard Monitor", href: "/flashcard-monitor" },
        { label: groupId },
        { label: result.data.lessonTitle },
      ]}
      title={result.data.lessonTitle}
      subtitle={`${groupId} — Live flashcard monitor`}
    >
      <LiveFlashcardMonitor
        initialPupils={result.data.pupils}
        lessonId={lessonId}
      />
    </TeacherPageLayout>
  )
}
