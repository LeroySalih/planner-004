import Link from "next/link"
import { notFound } from "next/navigation"

import {
  readPupilReportAction,
  readLearningObjectivesByUnitAction,
  type LearningObjectiveWithCriteria,
} from "@/lib/server-updates"

type SuccessCriterion = LearningObjectiveWithCriteria["success_criteria"][number]

type WorkingLevelSummary = {
  groupId: string
  subject: string | null
  joinCode: string | null
  workingLevel: number | null
  assignmentCount: number
}

export default async function ProfileDashboardPage({
  params,
}: {
  params: Promise<{ profileId: string }>
}) {
  const { profileId } = await params

  const reportResult = await readPupilReportAction(profileId)

  if (reportResult.error && !reportResult.data) {
    throw new Error(reportResult.error)
  }

  const report = reportResult.data

  if (!report) {
    notFound()
  }

  const assignments = report.assignments ?? []
  const memberships = report.memberships ?? []
  const feedbackEntries = report.feedback ?? []

  const assignmentsByUnit = new Map<string, typeof assignments>()
  assignments.forEach((assignment) => {
    const unitAssignments = assignmentsByUnit.get(assignment.unit_id) ?? []
    unitAssignments.push(assignment)
    assignmentsByUnit.set(assignment.unit_id, unitAssignments)
  })

  const objectivesByUnit = new Map<string, Awaited<ReturnType<typeof readLearningObjectivesByUnitAction>>>()
  await Promise.all(
    Array.from(assignmentsByUnit.keys()).map(async (unitId) => {
      const result = await readLearningObjectivesByUnitAction(unitId)
      objectivesByUnit.set(unitId, result)
    }),
  )

  const latestFeedbackByCriterion = new Map<string, { rating: number; id: number }>()
  feedbackEntries.forEach((entry) => {
    const { success_criteria_id: criterionId, rating, id } = entry
    const existing = latestFeedbackByCriterion.get(criterionId)
    if (!existing || id > existing.id) {
      latestFeedbackByCriterion.set(criterionId, { rating, id })
    }
  })

  const computeWorkingLevel = (groupId: string): WorkingLevelSummary => {
    const groupMembership = memberships.find((membership) => membership.group_id === groupId)
    const subject = groupMembership?.group?.subject ?? null
    const joinCode = groupMembership?.group?.join_code ?? null

    const groupAssignments = assignments.filter((assignment) => assignment.group_id === groupId)
    const assignmentCount = groupAssignments.length

    if (assignmentCount === 0) {
      return {
        groupId,
        subject,
        joinCode,
        workingLevel: null,
        assignmentCount,
      }
    }

    const rows: Array<{
      level: number
      criterion: SuccessCriterion
    }> = []

    groupAssignments.forEach((assignment) => {
      const objectivesResult = objectivesByUnit.get(assignment.unit_id)
      const objectives = objectivesResult?.data ?? []
      const successCriteria = objectives.flatMap((objective) => {
        const criteria = objective.success_criteria ?? []
        return criteria
          .filter((criterion) => {
            const units = criterion.units ?? []
            return units.includes(assignment.unit_id)
          })
          .map((criterion) => ({
            level: criterion.level,
            criterion,
          }))
      })

      rows.push(...successCriteria)
    })

    if (rows.length === 0) {
      return {
        groupId,
        subject,
        joinCode,
        workingLevel: null,
        assignmentCount,
      }
    }

    const groupedByLevel = new Map<number, SuccessCriterion[]>()
    rows.forEach((row) => {
      const levelRows = groupedByLevel.get(row.level) ?? []
      levelRows.push(row.criterion)
      groupedByLevel.set(row.level, levelRows)
    })

    let workingLevel: number | null = null
    Array.from(groupedByLevel.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([level, criteria]) => {
        const total = criteria.length
        const positive = criteria.filter((criterion) => (latestFeedbackByCriterion.get(criterion.success_criteria_id)?.rating ?? 0) > 0).length
        if (total > 0 && positive / total > 0.5) {
          workingLevel = level
        }
      })

    return {
      groupId,
      subject,
      joinCode,
      workingLevel,
      assignmentCount,
    }
  }

  const summaries = memberships
    .filter((membership) => membership.role.toLowerCase() === "pupil")
    .map((membership) => computeWorkingLevel(membership.group_id))
    .sort((a, b) => a.groupId.localeCompare(b.groupId))

  const profileName = (() => {
    const first = report.profile?.first_name?.trim() ?? ""
    const last = report.profile?.last_name?.trim() ?? ""
    const combined = `${first} ${last}`.trim()
    return combined.length > 0 ? combined : profileId
  })()

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-wide text-slate-300">Dashboard</p>
          <h1 className="text-3xl font-semibold text-white">{profileName}&apos;s dashboard</h1>
          <p className="text-sm text-slate-300">
            Review the groups you belong to and keep track of the latest working levels based on your submitted feedback.
          </p>
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Group overview</h2>
          <Link href="/profiles/groups" className="text-sm text-primary underline-offset-4 hover:underline">
            Manage group memberships
          </Link>
        </div>

        {summaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups joined yet. Use the manage groups page to enter a join code.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="border-b border-border px-4 py-3 text-left">Class</th>
                  <th className="border-b border-border px-4 py-3 text-left">Subject</th>
                  <th className="border-b border-border px-4 py-3 text-left">Level</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.groupId} className="border-t border-border/80">
                    <td className="px-4 py-3">
                      <Link
                        href={`/reports/${profileId}/groups/${summary.groupId}`}
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {summary.groupId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{summary.subject ?? "Not set"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {summary.workingLevel ? `Level ${summary.workingLevel}` : "Not established"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="text-center text-xs text-muted-foreground">Profile ID: {profileId}</footer>
    </main>
  )
}
