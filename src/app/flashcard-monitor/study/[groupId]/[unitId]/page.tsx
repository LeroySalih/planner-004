import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readStudyTrackerAction } from "@/lib/server-updates"
import { StudyTrackerGrid } from "./study-tracker-grid"

type PageProps = {
  params: Promise<{ groupId: string; unitId: string }>
}

export default async function StudyTrackerPage({ params }: PageProps) {
  const { groupId, unitId } = await params
  const result = await readStudyTrackerAction(groupId, unitId)

  if (result.error || !result.data) {
    return (
      <TeacherPageLayout
        breadcrumbs={[
          { label: "Flashcard Monitor", href: "/flashcard-monitor" },
          { label: "Study Tracker" },
        ]}
        title="Study Tracker"
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
        { label: result.data.unitTitle },
      ]}
      title={result.data.unitTitle}
      subtitle={`${groupId} — Flashcard study tracker`}
    >
      <StudyTrackerGrid
        lessons={result.data.lessons}
        pupils={result.data.pupils}
        cells={result.data.cells}
      />
    </TeacherPageLayout>
  )
}
