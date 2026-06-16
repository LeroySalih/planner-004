import {
  clearSigninThrottleForPupilAction,
  readPupilSigninLockStatusAction,
  resetPupilPasswordAction,
} from "@/lib/server-updates"
import { readAllProfilesAction } from "@/lib/server-actions/profile"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { RoleManager } from "@/components/admin/role-manager"
import type { PupilActionState } from "@/app/groups/[groupId]/pupil-action-state"

export default async function AdminRolesPage() {
  const adminProfile = await requireAuthenticatedProfile()

  const { data: profiles, error } = await readAllProfilesAction()

  if (error) {
    return (
      <div className="p-4 text-red-500">
        Error loading profiles: {error}
      </div>
    )
  }

  const userIds = profiles.map((p) => p.userId)
  let lockedMap = new Map<string, boolean>()

  if (userIds.length > 0) {
    const lockResult = await readPupilSigninLockStatusAction(
      { userIds },
      { currentProfile: adminProfile },
    )
    if (lockResult.data) {
      lockedMap = new Map(lockResult.data.map((item) => [item.userId, item.locked]))
    }
  }

  const profilesWithLocks = profiles.map((p) => ({
    ...p,
    locked: lockedMap.get(p.userId) ?? false,
  }))

  async function handleResetPassword(
    _prevState: PupilActionState,
    formData: FormData,
  ): Promise<PupilActionState> {
    "use server"
    const userId = formData.get("userId")
    if (typeof userId !== "string" || !userId.trim()) {
      return { status: "error", message: "Missing user identifier.", userId: null, displayName: null }
    }
    const displayName = (formData.get("displayName") as string | null)?.trim() || userId
    const outcome = await resetPupilPasswordAction({ userId }, { currentProfile: adminProfile })
    if (!outcome.success) {
      return { status: "error", message: outcome.error ?? "Unable to reset password.", userId, displayName }
    }
    return { status: "success", message: `Password reset for ${displayName}.`, userId, displayName }
  }

  async function handleUnlock(
    _prevState: PupilActionState,
    formData: FormData,
  ): Promise<PupilActionState> {
    "use server"
    const userId = formData.get("userId")
    if (typeof userId !== "string" || !userId.trim()) {
      return { status: "error", message: "Missing user identifier.", userId: null, displayName: null }
    }
    const displayName = (formData.get("displayName") as string | null)?.trim() || userId
    const outcome = await clearSigninThrottleForPupilAction({ userId }, { currentProfile: adminProfile })
    if (!outcome.success) {
      return { status: "error", message: outcome.error ?? "Unable to unlock user.", userId, displayName }
    }
    return { status: "success", message: `Unlocked sign-in for ${displayName}.`, userId, displayName }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Role Management</h1>
        <p className="text-muted-foreground">
          View and assign roles to users.
        </p>
      </div>
      <RoleManager
        initialProfiles={profilesWithLocks}
        resetPasswordAction={handleResetPassword}
        unlockAction={handleUnlock}
      />
    </div>
  )
}
