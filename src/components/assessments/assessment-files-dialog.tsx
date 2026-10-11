'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Trash2, Upload, Wand2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { pupilName } from '@/components/assessments/format'
import { cn } from '@/lib/utils'
import {
  linkAssessmentFileAction,
  listAssessmentFilesAction,
  matchAssessmentFilesAction,
  removeAssessmentFileAction,
} from '@/lib/server-updates'
import type { AssessmentFile, AssessmentPupilListItem } from '@/types'

const NOT_LINKED = '__none'

const MAX_BYTES = 25 * 1024 * 1024

type Props = {
  assessmentId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Surname first, as on the results grid, so the picker reads in roster order.
function listName(pupil: AssessmentPupilListItem): string {
  return [pupil.last_name, pupil.first_name].filter(Boolean).join(', ') || pupilName(pupil)
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Scans of pupils' marked papers (and any other PDF or image) stored against a
 * paper. Files go up one per request so each stays inside the 25 MB limit and
 * one failure does not cost the rest. A file linked to a pupil is theirs to
 * open once feedback is released; uploads named after a pupil link themselves.
 */
export function AssessmentFilesDialog({ assessmentId, title, open, onOpenChange }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<AssessmentFile[] | null>(null)
  const [pupils, setPupils] = useState<AssessmentPupilListItem[]>([])
  const [linking, setLinking] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await listAssessmentFilesAction(assessmentId)
    if (error || !data) {
      toast.error(error ?? 'Could not load the files')
      setFiles([])
      return
    }
    setFiles(data.files)
    setPupils(data.pupils)
  }, [assessmentId])

  useEffect(() => {
    if (open) {
      setFiles(null)
      setConfirmingDelete(null)
      void load()
    }
  }, [open, load])

  const uploading = progress !== null

  const upload = async (selected: File[]) => {
    if (selected.length === 0 || uploading) return
    const tooBig = selected.filter((file) => file.size > MAX_BYTES)
    const toSend = selected.filter((file) => file.size <= MAX_BYTES)
    tooBig.forEach((file) => toast.error(`${file.name} is larger than 25 MB`))
    if (toSend.length === 0) return

    let stored = 0
    setProgress({ done: 0, total: toSend.length })
    for (const [index, file] of toSend.entries()) {
      const body = new FormData()
      body.append('file', file)
      try {
        const response = await fetch(`/api/assessments/${encodeURIComponent(assessmentId)}/files`, { method: 'POST', body })
        const result = (await response.json().catch(() => null)) as { files?: AssessmentFile[]; errors?: string[]; error?: string } | null
        if (result?.files?.length) stored += result.files.length
        const message = result?.errors?.[0] ?? (response.ok ? null : result?.error ?? `${file.name}: upload failed (${response.status})`)
        if (message) toast.error(message)
      } catch {
        toast.error(`${file.name}: upload failed`)
      }
      setProgress({ done: index + 1, total: toSend.length })
    }
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
    if (stored > 0) {
      toast.success(stored === 1 ? 'Uploaded 1 file' : `Uploaded ${stored} files`)
      router.refresh()
    }
    await load()
  }

  const link = async (fileName: string, value: string) => {
    const pupilId = value === NOT_LINKED ? null : value
    setLinking(fileName)
    const { data, error } = await linkAssessmentFileAction(assessmentId, fileName, pupilId)
    setLinking(null)
    if (error || !data) {
      toast.error(error ?? 'Could not link the file')
      return
    }
    setFiles((current) => current?.map((file) => (file.file_name === fileName ? data : file)) ?? null)
    router.refresh()
  }

  const matchByName = async () => {
    setMatching(true)
    const { data, error } = await matchAssessmentFilesAction(assessmentId)
    setMatching(false)
    if (error || !data) {
      toast.error(error ?? 'Could not match the files')
      return
    }
    if (data.matched > 0) toast.success(data.matched === 1 ? 'Linked 1 file' : `Linked ${data.matched} files`)
    if (data.unmatched.length > 0) {
      toast.warning(`No single pupil matched: ${data.unmatched.join(', ')}`)
    } else if (data.matched === 0) {
      toast.info('Every file is already linked')
    }
    router.refresh()
    await load()
  }

  const unlinkedCount = files?.filter((file) => !file.pupil_id).length ?? 0
  const busy = uploading || matching || linking !== null || deleting !== null

  const remove = async (fileName: string) => {
    setDeleting(fileName)
    const { success, error } = await removeAssessmentFileAction(assessmentId, fileName)
    setDeleting(null)
    setConfirmingDelete(null)
    if (!success) {
      toast.error(error ?? 'Could not delete the file')
      return
    }
    toast.success(`Deleted ${fileName}`)
    setFiles((current) => current?.filter((file) => file.file_name !== fileName) ?? null)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !uploading && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scans &amp; files</DialogTitle>
          <DialogDescription>
            Pupils&apos; scripts and whole-paper files (question paper, mark scheme) for {title}: PDFs and images up to
            25 MB each. A pupil can open a script linked to them once feedback is released; whole-paper files stay with
            teachers. Uploads named &ldquo;Surname Firstname …&rdquo; link to that pupil automatically.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void upload(Array.from(event.dataTransfer.files))
          }}
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-sm text-muted-foreground transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
            uploading && 'cursor-wait opacity-70',
          )}
        >
          {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          {uploading
            ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : 'Drop scans here or click to choose files'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(event) => void upload(Array.from(event.target.files ?? []))}
        />

        {files && files.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {files.length - unlinkedCount} of {files.length} linked to a pupil
            </span>
            {unlinkedCount > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void matchByName()}>
                {matching ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                Match by name
              </Button>
            )}
          </div>
        )}

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {files === null ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading files…
            </p>
          ) : files.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No files uploaded yet.</p>
          ) : (
            files.map((file) => (
              <div key={file.file_name} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={file.path}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
                  title={file.file_name}
                >
                  {file.file_name}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size_bytes)}</span>
                <Select
                  value={file.pupil_id ?? NOT_LINKED}
                  disabled={busy}
                  onValueChange={(value) => void link(file.file_name, value)}
                >
                  <SelectTrigger
                    size="sm"
                    className={cn('h-7 w-44 shrink-0', !file.pupil_id && 'text-muted-foreground')}
                    aria-label={`Pupil for ${file.file_name}`}
                  >
                    {linking === file.file_name ? <Loader2 className="size-3 animate-spin" /> : <SelectValue />}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_LINKED}>Whole paper (teachers only)</SelectItem>
                    {pupils.map((pupil) => (
                      <SelectItem key={pupil.pupil_id} value={pupil.pupil_id}>
                        {listName(pupil)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {confirmingDelete === file.file_name ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7"
                    disabled={deleting !== null}
                    onClick={() => void remove(file.file_name)}
                  >
                    {deleting === file.file_name ? 'Deleting…' : 'Delete?'}
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={deleting !== null || uploading}
                    aria-label={`Delete ${file.file_name}`}
                    onClick={() => setConfirmingDelete(file.file_name)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
