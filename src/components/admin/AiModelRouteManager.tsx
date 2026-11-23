'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { deleteAiModelRouteAction, setAiModelRouteBatchAction, upsertAiModelRouteAction } from '@/lib/server-updates'
import { AI_EFFORT_LEVELS, type AiEffort, type AiModelRoute, type AiProvider } from '@/types'

/** Mirrors CatalogueEntry in model-routing.ts, minus the server-only import. */
export type CatalogueOption = {
  provider: AiProvider
  model: string
  label: string
  kind: 'text' | 'image'
  visionTier: 'high' | 'standard'
  inputPerMTok: number
  outputPerMTok: number
  note: string
  /** False while the app has no transport for this provider. */
  available: boolean
}

export type KeyStatus = {
  provider: AiProvider
  envVar: string
  configured: boolean
  inUse: boolean
}

export type SurfaceOption = {
  key: string
  label: string
  description: string
  kind: 'text' | 'image'
  /** Narrower than `kind` where the surface only works on some providers. */
  providers?: AiProvider[]
  /** Shown when the surface has no row; "built-in default" when omitted. */
  unsetLabel?: string
}

type Props = {
  activityTypes: string[]
  surfaces: SurfaceOption[]
  catalogue: CatalogueOption[]
  keyStatus: KeyStatus[]
  initialRoutes: AiModelRoute[]
  pricingAsOf: string
  /** Route keys whose batch switch has effect (BATCH_ROUTE_KEYS); shown on their "All criteria" row only. */
  batchKeys: string[]
}

type ScType = 'binary' | 'levelled' | null

/** The three rows shown per activity type, in resolution order. */
const SC_ROWS: { scType: ScType; label: string; hint: string }[] = [
  { scType: null, label: 'All criteria', hint: 'Used when no more specific row is set' },
  { scType: 'binary', label: 'Binary only', hint: 'Criteria scored 0 or 1' },
  { scType: 'levelled', label: 'Levelled only', hint: 'Criteria scored 0..n over descriptors' },
]

function optionValue(provider: string, model: string) {
  return `${provider}::${model}`
}

