import { RoleManager } from "@/components/admin/role-manager"
import { readAllProfilesAction } from "@/lib/server-actions/profile"

export default async function AdminRolesPage() {
  const { data: profiles, error } = await readAllProfilesAction()

  if (error) {
    return (
      <div className="p-4 text-red-500">
        Error loading profiles: {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Role Management</h1>
        <p className="text-muted-foreground">
          View and assign roles to users.
        </p>
      </div>
      <RoleManager initialProfiles={profiles} />
    </div>
  )
}
