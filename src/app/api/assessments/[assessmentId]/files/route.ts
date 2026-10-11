import { revalidatePath } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedProfile, hasRole } from '@/lib/auth'
import { ASSESSMENT_UPLOAD_MAX_BYTES, storeAssessmentFile } from '@/lib/assessments/store'
import { cleanFileName } from '@/lib/mcp/file-input'
import type { AssessmentFile } from '@/types'

// Teacher upload of scans (or any PDF/image) against a paper, from the
// Assessments page. Several files may be sent at once under the "file" field;
// each is stored independently, so one bad file does not lose the others.
// A file named after a pupil is linked to them (see storeAssessmentFile).

type Params = { params: Promise<{ assessmentId: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, 'teacher')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const { assessmentId } = await params

  let files: File[]
  try {
    files = (await request.formData()).getAll('file').filter((value): value is File => value instanceof File)
  } catch {
    return NextResponse.json({ success: false, error: 'Send the files as multipart form data' }, { status: 400 })
  }
  if (files.length === 0) {
    return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
  }

  const stored: AssessmentFile[] = []
  const errors: string[] = []
  for (const file of files) {
    const name = cleanFileName(file.name || 'scan')
    if (file.size > ASSESSMENT_UPLOAD_MAX_BYTES) {
      errors.push(`${name}: larger than the 25 MB limit`)
      continue
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      stored.push(await storeAssessmentFile(assessmentId, name, buffer, { contentType: file.type || null, uploadedBy: profile.userId, matchByName: true }))
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : 'upload failed'}`)
    }
  }

  if (stored.length > 0) revalidatePath(`/assessments/${assessmentId}`)
  return NextResponse.json(
    { success: errors.length === 0, files: stored, errors },
    { status: stored.length > 0 || errors.length === 0 ? 200 : 400 },
  )
}