export function AiModelRouteManager({
  activityTypes,
  surfaces,
  catalogue,
  keyStatus,
  initialRoutes,
  pricingAsOf,
  batchKeys,
}: Props) {
  const [routes, setRoutes] = useState<AiModelRoute[]>(initialRoutes)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const findRoute = (activityType: string, scType: ScType) =>
    routes.find((r) => r.activity_type === activityType && r.sc_type === scType) ?? null

  async function handleModelChange(activityType: string, scType: ScType, value: string) {
    const key = `${activityType}::${scType ?? '*'}`

    // Empty means "inherit" — remove the row so the resolver falls through to
    // the activity-wide default. Only meaningful on the binary/levelled rows;
    // the "All criteria" row has no parent to inherit from.
    if (!value) {
      const existing = findRoute(activityType, scType)
      if (!existing) return
      setSavingKey(key)
      const { error } = await deleteAiModelRouteAction(existing.route_id)
      setSavingKey(null)
      if (error) {
        toast.error('Could not clear the override')
        return
      }
      setRoutes((prev) => prev.filter((r) => r.route_id !== existing.route_id))
      toast.success('Override cleared — inherits the activity default')
      return
    }

    const [provider, model] = value.split('::') as [AiProvider, string]
    const existing = findRoute(activityType, scType)
    // Effort is meaningless on google and unset on a brand-new anthropic row,
    // where the provider default is the right starting point.
    const effort = provider === 'anthropic' ? existing?.effort ?? null : null

    setSavingKey(key)
    const { error } = await upsertAiModelRouteAction({ activityType, scType, provider, model, effort })
    setSavingKey(null)
    if (error) {
      toast.error(error)
      return
    }

    setRoutes((prev) => {
      const rest = prev.filter((r) => !(r.activity_type === activityType && r.sc_type === scType))
      return [
        ...rest,
        {
          route_id: existing?.route_id ?? `pending-${key}`,
          activity_type: activityType,
          sc_type: scType,
          provider,
          model,
          effort,
          active: true,
          use_batch: provider === 'anthropic' ? (existing?.provider === 'anthropic' ? existing.use_batch : true) : false,
          updated_at: new Date().toISOString(),
          updated_by: null,
        },
      ]
    })
    toast.success('Route saved')
  }

  async function handleEffortChange(activityType: string, scType: ScType, value: string) {
    const existing = findRoute(activityType, scType)
    if (!existing) return
    const key = `${activityType}::${scType ?? '*'}`
    const effort = (value || null) as AiEffort | null

    setSavingKey(key)
    const { error } = await upsertAiModelRouteAction({
      activityType,
      scType,
      provider: existing.provider,
      model: existing.model,
      effort,
    })
    setSavingKey(null)
    if (error) {
      toast.error(error)
      return
    }
    setRoutes((prev) =>
      prev.map((r) => (r.route_id === existing.route_id ? { ...r, effort } : r)),
    )
    toast.success('Effort saved')
  }

  async function handleBatchChange(activityType: string, useBatch: boolean) {
    const existing = findRoute(activityType, null)
    if (!existing) return
    const key = `${activityType}::*`
    setSavingKey(key)
    const { error } = await setAiModelRouteBatchAction({ activityType, useBatch })
    setSavingKey(null)
    if (error) {
      toast.error(error)
      return
    }
    setRoutes((prev) => prev.map((r) => (r.route_id === existing.route_id ? { ...r, use_batch: useBatch } : r)))
    toast.success(useBatch ? 'Batch marking on' : 'Batch marking off')
  }

  /** The batch switch of a route key, or nothing when the key cannot go by batch. */
  function batchSwitch(activityType: string, label: string, busy: boolean) {
    if (!batchKeys.includes(activityType)) return null
    const route = findRoute(activityType, null)
    const usable = Boolean(route) && route!.provider === 'anthropic'
    return (
      <label
        className="inline-flex items-center gap-2 text-xs text-muted-foreground"
        title={usable ? undefined : 'Batch marking needs a Claude model on this row'}
      >
        <Switch
          aria-label={`Batch for ${label}`}
          disabled={busy || !usable}
          checked={usable && route!.use_batch}
          onCheckedChange={(checked) => handleBatchChange(activityType, checked)}
        />
        Batch: half price, results can take up to 24 hours
      </label>
    )
  }

  const missingKeys = keyStatus.filter((k) => k.inUse && !k.configured)

  return (
    <div className="space-y-6">
      {missingKeys.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">Missing API key</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {missingKeys.map((k) => (
              <li key={k.provider}>
                Routes point at <strong>{k.provider}</strong>, but <code>{k.envVar}</code> is not set
                in <code>.env</code>. Marking for those activities will fail.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        API keys are configured in <code>.env</code>, not here. This page controls only which model
        is asked to mark what.
        <div className="mt-2 flex flex-wrap gap-3">
          {keyStatus.map((k) => (
            <span key={k.provider} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full ${k.configured ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
              />
              <code>{k.envVar}</code>
              <span>{k.configured ? 'set' : 'not set'}</span>
            </span>
          ))}
        </div>
      </div>

      {activityTypes.map((activityType) => (
        <div key={activityType} className="rounded-md border border-border">
          <div className="border-b border-border bg-muted/40 px-3 py-2">
            <h2 className="font-mono text-sm font-semibold">{activityType}</h2>
          </div>
          <div className="divide-y divide-border">
            {SC_ROWS.map(({ scType, label, hint }) => {
              const route = findRoute(activityType, scType)
              const key = `${activityType}::${scType ?? '*'}`
              const busy = savingKey === key
              const entry = route
                ? catalogue.find((c) => c.provider === route.provider && c.model === route.model)
                : null

              return (
                <div
                  key={label}
                  className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm"
                >
                  {/* Fixed width, not min-width: the three hints wrap to
                      different natural widths, which would leave the selects
                      at ragged offsets down the column. */}
                  <div className="w-56 shrink-0">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{hint}</div>
                  </div>

                  <select
                    aria-label={`Model for ${activityType} ${label}`}
                    disabled={busy}
                    value={route ? optionValue(route.provider, route.model) : ''}
                    onChange={(e) => handleModelChange(activityType, scType, e.target.value)}
                    className="w-64 shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">
                      {scType === null ? '— built-in default —' : '— inherit —'}
                    </option>
                    {catalogue.map((c) => (
                      <option
                        key={optionValue(c.provider, c.model)}
                        value={optionValue(c.provider, c.model)}
                        disabled={!c.available}
                      >
                        {c.label}
                        {c.available ? '' : ' — not yet callable'}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label={`Effort for ${activityType} ${label}`}
                    disabled={busy || !route || route.provider !== 'anthropic'}
                    value={route?.effort ?? ''}
                    onChange={(e) => handleEffortChange(activityType, scType, e.target.value)}
                    className="w-36 shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-40"
                    title={
                      route && route.provider !== 'anthropic'
                        ? 'Effort applies to Claude models only'
                        : undefined
                    }
                  >
                    <option value="">default effort</option>
                    {AI_EFFORT_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>

                  {scType === null ? batchSwitch(activityType, activityType, busy) : null}

                  {entry ? (
                    <span className="text-xs text-muted-foreground">
                      {entry.visionTier === 'high' ? 'high-res vision' : 'standard vision'}
                      {entry.inputPerMTok > 0
                        ? ` · $${entry.inputPerMTok}/$${entry.outputPerMTok} per MTok`
                        : ''}
                    </span>
                  ) : null}

                  {busy ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="rounded-md border border-border">
        <div className="border-b border-border bg-muted/40 px-3 py-2">
          <h2 className="text-sm font-semibold">Other surfaces</h2>
          <p className="text-xs text-muted-foreground">
            Everything else that calls a model. Only models that can do the job are
            offered — image generation cannot run on a text model, or the reverse.
          </p>
        </div>
        <div className="divide-y divide-border">
          {surfaces.map((surface) => {
            const route = findRoute(surface.key, null)
            const busy = savingKey === `${surface.key}::*`
            const options = catalogue.filter(
              (c) =>
                c.kind === surface.kind &&
                (!surface.providers || surface.providers.includes(c.provider)),
            )
            return (
              <div key={surface.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="w-56 shrink-0">
                  <div className="font-medium">{surface.label}</div>
                  <div className="text-xs text-muted-foreground">{surface.description}</div>
                </div>
                <select
                  aria-label={`Model for ${surface.label}`}
                  disabled={busy}
                  value={route ? optionValue(route.provider, route.model) : ''}
                  onChange={(e) => handleModelChange(surface.key, null, e.target.value)}
                  className="w-64 shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">{surface.unsetLabel ?? '— built-in default —'}</option>
                  {options.map((c) => (
                    <option key={optionValue(c.provider, c.model)} value={optionValue(c.provider, c.model)} disabled={!c.available}>
                      {c.label}
                      {c.available ? '' : ' — not yet callable'}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Effort for ${surface.label}`}
                  disabled={busy || !route || route.provider !== 'anthropic'}
                  value={route?.effort ?? ''}
                  onChange={(e) => handleEffortChange(surface.key, null, e.target.value)}
                  className="w-36 shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-40"
                >
                  <option value="">default effort</option>
                  {AI_EFFORT_LEVELS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
                {batchSwitch(surface.key, surface.label, busy)}
                {busy ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
              </div>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Prices shown are published list rates as of {pricingAsOf} and are for comparison only.
        Route changes reach the marking queue within 30 seconds.
      </p>
    </div>
  )
}
