import { type NextRequest, NextResponse } from 'next/server'

import { recordMcpCall } from '@/lib/mcp/audit'
import { MCP_UPLOAD_MAX_BYTES, cleanFileName } from '@/lib/mcp/file-input'
import { uploadActivityFile } from '@/lib/mcp/activities'
import { uploadLessonFile } from '@/lib/mcp/lessons'
import { ASSESSMENT_UPLOAD_MAX_BYTES, storeAssessmentFile } from '@/lib/assessments/store'
import { claimUploadLink, releaseUploadLink } from '@/lib/mcp/upload-links'

// The token in the path is the whole credential: a one-time link from
// create_activity_file_upload_link / create_lesson_file_upload_link /
// create_assessment_paper_file_upload_link. There is
// deliberately no Authorization header, because the code sandbox Claude
// uploads from has no copy of the connector's credentials.

type Params = { params: Promise<{ token: string }> }

// DINO serves uploads inline from its own origin, where these could run script.
const UNSAFE_TYPES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml'])
const UNSAFE_EXTENSIONS = /\.(html?|xhtml|svg)$/i

const limitLabel = (maxBytes: number) => `${maxBytes / (1024 * 1024)} MB`

async function readFile(request: NextRequest, maxBytes: number): Promise<{ buffer: Buffer; name: string | null; type: string | null }> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes + 64 * 1024) {
    throw new UploadError(413, `File exceeds the ${limitLabel(maxBytes)} limit (${declared} bytes)`)
  }
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? null
  if (contentType === 'multipart/form-data') {
    const file = (await request.formData()).get('file')
    if (!(file instanceof File)) throw new UploadError(400, 'Send the file in a form field named "file"')
    return { buffer: Buffer.from(await file.arrayBuffer()), name: file.name || null, type: file.type || null }
  }
  return {
    buffer: Buffer.from(await request.arrayBuffer()),
    name: request.nextUrl.searchParams.get('file_name'),
    type: contentType === 'application/octet-stream' ? null : contentType,
  }
}

class UploadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function handle(request: NextRequest, { params }: Params): Promise<Response> {
  const { token } = await params
  const link = await claimUploadLink(token)
  if (!link) {
    return NextResponse.json(
      { success: false, error: 'This upload link is invalid, expired or already used. Ask DINO for a new one.' },
      { status: 401 },
    )
  }

  const started = performance.now()
  const args: Record<string, unknown> = {
    link_id: link.link_id,
    target: link.target,
    lesson_id: link.lesson_id,
    activity_id: link.activity_id,
    assessment_id: link.assessment_id,
  }
  const maxBytes = link.assessment_id ? ASSESSMENT_UPLOAD_MAX_BYTES : MCP_UPLOAD_MAX_BYTES
  try {
    const { buffer, name, type } = await readFile(request, maxBytes)
    if (buffer.byteLength === 0) throw new UploadError(400, 'The upload was empty')
    if (buffer.byteLength > maxBytes) {
      throw new UploadError(413, `File exceeds the ${limitLabel(maxBytes)} limit (${buffer.byteLength} bytes)`)
    }
    const fileName = cleanFileName(link.file_name || name || 'upload')
    Object.assign(args, { file_name: fileName, size_bytes: buffer.byteLength, content_type: type })
    if (UNSAFE_EXTENSIONS.test(fileName) || (type && UNSAFE_TYPES.has(type))) {
      throw new UploadError(415, 'HTML and SVG files cannot be uploaded. Convert the image to PNG first.')
    }

    const file = link.assessment_id
      ? await storeAssessmentFile(link.assessment_id, fileName, buffer, type, link.caller.userId)
      : link.activity_id
        ? await uploadActivityFile(link.lesson_id!, link.activity_id, fileName, buffer, type)
        : await uploadLessonFile(link.lesson_id!, fileName, buffer, type)

    await recordMcpCall(link.caller, { tool: 'file_upload:link', args, error: null, durationMs: performance.now() - started })
    return NextResponse.json({ success: true, file })
  } catch (error) {
    await releaseUploadLink(link.link_id)
    const message = error instanceof Error ? error.message : 'Upload failed'
    await recordMcpCall(link.caller, { tool: 'file_upload:link', args, error: message, durationMs: performance.now() - started })
    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof UploadError ? error.status : 500 },
    )
  }
}

export const POST = handle
export const PUT = handle
