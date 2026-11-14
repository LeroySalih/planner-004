import { NextResponse } from "next/server"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import { pupilWorkLockedMessage } from "@/lib/lesson-lock"
import { emitSubmissionEvent } from "@/lib/sse/topics"
import {
  PRACTICAL_UPLOAD_MAX_BYTES,
  PracticalFileRefusal,
  readPracticalSlots,
  storePracticalFile,
} from "@/lib/powerpoint-assessment/files"

// A pupil's file for one upload slot of a PowerPoint assessment (multipart:
// activityId, slotKey, pupilId, file, groupAssignmentId?). The pupil
// themselves, or a teacher for a pupil. A route rather than a server action
// because a presentation can be larger than the server-action body limit.
// Storing does not hand in; marking starts on Hand in. After hand-in a pupil
// cannot change a file; a teacher can, and it is sent again (storePracticalFile).

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const tag = `[practical-upload:${requestId}]`

  const profile = await getAuthenticatedProfile()
  if (!profile) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} Failed to parse form data`, err)
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }

  const activityId = field(formData, "activityId")
  const slotKey = field(formData, "slotKey")
  const pupilId = field(formData, "pupilId")
  const groupAssignmentId = field(formData, "groupAssignmentId")
  const file = formData.get("file")

  if (!activityId) return NextResponse.json({ success: false, error: "Missing activityId" }, { status: 400 })
  if (!slotKey) return NextResponse.json({ success: false, error: "Missing slotKey" }, { status: 400 })
  if (!pupilId) return NextResponse.json({ success: false, error: "Missing pupilId" }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })

  if (profile.userId !== pupilId && !hasRole(profile, "teacher")) {
    console.warn(`${tag} Auth mismatch: session=${profile.userId} requested pupilId=${pupilId}`)
    return NextResponse.json({ success: false, error: "You are not allowed to upload files for this pupil." }, { status: 403 })
  }

  // A locked lesson is read-only for pupils: no uploads (src/lib/lesson-lock.ts).
  const lockedMessage = await pupilWorkLockedMessage(pupilId, activityId)
  if (lockedMessage) {
    return NextResponse.json({ success: false, error: lockedMessage }, { status: 403 })
  }

  if (file.size > PRACTICAL_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ success: false, error: "The file is larger than the 25 MB limit." }, { status: 413 })
  }

  try {
    const stored = await storePracticalFile({
      activityId,
      pupilId,
      slotKey,
      bytes: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
      uploadedBy: profile.userId,
      // After hand-in only a teacher may change a file.
      byTeacher: hasRole(profile, "teacher"),
      // Validated against the lesson and the pupil's classes before use.
      groupAssignmentId,
    })
    console.log(`${tag} Stored`, { activityId, slotKey, fileId: stored.file_id, bytes: stored.bytes })

    try {
      await emitSubmissionEvent("submission.uploaded", {
        submissionId: stored.submission_id,
        activityId,
        pupilId,
        submittedAt: new Date().toISOString(),
        fileName: stored.original_name,
        submissionStatus: stored.requeued ? "submitted" : "inprogress",
        isFlagged: false,
      })
    } catch (err) {
      console.error(`${tag} SSE emit failed (non-fatal)`, err)
    }

    return NextResponse.json({
      success: true,
      data: { file: stored, state: await readPracticalSlots(activityId, pupilId) },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to store the file."
    if (error instanceof PracticalFileRefusal) {
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }
    console.error(`${tag} Upload failed`, error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
