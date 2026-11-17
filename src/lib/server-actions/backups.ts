'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'

import { requireRole } from '@/lib/auth'
import {
  BackupAlreadyRequestedError,
  createBackupRequest,
  readBackupRequests,
  type BackupRequest,
} from '@/lib/backups/store'
import { withTelemetry } from '@/lib/telemetry'

// "Back up now" on /admin/backups. Admin only. The request is carried out by
// scripts/backup-on-request.sh on the prod host (the app cannot run Docker or
// reach the dev server itself).

type Result<T> = { data: T | null; error: string | null }

const ROUTE_TAG = '/admin/backups'

export async function readBackupRequestsAction(): Promise<Result<BackupRequest[]>> {
  return withTelemetry({ routeTag: ROUTE_TAG, functionName: 'readBackupRequestsAction' }, async () => {
    try {
      await requireRole('admin')
      return { data: await readBackupRequests(10), error: null }
    } catch (error) {
      unstable_rethrow(error)
      console.error('[backups] read failed', error)
      return { data: null, error: 'Could not load the backups.' }
    }
  })
}

export async function requestBackupAction(): Promise<Result<BackupRequest[]>> {
  return withTelemetry({ routeTag: ROUTE_TAG, functionName: 'requestBackupAction' }, async () => {
    try {
      const profile = await requireRole('admin')
      await createBackupRequest(profile.userId)
      revalidatePath('/admin/backups')
      return { data: await readBackupRequests(10), error: null }
    } catch (error) {
      unstable_rethrow(error)
      if (error instanceof BackupAlreadyRequestedError) return { data: null, error: error.message }
      console.error('[backups] request failed', error)
      return { data: null, error: 'Could not request the backup.' }
    }
  })
}
