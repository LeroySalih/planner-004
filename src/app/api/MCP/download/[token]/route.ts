import { NextResponse } from 'next/server'

import { recordMcpCall } from '@/lib/mcp/audit'
import { claimDownloadLink, lessonFileStoragePath, releaseDownloadLink } from '@/lib/mcp/download-links'
import { createLocalStorageClient } from '@/lib/storage/local-storage'

// The token in the path is the whole credential: a one-time link from
// get_lesson_file_download_link. There is deliberately no Authorization
// header, because the code sandbox Claude downloads into has no copy of the
// connector's credentials.

type Params = { params: Promise<{ token: string }> }

// Always an attachment of opaque bytes, so nothing a teacher uploaded can
// render or run on DINO's origin when the link is opened in a browser.
function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { token } = await params
  const link = await claimDownloadLink(token)
  if (!link) {
    return NextResponse.json(
      { success: false, error: 'This download link is invalid, expired or already used. Ask DINO for a new one.' },
      { status: 401 },
    )
  }

  const started = performance.now()
  const args = { link_id: link.link_id, lesson_id: link.lesson_id, activity_id: link.activity_id, file_name: link.file_name }
  const { stream, error } = await createLocalStorageClient('lessons').getFileStream(
    lessonFileStoragePath(link.lesson_id, link.activity_id, link.file_name),
  )

  if (!stream || error) {
    await releaseDownloadLink(link.link_id)
    const message = error?.message ?? 'File not found'
    await recordMcpCall(link.caller, { tool: 'file_download:link', args, error: message, durationMs: performance.now() - started })
    return NextResponse.json({ success: false, error: message }, { status: 404 })
  }

  await recordMcpCall(link.caller, { tool: 'file_download:link', args, error: null, durationMs: performance.now() - started })

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': contentDisposition(link.file_name),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  })
  return new Response(stream as unknown as ReadableStream, { headers })
}
