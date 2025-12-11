export const dynamic = "force-dynamic"

import { QueueList } from "@/components/queue/queue-list"
import { readQueueAllItemsAction } from "@/lib/server-updates"

export default async function QueuePage() {
  const itemsResult = await readQueueAllItemsAction()
  const queueItems = itemsResult.data ?? []
  const queueError = itemsResult.error
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">File Upload Queue</h1>
        <p className="text-sm text-muted-foreground">All uploaded files across activities.</p>
      </div>

      {queueError ? <p className="text-sm text-destructive">{queueError}</p> : null}

      <QueueList items={queueItems} />
    </div>
  )
}
