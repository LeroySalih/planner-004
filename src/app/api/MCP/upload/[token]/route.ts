import { type NextRequest, NextResponse } from 'next/server'

import { query } from '@/lib/db'
import { recordMcpCall } from '@/lib/mcp/audit'
import { cleanFileName } from '@/lib/mcp/file-input'
import { uploadActivityFile } from '@/lib/mcp/activities'
import { uploadLessonFile } from '@/lib/mcp/lessons'
import { storeAssessmentFile } from '@/lib/assessments/store'
import {
  PUPIL_UPLOAD_KINDS,
  claimUploadLink,
  isPracticalActivityFileKind,
  releaseUploadLink,
  uploadLinkMaxBytes,
  type UploadLink,
} from '@/lib/mcp/upload-links'
import { storePaperFile, storeScript } from '@/lib/assessment-paper/files'
import { describeActivityRemark, remarkAssessmentActivity, resolveQuestions } from '@/lib/assessment-paper/remark-activity'
import { PracticalFileRefusal, storePracticalFile, storeSuppliedImage } from '@/lib/powerpoint-assessment/files'
import { storePracticalActivityFile } from '@/lib/practical-assessment/activity-files'

// The token in the path is the whole credential: a one-time link from
// create_activity_file_upload_link / create_lesson_file_upload_link /
// create_assessment_paper_file_upload_link /
// create_assessment_activity_file_upload_link. There is
// deliberately no Authorization header, because the code sandbox Claude
// uploads from has no copy of the connector's credentials.

type Params = { params: Promise<{ token: string }> }

// DINO serves uploads inline from its own origin, where these could run script.
const UNSAFE_TYPES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml'])
const UNSAFE_EXTENSIONS = /\.(html?|xhtml|svg)$/i
const WEBPAGE_EXTENSIONS = /\.html?$/i
const WEBPAGE_TYPES = new Set(['text/html', 'text/plain', 'application/octet-stream'])

async function isWebpageActivity(activityId: string): Promise<boolean> {
  const { rows } = await query<{ type: string }>('select type from activities where activity_id = $1 limit 1', [activityId])
  return rows[0]?.type === 'display-webpage'
}

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

/**
 * An assessment-paper activity's question paper, mark scheme or one pupil's
 * script; or a PowerPoint assessment's supplied image or one pupil's file in
 * a slot (stored as a teacher's upload: allowed after hand-in, which it does
 * not do itself); or a practical assessment's evidence template, starting
 * database or reference file (activity files). A pupil's file with
 * remark_questions is stored without its own re-mark (the caller re-marks
 * those questions), and with remark false is stored and cleared, not sent.
 */
async function storeAssessmentActivityFile(link: UploadLink, buffer: Buffer, fileName: string) {
  const activityId = link.activity_id!
  try {
    if (link.upload_kind === 'script') {
      return await storeScript({
        activityId,
        pupilId: link.pupil_id!,
        bytes: buffer,
        uploadedBy: link.caller.userId,
        send: link.remark !== false,
      })
    }
    if (isPracticalActivityFileKind(link.upload_kind)) {
      return await storePracticalActivityFile({
        activityId,
        kind: link.upload_kind,
        fileName: link.file_name ?? fileName,
        bytes: buffer,
        uploadedBy: link.caller.userId,
      })
    }
    if (link.upload_kind === 'question_paper' || link.upload_kind === 'mark_scheme') {
      return await storePaperFile(activityId, link.upload_kind, buffer, link.caller.userId)
    }
    if (link.upload_kind === 'supplied_image') {
      const { image, replaced, warnings } = await storeSuppliedImage({
        activityId,
        fileName,
        name: link.file_name ?? undefined,
        bytes: buffer,
        uploadedBy: link.caller.userId,
      })
      return {
        name: image.name,
        file_name: image.file_name,
        width: image.width,
        height: image.height,
        replaced,
        warnings,
      }
    }
    if (link.upload_kind === 'practical_file') {
      const stored = await storePracticalFile({
        activityId,
        pupilId: link.pupil_id!,
        slotKey: link.slot_key!,
        bytes: buffer,
        originalName: fileName,
        uploadedBy: link.caller.userId,
        byTeacher: true,
        afterChange: link.remark_questions ? 'keep' : link.remark === false ? 'clear' : 'resend',
      })
      return {
        file_id: stored.file_id,
        submission_id: stored.submission_id,
        slot_key: stored.slot_key,
        file_name: stored.original_name,
        bytes: stored.bytes,
        replaced_file_id: stored.replaced_file_id,
        requeued: stored.requeued,
        cleared: stored.cleared,
      }
    }
  } catch (error) {
    // A refusal is about the file, not the server.
    if (error instanceof PracticalFileRefusal) throw new UploadError(422, error.message)
    throw error
  }
  throw new UploadError(400, 'This upload link does not say what the file is')
}

