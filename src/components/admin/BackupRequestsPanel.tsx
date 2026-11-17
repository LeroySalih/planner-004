'use client'

import { useEffect, useState, useTransition } from 'react'
import { HardDriveDownload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { readBackupRequestsAction, requestBackupAction, type BackupRequest } from '@/lib/server-updates'

const POLL_MS = 5000

const pad = (value: number) => String(value).padStart(2, '0')

/** DD-MM-YYYY HH:mm, in the viewer's time. */
function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(request: BackupRequest) {
  if (!request.startedAt || !request.finishedAt) return '—'
  const seconds = Math.max(0, Math.round((Date.parse(request.finishedAt) - Date.parse(request.startedAt)) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`
}

const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const isOpen = (request: BackupRequest) => request.status === 'pending' || request.status === 'running'

function StatusBadge({ request }: { request: BackupRequest }) {
  switch (request.status) {
    case 'pending':
      return <Badge variant="outline">Waiting</Badge>
    case 'running':
      return (
        <Badge variant="secondary">
          <Loader2 className="animate-spin" />
          Running
        </Badge>
      )
    case 'done':
      return <Badge className="bg-emerald-600 text-white">Done</Badge>
    case 'error':
      return <Badge variant="destructive">Failed</Badge>
  }
}

export function BackupRequestsPanel({ initial }: { initial: BackupRequest[] }) {
  const [requests, setRequests] = useState(initial)
  const [pending, startTransition] = useTransition()
  const open = requests.some(isOpen)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setInterval(async () => {
      const result = await readBackupRequestsAction()
      if (cancelled || !result.data) return
      const finished = result.data.find(
        (request) => !isOpen(request) && requests.some((before) => before.requestId === request.requestId && isOpen(before)),
      )
      setRequests(result.data)
      if (finished?.status === 'done') toast.success('Backup sent to the dev server')
      if (finished?.status === 'error') toast.error('The backup failed. See the list for why.')
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [open, requests])

  const backUpNow = () =>
    startTransition(async () => {
      const result = await requestBackupAction()
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Could not request the backup.')
        const refreshed = await readBackupRequestsAction()
        if (refreshed.data) setRequests(refreshed.data)
        return
      }
      setRequests(result.data)
      toast.success('Backup requested. It usually takes a few minutes.')
    })

  return (
    <div className="space-y-4">
      <Button onClick={backUpNow} disabled={pending || open}>
        {pending ? <Loader2 className="animate-spin" /> : <HardDriveDownload />}
        {open ? 'Backup in progress…' : 'Back up now and send to dev server'}
      </Button>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-[var(--color-text-secondary)]">
              <th className="px-3 py-2">Requested</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Took</th>
              <th className="px-3 py-2">Files</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-[var(--color-text-secondary)]">
                  No backups requested yet.
                </td>
              </tr>
            ) : (
              requests.map((request) => (
                <tr key={request.requestId} className="border-b align-top last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2" suppressHydrationWarning>
                    {formatDateTime(request.requestedAt)}
                  </td>
                  <td className="px-3 py-2">{request.requestedByName}</td>
                  <td className="px-3 py-2">
                    <StatusBadge request={request} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDuration(request)}</td>
                  <td className="px-3 py-2">
                    {request.files.length > 0 ? (
                      <ul className="space-y-0.5">
                        {request.files.map((file) => (
                          <li key={file.name} className="break-all">
                            <span className="font-mono text-xs">{file.name}</span>{' '}
                            <span className="whitespace-nowrap text-[var(--color-text-secondary)]">
                              {formatMb(file.bytes)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {request.error ? <p className="break-words text-destructive">{request.error}</p> : null}
                    {request.stale ? (
                      <p className="text-destructive">
                        Not picked up yet. Is the backup-on-request cron job installed on the server?
                      </p>
                    ) : null}
                    {request.files.length === 0 && !request.error && !request.stale ? '—' : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
