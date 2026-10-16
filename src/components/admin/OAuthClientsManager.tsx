'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiKey } from '@/lib/oauth/api-keys'
import type { FirstPartyClient } from '@/lib/oauth/client-store'
import {
  createApiKeyAction,
  createOAuthClientAction,
  revokeApiKeyAction,
  rotateApiKeyAction,
  rotateOAuthClientSecretAction,
  setOAuthClientEnabledAction,
} from '@/lib/server-updates'

type Props = {
  keys: ApiKey[]
  clients: FirstPartyClient[]
  roles: string[]
  userScopes: string[]
}

type Revealed = { label: string; value: string; note: string }

const formatDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const keyStatus = (key: ApiKey) =>
  key.revokedAt ? 'revoked' : key.expiresAt && new Date(key.expiresAt) < new Date() ? 'expired' : 'active'

const clientStatus = (client: FirstPartyClient) =>
  client.pendingApproval ? 'pending approval' : client.disabledAt ? 'disabled' : 'enabled'

/** A secret shown once. It stays until dismissed and is never fetched again. */
function SecretPanel({ revealed, onDismiss }: { revealed: Revealed; onDismiss: () => void }) {
  return (
    <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium">{revealed.label}</p>
      <p className="mt-1 text-[var(--color-text-secondary)]">{revealed.note}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{revealed.value}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(revealed.value).then(
              () => toast.success('Copied'),
              () => toast.error('Could not copy; select it instead.'),
            )
          }}
        >
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          I have stored it
        </Button>
      </div>
    </div>
  )
}

function Checkboxes({ options, value, onChange }: { options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((option) => (
        <label key={option} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={value.includes(option)}
            onChange={(event) => onChange(event.target.checked ? [...value, option] : value.filter((v) => v !== option))}
          />
          {option}
        </label>
      ))}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-[var(--color-text-secondary)]">{hint}</p> : null}
    </div>
  )
}

function CreateKeyForm({ roles, onCreated }: { roles: string[]; onCreated: (revealed: Revealed) => void }) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    name: '',
    clientIdPrefix: '',
    roles: ['pupil', 'teacher'],
    scopes: 'profile',
    redirectHosts: '',
    audiences: '',
    maxClients: 5,
    requiresApproval: true,
    expiresAt: '',
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <form
      className="grid gap-3 rounded-md border p-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await createApiKeyAction({ ...form, expiresAt: form.expiresAt || null })
          if (result.error || !result.data) {
            toast.error(result.error ?? 'Could not create the key.')
            return
          }
          onCreated({
            label: `API key for ${result.data.name}`,
            value: result.data.key,
            note: 'Shown once. Put it in that project’s .env; DINO keeps only its hash.',
          })
          setForm((f) => ({ ...f, name: '', clientIdPrefix: '', redirectHosts: '', audiences: '' }))
        })
      }}
    >
      <Field label="Project name" hint="Lower-case, e.g. kerf-sabre">
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </Field>
      <Field label="client_id prefix" hint="Every client the key creates must start with this, e.g. kerf-">
        <Input value={form.clientIdPrefix} onChange={(e) => set('clientIdPrefix', e.target.value)} required />
      </Field>
      <Field label="Roles its clients may sign in" hint="admin only if you tick it">
        <Checkboxes options={roles} value={form.roles} onChange={(v) => set('roles', v)} />
      </Field>
      <Field label="Scopes" hint="Comma separated: profile, groups, and any service scopes">
        <Input value={form.scopes} onChange={(e) => set('scopes', e.target.value)} />
      </Field>
      <Field label="Redirect hosts" hint="Exact host names, comma separated. localhost is always allowed.">
        <Input value={form.redirectHosts} onChange={(e) => set('redirectHosts', e.target.value)} />
      </Field>
      <Field label="Audiences" hint="Token audiences its clients may use, e.g. kerf-sabre">
        <Input value={form.audiences} onChange={(e) => set('audiences', e.target.value)} />
      </Field>
      <Field label="Max clients">
        <Input type="number" min={0} max={100} value={form.maxClients} onChange={(e) => set('maxClients', Number(e.target.value))} />
      </Field>
      <Field label="Expires (optional)">
        <Input type="date" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" checked={form.requiresApproval} onChange={(e) => set('requiresApproval', e.target.checked)} />
        New clients wait for an admin to approve them
      </label>
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create key'}
        </Button>
      </div>
    </form>
  )
}

