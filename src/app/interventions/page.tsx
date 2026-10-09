import { InterventionsTable } from '@/components/interventions/interventions-table'
import { TeacherPageLayout } from '@/components/layouts/TeacherPageLayout'
import { readInterventionsAction } from '@/lib/server-actions/interventions'

export default async function InterventionsPage() {
  const { data, error } = await readInterventionsAction()

  return (
    <TeacherPageLayout
      title="Interventions"
      subtitle="Lessons written for one pupil. Claude creates them through MCP; status and score update as the pupil works."
    >
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <InterventionsTable interventions={data ?? []} />
      )}
    </TeacherPageLayout>
  )
}
