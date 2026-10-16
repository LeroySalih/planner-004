'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { withDbClient } from '@/lib/db'
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey, type ApiKey } from '@/lib/oauth/api-keys'
import { ClientValidationError } from '@/lib/oauth/clients'
import {
  ClientRequestError,
  createFirstPartyClient,
  listFirstPartyClients,
  rotateClientSecret,
  setClientEnabled,
  type AuditActor,
  type FirstPartyClient,
} from '@/lib/oauth/client-store'

// The admin console for first-party OAuth clients and project API keys
// (/admin/oauth, docs/FIRST-PARTY-CLIENTS.md). Admin only, checked here in
// every action as well as by the page. Keys and service secrets are returned
// once, by the action that creates them, and never again.

type Result<T> = { data: T | null; error: string | null }

const PAGE = '/admin/oauth'

async function asAdmin<T>(fn: (actor: AuditActor) => Promise<T>): Promise<Result<T>> {
  try {
    const profile = await requireRole('admin')
    const data = await fn({ kind: 'admin', userId: profile.userId })
    return { data, error: null }
  } catch (error) {
    // requireRole redirects by throwing; let Next handle that.
    unstable_rethrow(error)
    if (error instanceof ClientRequestError || error instanceof ClientValidationError) {
      return { data: null, error: error.message }
    }
    console.error('[oauth-admin] action failed', error)
    return { data: null, error: 'Something went wrong.' }
  }
}

export type OAuthAdminState = { keys: ApiKey[]; clients: FirstPartyClient[] }

export async function readOAuthAdminStateAction(): Promise<Result<OAuthAdminState>> {
  return asAdmin((actor) =>
    withDbClient(async (db) => ({ keys: await listApiKeys(db), clients: await listFirstPartyClients(db, actor) })),
  )
}

const csv = (value: string) => value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean)

const CreateKeyInput = z.object({
  name: z.string(),
  clientIdPrefix: z.string(),
  roles: z.array(z.string()),
  scopes: z.string(),
  redirectHosts: z.string(),
  audiences: z.string(),
  maxClients: z.number().int(),
  requiresApproval: z.boolean(),
  expiresAt: z.string().nullable(),
})

export async function createApiKeyAction(input: z.infer<typeof CreateKeyInput>): Promise<Result<{ key: string; name: string }>> {
  return asAdmin(async (actor) => {
    const payload = CreateKeyInput.parse(input)
    const { key, apiKey } = await withDbClient((db) =>
      createApiKey(
        db,
        {
          name: payload.name,
          clientIdPrefix: payload.clientIdPrefix,
          allowedRoles: payload.roles,
          allowedScopes: csv(payload.scopes),
          allowedRedirectHosts: csv(payload.redirectHosts),
          allowedAudiences: csv(payload.audiences),
          maxClients: payload.maxClients,
          requiresApproval: payload.requiresApproval,
          expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        },
        actor,
      ),
    )
    revalidatePath(PAGE)
    return { key, name: apiKey.name }
  })
}

export async function rotateApiKeyAction(keyId: string, overlapSeconds: number): Promise<Result<{ key: string; name: string }>> {
  return asAdmin(async (actor) => {
    const { key, apiKey } = await withDbClient((db) => rotateApiKey(db, z.string().uuid().parse(keyId), overlapSeconds, actor))
    revalidatePath(PAGE)
    return { key, name: apiKey.name }
  })
}

export async function revokeApiKeyAction(keyId: string): Promise<Result<null>> {
  return asAdmin(async (actor) => {
    await withDbClient((db) => revokeApiKey(db, z.string().uuid().parse(keyId), actor))
    revalidatePath(PAGE)
    return null
  })
}

const CreateClientInput = z.object({
  clientType: z.enum(['public', 'service']),
  clientId: z.string(),
  clientName: z.string(),
  redirectUris: z.string(),
  roles: z.array(z.string()),
  scopes: z.array(z.string()),
  audience: z.string(),
  allowedAudiences: z.string(),
  serviceScopes: z.string(),
  accessTtlSeconds: z.number().int().nullable(),
  refreshTtlSeconds: z.number().int().nullable(),
})

/** An admin-created client has no owner key and is enabled at once. */
export async function createOAuthClientAction(
  input: z.infer<typeof CreateClientInput>,
): Promise<Result<{ clientId: string; clientSecret: string | null }>> {
  return asAdmin(async (actor) => {
    const payload = CreateClientInput.parse(input)
    const service = payload.clientType === 'service'
    const { client, clientSecret } = await withDbClient((db) =>
      createFirstPartyClient(db, actor, {
        clientId: payload.clientId,
        clientName: payload.clientName,
        clientType: payload.clientType,
        redirectUris: service ? [] : csv(payload.redirectUris),
        allowedRoles: service ? [] : payload.roles,
        allowedScopes: service ? [] : payload.scopes,
        audience: service ? null : payload.audience,
        allowedAudiences: service ? csv(payload.allowedAudiences) : [],
        allowedServiceScopes: service ? csv(payload.serviceScopes) : [],
        accessTtlSeconds: payload.accessTtlSeconds,
        refreshTtlSeconds: service ? null : payload.refreshTtlSeconds,
      }),
    )
    revalidatePath(PAGE)
    return { clientId: client.clientId, clientSecret }
  })
}

/** Enabling a pending client is the approval. */
export async function setOAuthClientEnabledAction(clientId: string, enabled: boolean): Promise<Result<null>> {
  return asAdmin(async (actor) => {
    await withDbClient((db) => setClientEnabled(db, actor, z.string().parse(clientId), enabled))
    revalidatePath(PAGE)
    return null
  })
}

export async function rotateOAuthClientSecretAction(
  clientId: string,
  overlapSeconds: number,
): Promise<Result<{ clientId: string; clientSecret: string }>> {
  return asAdmin(async (actor) => {
    const { clientSecret } = await withDbClient((db) =>
      rotateClientSecret(db, actor, z.string().parse(clientId), overlapSeconds),
    )
    revalidatePath(PAGE)
    return { clientId, clientSecret }
  })
}
