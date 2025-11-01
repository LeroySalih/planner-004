import {
  readCurrentProfileAction,
  updateCurrentProfileAction,
} from "@/lib/server-updates"
import {
  ProfileFormClient,
  type ProfileFormActionState,
  INITIAL_PROFILE_FORM_STATE,
} from "@/components/profile/profile-form-client"

export async function ProfileForm() {
  const result = await readCurrentProfileAction()

  if (!result.data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {result.error ?? "We couldn’t load your profile details. Please refresh the page and try again."}
      </div>
    )
  }

  async function handleProfileUpdate(
    _prevState: ProfileFormActionState,
    formData: FormData,
  ): Promise<ProfileFormActionState> {
    "use server"

    const firstName = (formData.get("firstName") ?? "").toString()
    const lastName = (formData.get("lastName") ?? "").toString()

    const updateResult = await updateCurrentProfileAction({ firstName, lastName })

    if (!updateResult.success) {
      return {
        status: "error",
        message: updateResult.error ?? "Unable to save your profile right now.",
        profile: updateResult.data,
      }
    }

    return {
      status: "success",
      message: "Profile saved successfully.",
      profile: updateResult.data,
    }
  }

  return (
    <ProfileFormClient
      profile={result.data}
      action={handleProfileUpdate}
      initialState={INITIAL_PROFILE_FORM_STATE}
    />
  )
}
