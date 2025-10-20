import Link from "next/link"
import { notFound } from "next/navigation"

import { readAssignmentsForGroupAction, readGroupAction, readUnitAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"

import { getPreparedReportData } from "../../[pupilId]/report-data"

function formatPercent(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—"
  }
  return `${Math.round(value * 100)}%`
}

function formatLevel(assessmentLevel: string | null, workingLevel: number | null) {
  const resolved = assessmentLevel ?? (typeof workingLevel === "number" ? workingLevel.toString() : null)
  return resolved ? `Level ${resolved}` : "—"
}

export default async function GroupReportPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  await requireTeacherProfile()

  const { groupId } = await params

  const groupResult = await readGroupAction(groupId)
  if (!groupResult.data) {
    notFound()
  }

  const group = groupResult.data
  const groupSubject = group.subject ?? "Subject not set"

  const assignmentsResult = await readAssignmentsForGroupAction(groupId)
  const assignments = assignmentsResult.data ?? []
  const assignedUnitIds = Array.from(new Set(assignments.map((assignment) => assignment.unit_id)))

  const unitMetaEntries = await Promise.all(
    assignedUnitIds.map(async (unitId) => {
      const { data } = await readUnitAction(unitId)
      return {
        unitId,
        title: data?.title ?? unitId,
        subject: data?.subject ?? "Subject not set",
      }
    }),
  )

  const unitMetaMap = new Map(unitMetaEntries.map((entry) => [entry.unitId, entry]))
  const sortUnits = (list: Array<{ unitId: string; title: string; subject: string }>) =>
    list.slice().sort((a, b) => {
      const subjectCompare = a.subject.localeCompare(b.subject)
      if (subjectCompare !== 0) return subjectCompare
      return a.title.localeCompare(b.title)
    })

  const unitColumns = sortUnits(unitMetaEntries)

  const pupilMembers = (group.members ?? [])
    .filter((member) => member.role?.trim().toLowerCase() === "pupil")
    .map((member) => {
      const first = member.profile?.first_name?.trim() ?? ""
      const last = member.profile?.last_name?.trim() ?? ""
      const displayName = `${first} ${last}`.trim()
      return {
        userId: member.user_id,
        displayName: displayName.length > 0 ? displayName : member.user_id,
        lastName: last,
        firstName: first,
      }
    })
    .sort((a, b) => {
      const lastNameCompare = a.lastName.localeCompare(b.lastName)
      if (lastNameCompare !== 0) {
        return lastNameCompare
      }
      return a.firstName.localeCompare(b.firstName)
    })

  const pupilReports = await Promise.all(
    pupilMembers.map(async (member) => {
      const prepared = await getPreparedReportData(member.userId, groupId)

      const unitScores = new Map<string, { assessmentAverage: number | null; levelLabel: string }>()

      if (prepared) {
        prepared.subjectEntries.forEach((entry) => {
          entry.units.forEach((unit) => {
            if (!unitMetaMap.has(unit.unitId)) {
              unitMetaMap.set(unit.unitId, {
                unitId: unit.unitId,
                title: unit.unitTitle,
                subject: entry.subject,
              })
            }
            unitScores.set(unit.unitId, {
              assessmentAverage: unit.assessmentAverage,
              levelLabel: formatLevel(unit.assessmentLevel, unit.workingLevel),
            })
          })
        })
      }

      return {
        userId: member.userId,
        displayName: member.displayName,
        unitScores,
      }
    }),
  )

  const resolvedUnitColumns = sortUnits(unitColumns.length > 0 ? unitColumns : Array.from(unitMetaMap.values()))

  const hasUnits = resolvedUnitColumns.length > 0
  const hasPupils = pupilMembers.length > 0

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-white">Group Report</h1>
          <div className="text-sm text-slate-200">
            <span className="font-medium">Group:</span> {groupId} · <span className="font-medium">Subject:</span>{" "}
            {groupSubject}
          </div>
        </div>
      </header>

      {!hasUnits ? (
        <p className="text-sm text-muted-foreground">
          No units are currently assigned to this group.
        </p>
      ) : !hasPupils ? (
        <p className="text-sm text-muted-foreground">No pupils are enrolled in this group yet.</p>
      ) : (
        <div className="overflow-auto rounded-lg border border-border">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="sticky left-0 top-0 z-30 border border-border bg-muted px-4 py-3 text-left">Pupil</th>
                {resolvedUnitColumns.map((unit) => (
                  <th
                    key={unit.unitId}
                    className="sticky top-0 z-20 min-w-[180px] border border-border bg-muted px-4 py-3 text-left align-bottom"
                  >
                    <div className="flex flex-col gap-1 text-left text-xs">
                      <span className="text-sm font-semibold text-foreground">{unit.title}</span>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {unit.subject}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pupilReports.length === 0 ? (
                <tr>
                  <td
                    colSpan={resolvedUnitColumns.length + 1}
                    className="px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    Unable to load pupil report data.
                  </td>
                </tr>
              ) : (
                pupilReports.map((report) => (
                  <tr key={report.userId}>
                    <td className="sticky left-0 z-10 border border-border bg-background px-4 py-2 font-medium text-foreground">
                      <Link
                        href={`/reports/${report.userId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {report.displayName}
                      </Link>
                    </td>
                    {resolvedUnitColumns.map((unit) => {
                      const score = report.unitScores.get(unit.unitId)
                      return (
                        <td key={`${report.userId}-${unit.unitId}`} className="border border-border px-4 py-2 align-top">
                          <div className="flex flex-col gap-1 text-sm">
                            <span className="font-medium text-foreground">
                              {formatPercent(score?.assessmentAverage ?? null)}
                            </span>
                            <span className="text-xs text-muted-foreground">{score?.levelLabel ?? "—"}</span>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
