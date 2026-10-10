import { createElement } from "react"
import type { ReactElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import type { DocumentProps } from "@react-pdf/renderer"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { getAssessmentFeedbackPack } from "@/lib/assessments/store"
import { AssessmentFeedbackDocument } from "@/components/pdf/assessment-feedback-document"

type Params = { params: Promise<{ assessmentId: string }> }

/** Printable feedback pack for a paper: one pupil per page. Teachers only. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { assessmentId } = await params
  let pack: Awaited<ReturnType<typeof getAssessmentFeedbackPack>>
  try {
    pack = await getAssessmentFeedbackPack(assessmentId)
  } catch {
    return new Response("Assessment not found", { status: 404 })
  }

  const docElement = createElement(AssessmentFeedbackDocument, pack) as unknown as ReactElement<DocumentProps>
  const buffer = await renderToBuffer(docElement)

  const safeTitle = pack.paper.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "assessment"

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeTitle}-feedback.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