function CreateClientForm({
  roles,
  userScopes,
  onCreated,
}: {
  roles: string[]
  userScopes: string[]
  onCreated: (revealed: Revealed | null) => void
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    clientType: 'public' as 'public' | 'service',
    clientId: '',
    clientName: '',
    redirectUris: '',
    roles: ['pupil', 'teacher'],
    scopes: ['profile'],
    audience: '',
    allowedAudiences: '',
    serviceScopes: '',
    accessTtlSeconds: '',
    refreshTtlSeconds: '',
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const service = form.clientType === 'service'
  const seconds = (value: string) => (value.trim() ? Number(value) : null)

  return (
    <form
      className="grid gap-3 rounded-md border p-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await createOAuthClientAction({
            ...form,
            accessTtlSeconds: seconds(form.accessTtlSeconds),
            refreshTtlSeconds: seconds(form.refreshTtlSeconds),
          })
          if (result.error || !result.data) {
            toast.error(result.error ?? 'Could not create the client.')
            return
          }
          toast.success(`Created ${result.data.clientId}`)
          onCreated(
            result.data.clientSecret
              ? {
                  label: `Secret for ${result.data.clientId}`,
                  value: result.data.clientSecret,
                  note: 'Shown once. Put it in that service’s .env; DINO keeps only its hash.',
                }
              : null,
          )
          setForm((f) => ({ ...f, clientId: '', clientName: '', redirectUris: '' }))
        })
      }}
    >
      <Field label="Type">
        <select
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={form.clientType}
          onChange={(e) => set('clientType', e.target.value as 'public' | 'service')}
        >
          <option value="public">Sign-in app (PKCE, signs people in)</option>
          <option value="service">Service (client_credentials, acts as itself)</option>
        </select>
      </Field>
      <Field label="client_id">
        <Input value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required />
      </Field>
      <Field label="Name">
        <Input value={form.clientName} onChange={(e) => set('clientName', e.target.value)} required />
      </Field>
      {service ? (
        <>
          <Field label="Allowed audiences" hint="The apps it may call, comma separated">
            <Input value={form.allowedAudiences} onChange={(e) => set('allowedAudiences', e.target.value)} required />
          </Field>
          <Field label="Service scopes" hint="Comma separated, e.g. groups:read">
            <Input value={form.serviceScopes} onChange={(e) => set('serviceScopes', e.target.value)} />
          </Field>
          <Field label="Token lifetime (s)" hint="300 to 600; default 300">
            <Input value={form.accessTtlSeconds} onChange={(e) => set('accessTtlSeconds', e.target.value)} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Audience" hint="The JWT aud, e.g. kerf-sabre">
            <Input value={form.audience} onChange={(e) => set('audience', e.target.value)} required />
          </Field>
          <Field label="Redirect URIs" hint="Exact URIs, one per line or comma separated">
            <textarea
              className="min-h-20 w-full rounded-md border bg-background px-2 py-1 text-sm"
              value={form.redirectUris}
              onChange={(e) => set('redirectUris', e.target.value)}
              required
            />
          </Field>
          <Field label="Who may sign in">
            <Checkboxes options={roles} value={form.roles} onChange={(v) => set('roles', v)} />
          </Field>
          <Field label="Scopes">
            <Checkboxes options={userScopes} value={form.scopes} onChange={(v) => set('scopes', v)} />
          </Field>
          <Field label="Access token lifetime (s)" hint="60 to 3600; default 900">
            <Input value={form.accessTtlSeconds} onChange={(e) => set('accessTtlSeconds', e.target.value)} />
          </Field>
          <Field label="Refresh token lifetime (s)" hint="Default 604800 (7 days)">
            <Input value={form.refreshTtlSeconds} onChange={(e) => set('refreshTtlSeconds', e.target.value)} />
          </Field>
        </>
      )}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create client'}
        </Button>
      </div>
    </form>
  )
}

