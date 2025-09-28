"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"

import { supabaseBrowserClient } from "@/lib/supabase-browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type ProfileDetailFormProps = {
  profileId: string
}

export function ProfileDetailForm({ profileId }: ProfileDetailFormProps) {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [isTeacher, setIsTeacher] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const loadProfile = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setSuccessMessage(null)

    const { data, error: profileError } = await supabaseBrowserClient
      .from("profiles")
      .select("first_name, last_name, is_teacher")
      .eq("user_id", profileId)
      .maybeSingle()

    if (profileError) {
      setError(profileError.message)
      setIsLoading(false)
      return
    }

    if (!data) {
      setError("Profile not found.")
      setIsLoading(false)
      return
    }

    setFirstName(data.first_name ?? "")
    setLastName(data.last_name ?? "")
    setIsTeacher(Boolean(data.is_teacher))
    setIsLoading(false)
  }, [profileId])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (firstName.trim().length === 0 || lastName.trim().length === 0) {
      setError("Please provide both a first and last name.")
      return
    }

    setIsSaving(true)

    const { error: updateError } = await supabaseBrowserClient
      .from("profiles")
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })
      .eq("user_id", profileId)

    setIsSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccessMessage("Profile updated successfully.")
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading profile...
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="space-y-2">
        <Label htmlFor="first-name">First name</Label>
        <Input
          id="first-name"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          placeholder="Ada"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="last-name">Last name</Label>
        <Input
          id="last-name"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          placeholder="Lovelace"
          required
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">Teacher account</p>
          <p className="text-xs text-muted-foreground">This setting is managed by the system and cannot be changed here.</p>
        </div>
        <Switch checked={isTeacher} disabled aria-readonly className="pointer-events-none opacity-60" />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-500">{successMessage}</p> : null}

      <Button type="submit" disabled={isSaving} className="w-full">
        {isSaving ? "Saving..." : "Save changes"}
      </Button>
    </form>
  )
}

