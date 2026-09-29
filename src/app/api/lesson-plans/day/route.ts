import archiver from "archiver"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { getBaseUrl } from "@/lib/pdf-helpers"
import { renderLessonPlanPdf } from "@/lib/pdf/lesson-plan"

const VALID_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday"] as const
type Day = (typeof VALID_DAYS)[number]

/** Sunday-start week plus the weekday offset, as DD-MM-YYYY for the file name. */
function dateForDay(weekStartDate: string, day: Day): string {
  const start = new Date(`${weekStartDate}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() + VALID_DAYS.indexOf(day))
  return [
    String(start.getUTCDate()).padStart(2, "0"),
    String(start.getUTCMonth() + 1).padStart(2, "0"),
    start.getUTCFullYear(),
  ].join("-")
}

/**
 * Every lesson plan for one teaching day, as a single zip.
 *
 * Plans are rendered one after another rather than in parallel: each one pulls
 * activity images and QR codes over the network, and a busy day would otherwise
 * open a dozen renders at once.
 */
export async function GET(request: Request) {
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    return new Response("Unauthorized", { status: 401 })
  }

  const url = new URL(request.url)
  const day = (url.searchParams.get("day") ?? "").toLowerCase() as Day
  const week = url.searchParams.get("week") ?? ""
  const teacherId = url.searchParams.get("teacherId") || profile.userId

  if (!VALID_DAYS.includes(day)) {
    return new Response(`day must be one of ${VALID_DAYS.join(", ")}`, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return new Response("week must be an ISO date (YYYY-MM-DD)", { status: 400 })
  }

  // Scoped through timetable_slot_groups so a teacher only ever archives the
  // slots that are theirs, the same way the planner grid is scoped.
  const { rows } = await query<{ lesson_id: string; period: number; group_id: string }>(
    `select pa.lesson_id, pa.period, pa.group_id
       from planner_assignments pa
       join timetable_slot_groups tsg
         on tsg.teacher_id = $1 and tsg.day = pa.day
        and tsg.period = pa.period and tsg.group_id = pa.group_id
      where pa.week_start_date = $2 and pa.day = $3
      order by pa.period, pa.group_id`,
    [teacherId, week, day],
  )

  if (rows.length === 0) {
    return new Response("No lessons planned for that day", { status: 404 })
  }

  const baseUrl = getBaseUrl(request)
  const archiveName = `${day}-${dateForDay(week, day)}.zip`

  // Built in full before replying, the same as the single-lesson route, which
  // returns a Uint8Array. The first version piped a Node PassThrough into
  // `new Response(stream as unknown as ReadableStream)` — a cast that compiles
  // and then fails at runtime, because a Node stream is not a web one. The
  // browser got a broken response it saved as "day.txt", and because the
  // rendering ran detached in a background task, every retry started another
  // full day's worth of renders that nothing was waiting for. That is what
  // locked the server.
  const archive = archiver("zip", { zlib: { level: 9 } })
  const chunks: Buffer[] = []
  const collected = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk))
    archive.on("end", () => resolve(Buffer.concat(chunks)))
    archive.on("error", reject)
  })

  try {
    const used = new Set<string>()
    for (const row of rows) {
      const plan = await renderLessonPlanPdf(row.lesson_id, baseUrl)
      if (!plan) continue

      // Period and class prefix the name: the same lesson can be taught to
      // several classes in a day, and a zip cannot hold two identical names.
      let name = `P${row.period}-${row.group_id}-${plan.fileName}`
      let n = 2
      while (used.has(name)) name = `P${row.period}-${row.group_id}-${n++}-${plan.fileName}`
      used.add(name)

      archive.append(plan.buffer, { name })
    }
    await archive.finalize()
    const body = await collected

    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archiveName}"`,
        "Content-Length": String(body.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[lesson-plans/day] Failed to build archive", error)
    archive.abort()
    // A real status, so the browser reports a failure rather than saving the
    // error as the file the teacher asked for.
    return new Response("Could not build the lesson plans for that day", { status: 500 })
  }
}
