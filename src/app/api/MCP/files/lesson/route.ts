import { type NextRequest, NextResponse } from 'next/server'

import { verifyMcpAuthorization } from '@/lib/mcp/auth'
import { recordMcpCall } from '@/lib/mcp/audit'
import { createLocalStorageClient } from '@/lib/storage/local-storage'
import { withDbClient } from '@/lib/db'
import { assertLessonExists } from '@/lib/mcp/guards'

const BUCKET = 'lessons'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

type UploadOutcome = { status: number; body: { success: boolean; error?: string; [key: string]: unknown } }

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await verifyMcpAuthorization(request)
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.reason }, { status: 401 })
  }

  const started = performance.now()
  const args: Record<string, unknown> = {}
  const { status, body } = await upload(request, args)
  await recordMcpCall(auth, {
    tool: 'file_upload:lesson',
    args,
    error: body.success ? null : (body.error ?? `HTTP ${status}`),
    durationMs: performance.now() - started,
  })
  return NextResponse.json(body, { status })
}

async function upload(request: NextRequest, args: Record<string, unknown>): Promise<UploadOutcome> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return { status: 400, body: { success: false, error: 'Invalid multipart form data' } }
  }

  const lessonId = formData.get('lesson_id')
  const file = formData.get('file')
  args.lesson_id = lessonId
  if (file instanceof File) Object.assign(args, { file_name: file.name, size_bytes: file.size, content_type: file.type })

  if (typeof lessonId !== 'string' || lessonId.trim() === '') {
    return { status: 400, body: { success: false, error: 'Missing lesson_id' } }
  }
  if (!(file instanceof File)) {
    return { status: 400, body: { success: false, error: 'Missing file field' } }
  }
  if (file.size > MAX_BYTES) {
    return { status: 413, body: { success: false, error: 'File exceeds 5 MB limit' } }
  }

  try {
    await withDbClient((client) => assertLessonExists(client, lessonId))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed'
    return { status: 422, body: { success: false, error: message } }
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
    return { status: 500, body: { success: false, error: error.message } }
  }

  const urlParts = [BUCKET, lessonId, file.name].map(encodeURIComponent).join('/')
  return {
    status: 200,
    body: {
      success: true,
      file: {
        lesson_id: lessonId,
        file_name: file.name,
        size_bytes: buffer.byteLength,
        url: `/api/files/${urlParts}`,
      },
    },
  }
}
