"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabaseBrowserClient } from "@/lib/supabase-browser"

type MembershipWithGroup = {
  group_id: string
  role: string
  groups?: {
    group_id: string
    subject: string
    join_code: string
  } | null
}

export function ProfileGroupsManager() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [memberships, setMemberships] = useState<MembershipWithGroup[]>([])
  const [joinCode, setJoinCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  const normalizedJoinCode = useMemo(() => joinCode.trim().toUpperCase(), [joinCode])

  const loadMemberships = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setSuccess(null)

    const { data: userData, error: userError } = await supabaseBrowserClient.auth.getUser()

    const user = userData?.user
    if (userError || !user) {
      router.push("/signin")
      return
    }

    setUserId(user.id)

    const { data: membershipRows, error: membershipError } = await supabaseBrowserClient
      .from("group_membership")
      .select("group_id, role, groups:groups(group_id, subject, join_code)")
      .eq("user_id", user.id)
      .order("group_id", { ascending: true })

    if (membershipError) {
      setError(membershipError.message)
      setMemberships([])
    } else {
      const normalized = (membershipRows ?? []).map((row) => ({
        group_id: row.group_id as string,
        role: row.role as string,
        groups: Array.isArray(row.groups) ? row.groups[0] ?? null : row.groups ?? null,
      })) as MembershipWithGroup[]
      setMemberships(normalized)
    }

    setIsLoading(false)
  }, [router])

  useEffect(() => {
    void loadMemberships()
  }, [loadMemberships])

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!userId) return

    setError(null)
    setSuccess(null)

    if (normalizedJoinCode.length !== 5) {
      setError("Join codes must be 5 characters long.")
      return
    }

    setJoining(true)

    const { data: groupData, error: groupError } = await supabaseBrowserClient
      .from("groups")
      .select("group_id, subject")
      .eq("join_code", normalizedJoinCode)
      .eq("active", true)
      .maybeSingle()

    if (groupError) {
      setJoining(false)
      setError(groupError.message)
      return
    }

    if (!groupData) {
      setJoining(false)
      setError("No group found with that join code.")
      return
    }

    const existingMembership = memberships.some((membership) => membership.group_id === groupData.group_id)
    if (existingMembership) {
      setJoining(false)
      setError("You are already a member of that group.")
      return
    }

    const { error: insertError } = await supabaseBrowserClient.from("group_membership").insert({
      group_id: groupData.group_id,
      user_id: userId,
      role: "pupil",
    })

    setJoining(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setSuccess(`Joined ${groupData.group_id} successfully.`)
    setJoinCode("")
    await loadMemberships()
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading your groups...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleJoin} className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="join-code">Join a group</Label>
          <Input
            id="join-code"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="Enter 5 character code"
            maxLength={5}
            required
          />
          <p className="text-xs text-muted-foreground">Ask your teacher for the 5 character join code.</p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-500">{success}</p> : null}

        <Button type="submit" className="w-full" disabled={joining}>
          {joining ? "Joining..." : "Join group"}
        </Button>
      </form>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Groups you belong to</h2>
        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have not joined any groups yet.</p>
        ) : (
          <ul className="grid gap-3">
            {memberships.map((membership) => {
              const group = membership.groups
              return (
                <li
                  key={membership.group_id}
                  className="rounded-lg border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">{membership.group_id}</span>
                    {group?.subject ? (
                      <span className="text-sm text-muted-foreground">Subject: {group.subject}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground uppercase">Role: {membership.role}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
