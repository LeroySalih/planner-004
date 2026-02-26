import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readFlashcardSessionDetailAction } from "@/lib/server-updates"
import { SessionDetailView } from "./session-detail-view"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string; pupilId: string; activityId: string }>
}

export default async function FlashcardSessionDetailPage({ params }: PageProps) {
  const { groupId, unitId, pupilId } = await params
  const result = await readFlashcardSessionDetailAction(pupilId, unitId)

  if (result.error || !result.data) {
    return (
      <TeacherPageLayout
        breadcrumbs={[
          { label: "Flashcard Monitor", href: "/flashcard-monitor" },
          { label: "Study Tracker", href: `/flashcard-monitor/study/${encodeURIComponent(groupId)}/${encodeURIComponent(unitId)}` },
          { label: "Session Detail" },
        ]}
        title="Session Detail"
      >
        <p className="text-destructive">{result.error ?? "Failed to load session detail."}</p>
      </TeacherPageLayout>
    )
  }

  return (
    <TeacherPageLayout
      breadcrumbs={[
        { label: "Flashcard Monitor", href: "/flashcard-monitor" },
        { label: "Study Tracker", href: `/flashcard-monitor/study/${encodeURIComponent(groupId)}/${encodeURIComponent(unitId)}` },
        { label: result.data.pupilName },
      ]}
      title={result.data.pupilName}
      subtitle="Flashcard session detail"
    >
      <SessionDetailView sessions={result.data.sessions} />
    </TeacherPageLayout>
  )
}
