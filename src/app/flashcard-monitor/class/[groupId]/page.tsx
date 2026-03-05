import { TeacherPageLayout } from "@/components/layouts/TeacherPageLayout"
import { readClassFlashcardActivityAction } from "@/lib/server-updates"
import { ClassFlashcardMonitor } from "./class-flashcard-monitor"

type PageProps = {
  params: Promise<{ groupId: string }>
}

export default async function ClassFlashcardMonitorPage({ params }: PageProps) {
  const { groupId } = await params
  const result = await readClassFlashcardActivityAction(groupId)

  if (result.error || !result.data) {
    return (
      <TeacherPageLayout
        breadcrumbs={[
          { label: "Flashcard Monitor", href: "/flashcard-monitor" },
          { label: groupId },
          { label: "Class Activity" },
        ]}
        title="Class Activity"
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
        { label: "Class Activity" },
      ]}
      title="Class Activity"
      subtitle={`${groupId} — Live pupil flashcard activity`}
    >
      <ClassFlashcardMonitor
        initialPupils={result.data.pupils}
        initialSessions={result.data.sessions}
      />
    </TeacherPageLayout>
  )
}
