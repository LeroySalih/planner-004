import { readAiModelRoutesAction, readProviderKeyStatusAction } from '@/lib/server-updates'
import { MODEL_CATALOGUE, MODEL_SURFACES, PRICING_AS_OF } from '@/lib/ai/model-routing'
import { AI_MARKED_ACTIVITY_TYPES } from '@/dino.config'
import { AiModelRouteManager, type CatalogueOption } from '@/components/admin/AiModelRouteManager'

export default async function AiModelsPage() {
  const [{ data: routes }, { data: keyStatus }] = await Promise.all([
    readAiModelRoutesAction(),
    readProviderKeyStatusAction(),
  ])

  // Strip to the fields the client needs — the catalogue is a server-only
  // module and its shape may grow server-side concerns later.
  const catalogue: CatalogueOption[] = MODEL_CATALOGUE.map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    label: entry.label,
    kind: entry.kind,
    visionTier: entry.visionTier,
    inputPerMTok: entry.inputPerMTok,
    outputPerMTok: entry.outputPerMTok,
    note: entry.note,
    available: entry.available,
  }))

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">AI Models</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Choose which model marks which activity. Each activity type can have one default plus
          separate choices for binary and levelled criteria — a 0/1 criterion rarely needs the same
          model as one scored across descriptors. The most specific row wins; anything left unset
          falls back to the activity default, then to the app&apos;s built-in default.
        </p>
      </div>

      <AiModelRouteManager
        activityTypes={[...AI_MARKED_ACTIVITY_TYPES]}
        surfaces={MODEL_SURFACES.map((s) => ({
          key: s.key,
          label: s.label,
          description: s.description,
          kind: s.kind,
          providers: s.providers ? [...s.providers] : undefined,
        }))}
        catalogue={catalogue}
        keyStatus={keyStatus ?? []}
        initialRoutes={routes ?? []}
        pricingAsOf={PRICING_AS_OF}
      />
    </div>
  )
}
