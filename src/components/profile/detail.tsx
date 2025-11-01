import {
  readProfileDetailAction,
  updateProfileDetailAction,
} from "@/lib/server-updates"
import {
  INITIAL_PROFILE_FORM_STATE,
  ProfileFormClient,
  type ProfileFormActionState,
} from "@/components/profile/profile-form-client"

type ProfileDetailFormProps = {
  profileId: string
}

export async function ProfileDetailForm({ profileId }: ProfileDetailFormProps) {
  const result = await readProfileDetailAction(profileId)

  if (!result.data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {result.error ?? "We couldn’t load that profile. Please refresh and try again."}
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

    const updateResult = await updateProfileDetailAction({
      profileId,
      firstName,
      lastName,
    })

    if (!updateResult.success) {
      return {
        status: "error",
        message: updateResult.error ?? "Unable to save that profile right now.",
        profile: updateResult.data,
      }
    }

    return {
      status: "success",
      message: "Profile updated successfully.",
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
