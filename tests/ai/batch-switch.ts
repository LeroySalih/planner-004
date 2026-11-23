import { query } from '@/lib/db'
import { BATCH_ROUTE_KEYS, invalidateModelRouteCache } from '@/lib/ai/model-routing'

// Shared by the checks that drive the marking worker or the markers with a
// stubbed model call. The Message Batches switch (ai_model_routes.use_batch,
// migration 152) is on by default, and a job on a batch route is parked for a
// batch instead of calling the stub. These checks test the direct call, so
// they turn the switch off on the dev route rows for the run and put back the
// exact values afterwards.
//
// Call turnBatchSwitchOff() before the check reads any route row it restores,
// and restoreBatchSwitch() last, after the check's own route restores, also on
// failure. Calling turnBatchSwitchOff() again (after a check inserts a route
// row) turns off the new rows too; only the values seen on the first call are
// restored.

let saved: Array<{ route_id: string; use_batch: boolean }> | null = null

export async function turnBatchSwitchOff(): Promise<void> {
  if (!saved) {
    const { rows } = await query<{ route_id: string; use_batch: boolean }>(
      'select route_id::text, use_batch from ai_model_routes where activity_type = any($1::text[])',
      [BATCH_ROUTE_KEYS],
    )
    saved = rows
  }
  await query('update ai_model_routes set use_batch = false where activity_type = any($1::text[]) and use_batch', [BATCH_ROUTE_KEYS])
  invalidateModelRouteCache()
}

export async function restoreBatchSwitch(): Promise<void> {
  if (!saved) return
  for (const row of saved) {
    await query('update ai_model_routes set use_batch = $2 where route_id = $1::uuid', [row.route_id, row.use_batch])
  }
  saved = null
  invalidateModelRouteCache()
}