function KeyRow({ apiKey, owned, onRevealed }: { apiKey: ApiKey; owned: FirstPartyClient[]; onRevealed: (r: Revealed) => void }) {
  const [pending, startTransition] = useTransition()
  const status = keyStatus(apiKey)
  return (
    <div className="space-y-2 rounded-md border p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{apiKey.name}</span>
        <code className="text-xs">dino_pk_{apiKey.keyPrefix}…</code>
        <Badge variant={status === 'active' ? 'secondary' : 'destructive'}>{status}</Badge>
        {apiKey.previousExpiresAt ? <Badge variant="outline">old key valid until {formatDate(apiKey.previousExpiresAt)}</Badge> : null}
        <span className="text-xs text-[var(--color-text-secondary)]">last used {formatDate(apiKey.lastUsedAt)}</span>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-3">
        <div><dt className="inline text-[var(--color-text-secondary)]">client_id prefix: </dt><dd className="inline">{apiKey.clientIdPrefix}</dd></div>
        <div><dt className="inline text-[var(--color-text-secondary)]">roles: </dt><dd className="inline">{apiKey.allowedRoles.join(', ')}</dd></div>
        <div><dt className="inline text-[var(--color-text-secondary)]">scopes: </dt><dd className="inline">{apiKey.allowedScopes.join(', ') || '—'}</dd></div>
        <div><dt className="inline text-[var(--color-text-secondary)]">redirect hosts: </dt><dd className="inline">{apiKey.allowedRedirectHosts.join(', ') || 'localhost only'}</dd></div>
        <div><dt className="inline text-[var(--color-text-secondary)]">audiences: </dt><dd className="inline">{apiKey.allowedAudiences.join(', ') || '—'}</dd></div>
        <div><dt className="inline text-[var(--color-text-secondary)]">clients: </dt><dd className="inline">{owned.length} of {apiKey.maxClients}{apiKey.requiresApproval ? ', approval required' : ''}</dd></div>
        <div><dt className="inline text-[var(--color-text-secondary)]">expires: </dt><dd className="inline">{formatDate(apiKey.expiresAt)}</dd></div>
      </dl>
      {owned.length ? (
        <p className="text-xs">Owns: {owned.map((c) => `${c.clientId} (${clientStatus(c)})`).join(', ')}</p>
      ) : null}
      {status === 'active' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              const hours = window.prompt('Keep the old key working for how many hours? (0 = stop it now)', '0')
              if (hours === null) return
              startTransition(async () => {
                const result = await rotateApiKeyAction(apiKey.id, Math.round(Number(hours) * 3600))
                if (result.error || !result.data) {
                  toast.error(result.error ?? 'Could not rotate the key.')
                  return
                }
                onRevealed({
                  label: `New API key for ${result.data.name}`,
                  value: result.data.key,
                  note: 'Shown once. Replace the old key in that project’s .env.',
                })
              })
            }}
          >
            Rotate
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Revoke ${apiKey.name}? It stops working at once. Its clients keep working.`)) return
              startTransition(async () => {
                const result = await revokeApiKeyAction(apiKey.id)
                if (result.error) toast.error(result.error)
                else toast.success(`Revoked ${apiKey.name}`)
              })
            }}
          >
            Revoke
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ClientRow({ client, owner, onRevealed }: { client: FirstPartyClient; owner: string | null; onRevealed: (r: Revealed) => void }) {
  const [pending, startTransition] = useTransition()
  const status = clientStatus(client)
  const enabled = status === 'enabled'
  const toggle = (next: boolean) =>
    startTransition(async () => {
      const result = await setOAuthClientEnabledAction(client.clientId, next)
      if (result.error) toast.error(result.error)
      else toast.success(next ? `${client.clientId} enabled` : `${client.clientId} disabled`)
    })

  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-3">
        <div className="font-medium">{client.clientId}</div>
        <div className="text-xs text-[var(--color-text-secondary)]">{client.clientName}</div>
      </td>
      <td className="py-2 pr-3 text-xs">{client.clientType === 'service' ? 'service' : 'sign-in'}</td>
      <td className="py-2 pr-3 text-xs">{owner ?? 'admin / script'}</td>
      <td className="py-2 pr-3 text-xs">
        {client.clientType === 'service' ? (
          <>
            <div>calls: {client.allowedAudiences.join(', ')}</div>
            <div>scopes: {client.allowedServiceScopes.join(', ') || '—'}</div>
          </>
        ) : (
          <>
            <div>aud: {client.audience}</div>
            <div>roles: {client.allowedRoles.join(', ')}</div>
            <div>scopes: {client.allowedScopes.join(', ') || '—'}</div>
            <div className="break-all">{client.redirectUris.join(' ')}</div>
          </>
        )}
      </td>
      <td className="py-2 pr-3">
        <Badge variant={enabled ? 'secondary' : status === 'pending approval' ? 'outline' : 'destructive'}>{status}</Badge>
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-2">
          {status === 'pending approval' ? (
            <Button size="sm" disabled={pending} onClick={() => toggle(true)}>Approve</Button>
          ) : enabled ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => toggle(false)}>Disable</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => toggle(true)}>Enable</Button>
          )}
          {client.clientType === 'service' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                const hours = window.prompt('Keep the old secret working for how many hours? (0 = stop it now)', '0')
                if (hours === null) return
                startTransition(async () => {
                  const result = await rotateOAuthClientSecretAction(client.clientId, Math.round(Number(hours) * 3600))
                  if (result.error || !result.data) {
                    toast.error(result.error ?? 'Could not rotate the secret.')
                    return
                  }
                  onRevealed({
                    label: `New secret for ${result.data.clientId}`,
                    value: result.data.clientSecret,
                    note: 'Shown once. Replace the old secret in that service’s .env.',
                  })
                })
              }}
            >
              Rotate secret
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

export function OAuthClientsManager({ keys, clients, roles, userScopes }: Props) {
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const keyName = new Map(keys.map((k) => [k.id, k.name]))
  const pending = clients.filter((c) => c.pendingApproval)

  return (
    <div className="space-y-8">
      {revealed ? <SecretPanel revealed={revealed} onDismiss={() => setRevealed(null)} /> : null}

      {pending.length ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Waiting for approval</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Created by a project key. They cannot sign anyone in or get a token until you approve them.
          </p>
          <p className="text-sm">{pending.map((c) => `${c.clientId} (${keyName.get(c.ownerKeyId ?? '') ?? '?'})`).join(', ')}</p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-semibold">Clients</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-text-secondary)]">
                <th className="pb-2 pr-3">Client</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Owner</th>
                <th className="pb-2 pr-3">Settings</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <ClientRow
                  key={client.clientId}
                  client={client}
                  owner={client.ownerKeyId ? keyName.get(client.ownerKeyId) ?? null : null}
                  onRevealed={setRevealed}
                />
              ))}
            </tbody>
          </table>
          {clients.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No first-party clients yet.</p> : null}
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Add a client</summary>
          <div className="mt-3">
            <CreateClientForm roles={roles} userScopes={userScopes} onCreated={(r) => r && setRevealed(r)} />
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Project API keys</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Each project gets its own key, limited to its own clients and to the ceiling below. There is no shared
          key: revoking one project&apos;s key affects nobody else.
        </p>
        {keys.map((apiKey) => (
          <KeyRow
            key={apiKey.id}
            apiKey={apiKey}
            owned={clients.filter((c) => c.ownerKeyId === apiKey.id)}
            onRevealed={setRevealed}
          />
        ))}
        <details>
          <summary className="cursor-pointer text-sm font-medium">Create a key</summary>
          <div className="mt-3">
            <CreateKeyForm roles={roles} onCreated={setRevealed} />
          </div>
        </details>
      </section>
    </div>
  )
}
