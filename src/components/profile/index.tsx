"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabaseBrowserClient } from "@/lib/supabase-browser"

export function ProfileForm() {
  const router = useRouter()
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const loadUserAndProfile = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setSuccessMessage(null)

    const { data: userData, error: userError } = await supabaseBrowserClient.auth.getUser()

    const user = userData?.user
    if (userError || !user) {
      router.push("/signin")
      return
    }

    setUserId(user.id)

    const { data: profileData, error: profileError } = await supabaseBrowserClient
      .from("profiles")
      .select("first_name, last_name")
      .eq("user_id", user.id)
      .maybeSingle()

    if (profileError) {
      setError(profileError.message)
    } else if (profileData) {
      setFirstName(profileData.first_name ?? "")
      setLastName(profileData.last_name ?? "")
    }

    setIsLoading(false)
  }, [router])

  useEffect(() => {
    void loadUserAndProfile()
  }, [loadUserAndProfile])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!userId) return

    if (firstName.trim().length === 0 || lastName.trim().length === 0) {
      setError("Please provide both a first and last name.")
      setSuccessMessage(null)
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccessMessage(null)

    const { error: upsertError } = await supabaseBrowserClient.from("profiles").upsert(
      {
        user_id: userId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      },
      { onConflict: "user_id" },
    )

    setIsSubmitting(false)

    if (upsertError) {
      setError(upsertError.message)
      setSuccessMessage(null)
      return
    }

    setError(null)
    setSuccessMessage("Profile saved successfully.")
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading your profile...
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-500">{successMessage}</p> : null}

      <Button type="submit" disabled={isSubmitting || !userId} className="w-full">
        {isSubmitting ? "Saving..." : "Save profile"}
      </Button>
    </form>
  )
}
