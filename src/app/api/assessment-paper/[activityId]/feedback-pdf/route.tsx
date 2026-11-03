import { createElement } from "react"
import type { ReactElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import type { DocumentProps } from "@react-pdf/renderer"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { mayDownloadAssessmentFeedback, readAssessmentFeedbackPdfData } from "@/lib/assessment-paper/feedback-pdf"
import { AssessmentPaperFeedbackDocument } from "@/components/pdf/assessment-paper-feedback-document"

type Params = { params: Promise<{ activityId: string }> }

/**
 * One pupil's feedback on an assessment paper, built when it is downloaded so
 * a teacher's latest change is in it. `?pupilId=` defaults to the viewer. A
 * pupil gets only their own, once sat and feedback is visible; a teacher any
 * pupil's.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const profile = await getAuthenticatedProfile()
  if (!profile) return new Response("Unauthorized", { status: 401 })

  const { activityId } = await params
  const pupilId = new URL(request.url).searchParams.get("pupilId") || profile.userId
  const isTeacher = hasRole(profile, "teacher")
  if (!(await mayDownloadAssessmentFeedback({ userId: profile.userId, isTeacher }, activityId, pupilId))) {
    return new Response("Forbidden", { status: 403 })
  }

  let data: Awaited<ReturnType<typeof readAssessmentFeedbackPdfData>>
  try {
    data = await readAssessmentFeedbackPdfData(activityId, pupilId)
  } catch (error) {
    console.error("[assessment-paper] failed to build feedback PDF", error)
    return new Response("Assessment paper not found", { status: 404 })
  }

  const docElement = createElement(AssessmentPaperFeedbackDocument, { data }) as unknown as ReactElement<DocumentProps>
  const buffer = await renderToBuffer(docElement)

  const safeTitle =
    data.paperTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "assessment"

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeTitle}-feedback.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
