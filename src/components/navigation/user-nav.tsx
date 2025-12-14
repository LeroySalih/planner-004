"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreVertical } from "lucide-react"

import { getSessionProfileAction, signoutAction } from "@/lib/server-updates"
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
  const [isPending, startTransition] = useTransition()

  const loadProfile = useCallback(async () => {
    setProfile(undefined)
    const session = await getSessionProfileAction()
    if (!session) {
      setProfile(null)
      return
    }

    const first = session.firstName?.trim() ?? ""
    const last = session.lastName?.trim() ?? ""
    const combined = `${first} ${last}`.trim()
    const displayName = combined.length > 0 ? combined : session.email ?? session.userId

    setProfile({
      userId: session.userId,
      displayName,
      isTeacher: session.isTeacher,
    })
  }, [])

  useEffect(() => {
    void loadProfile()

    const handleProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{
        userId: string
        firstName?: string
        lastName?: string
      }>
      const detail = customEvent.detail
      if (!detail?.userId) {
        return
      }

      setProfile((previous) => {
        if (!previous || previous.userId !== detail.userId) {
          return previous
        }

        const first = detail.firstName?.trim() ?? ""
        const last = detail.lastName?.trim() ?? ""
        const combined = `${first} ${last}`.trim()

        return {
          ...previous,
          displayName: combined.length > 0 ? combined : previous.displayName,
        }
      })
    }

    window.addEventListener("profile-updated", handleProfileUpdated as EventListener)
    const handleAuthStateChanged = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status
      if (status === "signed-in") {
        void loadProfile()
      }
      if (status === "signed-out") {
        setProfile(null)
      }
    }
    window.addEventListener("auth-state-changed", handleAuthStateChanged as EventListener)

    return () => {
      window.removeEventListener("profile-updated", handleProfileUpdated as EventListener)
      window.removeEventListener("auth-state-changed", handleAuthStateChanged as EventListener)
    }
  }, [loadProfile])

  const handleSignOut = useCallback(async () => {
    startTransition(async () => {
      await signoutAction()
      setProfile(null)
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: { status: "signed-out" } }))
      }
      router.replace("/")
      router.refresh()
    })
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSignOutSelect} disabled={isPending}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
