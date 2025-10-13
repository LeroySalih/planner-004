export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { AssignmentResultsDashboard } from "@/components/assignment-results"
import { requireTeacherProfile } from "@/lib/auth"
import { readAssignmentResultsAction } from "@/lib/server-updates"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface AssignmentResultsPageProps {
  params: { assignmentId: string }
}

export default async function AssignmentResultsPage({ params }: AssignmentResultsPageProps) {
  await requireTeacherProfile()

  const awaitedParams = await params
  const assignmentId = decodeURIComponent(awaitedParams?.assignmentId ?? "")
  const { data, error } = await readAssignmentResultsAction(assignmentId)

  if (!data) {
    if (error === "Assignment not found.") {
      notFound()
    }

    return (
      <div className="container mx-auto space-y-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assignment results</h1>
          <p className="text-sm text-muted-foreground">We were unable to load this assignment overview.</p>
        </div>
        <Alert variant="destructive">
          <AlertTitle>Unable to load results</AlertTitle>
          <AlertDescription>{error ?? "Please try again later."}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8">
      <AssignmentResultsDashboard matrix={data} />
    </div>
  )
}
