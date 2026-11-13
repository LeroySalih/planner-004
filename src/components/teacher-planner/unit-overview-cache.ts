import { readPlannerUnitOverviewAction } from '@/lib/server-updates'

export type PlannerUnitOverviewResult = Awaited<ReturnType<typeof readPlannerUnitOverviewAction>>
export type PlannerUnitOverviewData = NonNullable<PlannerUnitOverviewResult['data']>

// One request per class + unit, shared by every cell showing that pair. A
// failed load is dropped so the next open retries.
const overviewCache = new Map<string, Promise<PlannerUnitOverviewResult>>()

export function loadPlannerUnitOverview(groupId: string, unitId: string): Promise<PlannerUnitOverviewResult> {
  const key = `${groupId}:${unitId}`
  let pending = overviewCache.get(key)
  if (!pending) {
    pending = readPlannerUnitOverviewAction({ unitId, groupId })
      .catch((error: unknown) => ({
        data: null,
        error: error instanceof Error ? error.message : 'Failed to load the unit',
      }))
      .then((result) => {
        if (result.error) overviewCache.delete(key)
        return result
      })
    overviewCache.set(key, pending)
  }
  return pending
}

/**
 * Forget a class's overviews after its plan changes, so the dates are
 * re-read on the next open. Every unit goes: a swap can cross units.
 */
export function invalidatePlannerUnitOverview(groupId: string) {
  for (const key of [...overviewCache.keys()]) {
    if (key.startsWith(`${groupId}:`)) overviewCache.delete(key)
  }
}
