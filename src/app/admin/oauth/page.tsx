import { OAuthClientsManager } from '@/components/admin/OAuthClientsManager'
import { readOAuthAdminStateAction } from '@/lib/server-updates'
import { CLIENT_ROLES, USER_SCOPES } from '@/lib/oauth/clients'

// First-party OAuth clients and the project API keys that manage them
// (docs/FIRST-PARTY-CLIENTS.md). The admin layout and every action check the
// admin role.
export default async function OAuthAdminPage() {
  const { data, error } = await readOAuthAdminStateAction()

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">OAuth clients and project keys</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Apps that sign people in with DINO, services that call each other with short-lived tokens, and the
          per-project API keys that let a project manage its own clients within a ceiling you set. Keys and
          service secrets are shown once, when they are created or rotated. MCP connections are not listed here.
        </p>
      </div>
      {error || !data ? (
        <p className="text-sm text-destructive">{error ?? 'Could not load OAuth clients.'}</p>
      ) : (
        <OAuthClientsManager
          keys={data.keys}
          clients={data.clients}
          roles={[...CLIENT_ROLES]}
          userScopes={[...USER_SCOPES]}
        />
      )}
    </div>
  )
}
