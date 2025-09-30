"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreVertical } from "lucide-react"

import { supabaseBrowserClient } from "@/lib/supabase-browser"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

type UserProfile = {
  userId: string
  displayName: string
  isTeacher: boolean
}

export function UserNav() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined)

  useEffect(() => {
    let isMounted = true

    const loadProfile = async () => {
      if (isMounted) {
        setProfile(undefined)
      }

      const { data: sessionData } = await supabaseBrowserClient.auth.getUser()
      const user = sessionData?.user

      if (!user) {
        if (isMounted) {
          setProfile(null)
        }
        return
      }

      const { data: profileData } = await supabaseBrowserClient
        .from("profiles")
        .select("first_name, last_name, is_teacher")
        .eq("user_id", user.id)
        .maybeSingle()

      const first = profileData?.first_name?.trim() ?? ""
      const last = profileData?.last_name?.trim() ?? ""
      const combined = `${first} ${last}`.trim()

      if (isMounted) {
        setProfile({
          userId: user.id,
          displayName: combined.length > 0 ? combined : user.email ?? user.id,
          isTeacher: Boolean(profileData?.is_teacher),
        })
      }
    }

    void loadProfile()

    const { data: authListener } = supabaseBrowserClient.auth.onAuthStateChange(() => {
      void loadProfile()
    })

    return () => {
      isMounted = false
      authListener?.subscription.unsubscribe()
    }
  }, [])

  const handleSignOut = useCallback(async () => {
    const { error } = await supabaseBrowserClient.auth.signOut()

    if (error) {
      console.error("Failed to sign out", error)
      return
    }

    setProfile(null)
    router.replace("/")
    router.refresh()
  }, [router])

  const handleSignOutSelect = useCallback(
    async (event: Event) => {
      event.preventDefault()
      await handleSignOut()
    },
    [handleSignOut],
  )

  if (profile === undefined) {
    return null
  }

  if (profile === null) {
    return (
      <Button asChild>
        <Link href="/signin">Sign in</Link>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/profiles/${profile.userId}`}
        className="rounded-full border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm underline-offset-4 hover:underline"
      >
        {profile.displayName}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open user menu"
            className="rounded-full"
          >
            <MoreVertical className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link href={`/reports/${encodeURIComponent(profile.userId)}`} className="w-full">
              Dashboard
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSignOutSelect}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
