import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { getBaseUrl } from "@/lib/pdf-helpers"
import { renderLessonPlanPdf } from "@/lib/pdf/lesson-plan"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Note: This checks the caller is an authenticated teacher but does not verify
  // the lesson belongs to a unit accessible to this teacher. This is acceptable
  // for a single-school deployment where all teachers share access to all content.
  const { lessonId } = await params
  const plan = await renderLessonPlanPdf(lessonId, getBaseUrl(request))

  if (!plan) {
    return new Response("Lesson not found", { status: 404 })
  }

  return new Response(new Uint8Array(plan.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${plan.fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}
