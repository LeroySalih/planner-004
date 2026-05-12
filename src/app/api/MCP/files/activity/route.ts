import { type NextRequest, NextResponse } from 'next/server'

import { verifyMcpAuthorization } from '@/lib/mcp/auth'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { withDbClient } from '@/lib/db'
import { assertLessonUnitIsInactive } from '@/lib/mcp/guards'

const BUCKET = 'lessons'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export async function POST(request: NextRequest): Promise<Response> {
  const auth = verifyMcpAuthorization(request)
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.reason ?? 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid multipart form data' }, { status: 400 })
  }

  const lessonId = formData.get('lesson_id')
  const activityId = formData.get('activity_id')
  const file = formData.get('file')

  if (typeof lessonId !== 'string' || lessonId.trim() === '') {
    return NextResponse.json({ success: false, error: 'Missing lesson_id' }, { status: 400 })
  }
  if (typeof activityId !== 'string' || activityId.trim() === '') {
    return NextResponse.json({ success: false, error: 'Missing activity_id' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'Missing file field' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: 'File exceeds 5 MB limit' }, { status: 413 })
  }

  // Validate activity exists, is file-download type, and unit is inactive
  try {
    await withDbClient(async (client) => {
      const { rows } = await client.query<{ activity_id: string; type: string }>(
        'select activity_id, type from activities where activity_id = $1 and lesson_id = $2 limit 1',
        [activityId, lessonId],
      )
      const activity = rows[0]
      if (!activity) throw new Error(`Activity ${activityId} not found in lesson ${lessonId}`)
      if (activity.type !== 'file-download') {
        throw new Error(`Activity ${activityId} is type "${activity.type}" — only file-download activities accept file uploads`)
      }
      await assertLessonUnitIsInactive(client, lessonId)
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed'
    return NextResponse.json({ success: false, error: message }, { status: 422 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fullPath = `lessons/${lessonId}/activities/${activityId}/${file.name}`
  const storage = createLocalStorageClient(BUCKET)
  const { error } = await storage.upload(fullPath, buffer, {
    contentType: file.type || 'application/octet-stream',
    originalPath: file.name,
    uploadedBy: 'mcp',
  })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const urlParts = [BUCKET, lessonId, 'activities', activityId, file.name].map(encodeURIComponent).join('/')
  return NextResponse.json({
    success: true,
    file: {
      activity_id: activityId,
      lesson_id: lessonId,
      file_name: file.name,
      size_bytes: buffer.byteLength,
      url: `/api/files/${urlParts}`,
    },
  })
}
