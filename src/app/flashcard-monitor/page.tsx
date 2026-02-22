import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readFlashcardMonitorGroupsAction } from "@/lib/server-updates"
import { FlashcardMonitorSelector } from "./flashcard-monitor-selector"

export default async function FlashcardMonitorPage() {
  const result = await readFlashcardMonitorGroupsAction()

  if (result.error || !result.data) {
    return (
      <TeacherPageLayout title="Flashcard Monitor">
        <p className="text-destructive">{result.error ?? "Failed to load data."}</p>
      </TeacherPageLayout>
    )
  }

  return (
    <TeacherPageLayout
      title="Flashcard Monitor"
      subtitle="Monitor pupil flashcard activity"
    >
      <FlashcardMonitorSelector
        groups={result.data.groups}
        groupUnits={result.data.groupUnits}
        groupLessons={result.data.groupLessons}
      />
    </TeacherPageLayout>
  )
}
