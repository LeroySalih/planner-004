import { BackupRequestsPanel } from '@/components/admin/BackupRequestsPanel'
import { readBackupRequestsAction } from '@/lib/server-updates'

// "Back up now": the request is carried out on the prod host by
// scripts/backup-on-request.sh (cron, every minute). The admin layout and the
// actions check the admin role.
export default async function BackupsPage() {
  const { data, error } = await readBackupRequestsAction()

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Backups</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Takes a backup of the dino and n8n databases now, encrypts it, and sends it to the dev server, where it
          lands in <code>~/prod-mirror/backups</code> next to the nightly backups and is kept for 7 days. It
          usually takes a few minutes: the server picks the request up within a minute, then dumps and sends the
          files. Uploaded files are not included; they are copied to the dev server every hour.
        </p>
      </div>
      {error || !data ? (
        <p className="text-sm text-destructive">{error ?? 'Could not load the backups.'}</p>
      ) : (
        <BackupRequestsPanel initial={data} />
      )}
    </div>
  )
}
