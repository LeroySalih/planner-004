"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import type { CurrentProfile } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export type ProfileFormActionState = {
  status: "idle" | "success" | "error"
  message: string | null
  profile: CurrentProfile | null
}

export const INITIAL_PROFILE_FORM_STATE: ProfileFormActionState = {
  status: "idle",
  message: null,
  profile: null,
}

type ProfileFormClientProps = {
  profile: CurrentProfile
  initialState: ProfileFormActionState
  action: (state: ProfileFormActionState, formData: FormData) => Promise<ProfileFormActionState>
}

export function ProfileFormClient({ profile, action, initialState }: ProfileFormClientProps) {
  const [formState, formAction, pending] = useActionState(action, initialState)
  const [firstName, setFirstName] = useState(profile.first_name ?? "")
  const [lastName, setLastName] = useState(profile.last_name ?? "")

  const email = useMemo(() => profile.email ?? "", [profile.email])
  const isTeacher = useMemo(() => Boolean(profile.is_teacher), [profile.is_teacher])

  useEffect(() => {
    if (formState.status === "success") {
      const updated = formState.profile
      if (updated) {
        setFirstName(updated.first_name ?? "")
        setLastName(updated.last_name ?? "")
      }

      if (formState.message) {
        toast.success(formState.message)
      }
    } else if (formState.status === "error" && formState.message) {
      toast.error(formState.message)
    }
  }, [formState])

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset className="space-y-2" disabled={pending}>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          value={email}
          readOnly
          aria-readonly="true"
          disabled
          placeholder="Not available"
        />
      </fieldset>

      <fieldset className="space-y-2" disabled={pending}>
        <Label htmlFor="first-name">First name</Label>
        <Input
          id="first-name"
          name="firstName"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          placeholder="Ada"
          required
        />
      </fieldset>

      <fieldset className="space-y-2" disabled={pending}>
        <Label htmlFor="last-name">Last name</Label>
        <Input
          id="last-name"
          name="lastName"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          placeholder="Lovelace"
          required
        />
      </fieldset>

      <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">Teacher account</p>
          <p className="text-xs text-muted-foreground">This setting is managed by the system and cannot be changed here.</p>
        </div>
        <Switch
          checked={isTeacher}
          disabled
          aria-readonly="true"
          className="pointer-events-none opacity-60"
          data-testid="is_teacher_switch"
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Saving…
          </>
        ) : (
          "Save changes"
        )}
      </Button>
    </form>
  )
}
