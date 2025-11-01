import { performance } from "node:perf_hooks"

import { listPupilsWithGroupsAction } from "@/lib/server-updates"
import { ReportsTable } from "./reports-table"
import { requireTeacherProfile } from "@/lib/auth"
import { withTelemetry } from "@/lib/telemetry"

export default async function ReportsLandingPage() {
  await requireTeacherProfile()
  const authEnd = performance.now()

  const pupilListings = await withTelemetry(
    {
      routeTag: "reports",
      functionName: "listPupilsWithGroupsAction",
      params: null,
      authEndTime: authEnd,
    },
    () => listPupilsWithGroupsAction(),
  )

  const pupils = pupilListings.map((listing) => ({
    pupilId: listing.pupilId,
    name: listing.pupilName,
    groups: listing.groups.map((group) => group.group_id).sort((a, b) => a.localeCompare(b)),
  }))

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h1 id="reports-page-title" className="text-3xl font-semibold text-white">
              Reports
            </h1>
          </div>
          <p className="text-sm text-slate-200">
            Browse groups and access individual pupil reports. Use the filter to quickly find pupils or groups.
          </p>
        </div>
      </header>


      <ReportsTable pupils={pupils} />
    </main>
  )
}
