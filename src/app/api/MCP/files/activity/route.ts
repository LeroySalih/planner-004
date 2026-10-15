import { type NextRequest, NextResponse } from 'next/server'

import { verifyMcpAuthorization } from '@/lib/mcp/auth'
import { recordMcpCall } from '@/lib/mcp/audit'
import { uploadActivityFile } from '@/lib/mcp/activities'

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
    tool: 'file_upload:activity',
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
  const activityId = formData.get('activity_id')
  const file = formData.get('file')
  args.lesson_id = lessonId
  args.activity_id = activityId
  if (file instanceof File) Object.assign(args, { file_name: file.name, size_bytes: file.size, content_type: file.type })

  if (typeof lessonId !== 'string' || lessonId.trim() === '') {
    return { status: 400, body: { success: false, error: 'Missing lesson_id' } }
  }
  if (typeof activityId !== 'string' || activityId.trim() === '') {
    return { status: 400, body: { success: false, error: 'Missing activity_id' } }
  }
  if (!(file instanceof File)) {
    return { status: 400, body: { success: false, error: 'Missing file field' } }
  }
  if (file.size > MAX_BYTES) {
    return { status: 413, body: { success: false, error: 'File exceeds 5 MB limit' } }
  }

  // Same path as the upload tools: type checks, storage and body_data.
  try {
    const uploaded = await uploadActivityFile(lessonId, activityId, file.name, Buffer.from(await file.arrayBuffer()), file.type || null)
    return { status: 200, body: { success: true, file: uploaded } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return { status: message.startsWith('Storage upload failed') ? 500 : 422, body: { success: false, error: message } }
  }
}