/**
 * The link's re-mark, after the file is stored: whole-activity kinds with
 * remark true (every pupil), a pupil's file with remark_questions (that pupil,
 * those questions). Anything else was settled by the store. A failure is
 * reported, never thrown: the file is stored.
 */
async function runLinkRemark(link: UploadLink): Promise<{ remark?: Record<string, unknown>; remark_error?: string }> {
  const pupilKind = link.upload_kind !== null && PUPIL_UPLOAD_KINDS.includes(link.upload_kind)
  const wanted = pupilKind ? link.remark_questions !== null : link.remark === true
  if (!wanted) return {}
  try {
    const result = await remarkAssessmentActivity({
      activityId: link.activity_id!,
      pupilIds: pupilKind ? [link.pupil_id!] : null,
      questions: link.remark_questions,
    })
    return { remark: { ...result, message: describeActivityRemark(result) } }
  } catch (error) {
    console.error('[mcp-upload] re-mark after upload failed', { linkId: link.link_id, error })
    return { remark_error: error instanceof Error ? error.message : String(error) }
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
    upload_kind: link.upload_kind,
    pupil_id: link.pupil_id,
    slot_key: link.slot_key,
    remark: link.remark,
    remark_questions: link.remark_questions,
  }
  const maxBytes = uploadLinkMaxBytes(link)
  try {
    const { buffer, name, type } = await readFile(request, maxBytes)
    if (buffer.byteLength === 0) throw new UploadError(400, 'The upload was empty')
    if (buffer.byteLength > maxBytes) {
      throw new UploadError(413, `File exceeds the ${limitLabel(maxBytes)} limit (${buffer.byteLength} bytes)`)
    }
    // A supplied image's link holds the image's name, not its file's.
    const fileName = cleanFileName(
      (link.upload_kind === 'supplied_image' ? name || link.file_name : link.file_name || name) || 'upload',
    )
    // A pupil's own file name stays out of the audit log: its type is enough.
    Object.assign(
      args,
      link.upload_kind === 'practical_file'
        ? { file_ext: fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? null }
        : { file_name: fileName },
      { size_bytes: buffer.byteLength, content_type: type },
    )
    // A display-webpage's page is the exception: it is only ever opened
    // through the sandboxed /api/activity-webpage route.
    const htmlAllowed = link.activity_id !== null && (await isWebpageActivity(link.activity_id))
    const isHtml = WEBPAGE_EXTENSIONS.test(fileName) && (!type || WEBPAGE_TYPES.has(type))
    if (!(htmlAllowed && isHtml) && (UNSAFE_EXTENSIONS.test(fileName) || (type && UNSAFE_TYPES.has(type)))) {
      throw new UploadError(415, 'HTML and SVG files cannot be uploaded, except an .html page to a display-webpage activity. Convert an image to PNG first.')
    }

    // A pupil's file re-marked on named questions is stored without its own
    // re-mark, so labels that no longer resolve refuse the upload first.
    if (link.target === 'assessment-activity' && link.remark_questions && link.pupil_id) {
      try {
        await resolveQuestions(link.activity_id!, link.remark_questions)
      } catch (error) {
        throw new UploadError(409, `${error instanceof Error ? error.message : String(error)} Nothing was stored: ask for a new link.`)
      }
    }

    const file = link.target === 'assessment-activity'
      ? await storeAssessmentActivityFile(link, buffer, fileName)
      : link.assessment_id
      ? await storeAssessmentFile(link.assessment_id, fileName, buffer, { contentType: type, uploadedBy: link.caller.userId, pupilId: link.pupil_id })
      : link.activity_id
        ? await uploadActivityFile(link.lesson_id!, link.activity_id, fileName, buffer, type)
        : await uploadLessonFile(link.lesson_id!, fileName, buffer, type)

    const remarked = link.target === 'assessment-activity' ? await runLinkRemark(link) : {}
    if (remarked.remark) args.remark_queued = remarked.remark.queued
    if (remarked.remark_error) args.remark_error = remarked.remark_error
    await recordMcpCall(link.caller, { tool: 'file_upload:link', args, error: null, durationMs: performance.now() - started })
    return NextResponse.json({ success: true, file, ...remarked })
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
