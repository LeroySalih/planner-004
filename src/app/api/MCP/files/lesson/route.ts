import { type NextRequest, NextResponse } from 'next/server'

import { verifyMcpAuthorization } from '@/lib/mcp/auth'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { query } from '@/lib/db'
import { assertLessonUnitIsInactive } from '@/lib/mcp/guards'
import { withDbClient } from '@/lib/db'

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
  const file = formData.get('file')

  if (typeof lessonId !== 'string' || lessonId.trim() === '') {
    return NextResponse.json({ success: false, error: 'Missing lesson_id' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'Missing file field' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: 'File exceeds 5 MB limit' }, { status: 413 })
  }

  // Validate lesson exists and unit is inactive
  try {
    await withDbClient(async (client) => {
      const { rows } = await client.query<{ lesson_id: string }>(
        'select lesson_id from lessons where lesson_id = $1 limit 1',
        [lessonId],
      )
      if (!rows[0]) throw new Error(`Lesson ${lessonId} not found`)
      await assertLessonUnitIsInactive(client, lessonId)
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed'
    return NextResponse.json({ success: false, error: message }, { status: 422 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fullPath = `${lessonId}/${file.name}`
  const storage = createLocalStorageClient(BUCKET)
  const { error } = await storage.upload(fullPath, buffer, {
    contentType: file.type || 'application/octet-stream',
    originalPath: fullPath,
    uploadedBy: 'mcp',
  })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const urlParts = [BUCKET, lessonId, file.name].map(encodeURIComponent).join('/')
  return NextResponse.json({
    success: true,
    file: {
      lesson_id: lessonId,
      file_name: file.name,
      size_bytes: buffer.byteLength,
      url: `/api/files/${urlParts}`,
    },
  })
}
