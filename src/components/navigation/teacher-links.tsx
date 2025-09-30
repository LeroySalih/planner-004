"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { supabaseBrowserClient } from "@/lib/supabase-browser"

type NavState =
  | { status: "loading" }
  | { status: "visitor" }
  | { status: "teacher"; userId: string }
  | { status: "pupil"; userId: string }

export function TeacherNavLinks() {
  const [state, setState] = useState<NavState>({ status: "loading" })

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      const { data: authData } = await supabaseBrowserClient.auth.getUser()
      const user = authData?.user

      if (!user) {
        if (isMounted) {
          setState({ status: "visitor" })
        }
        return
      }

      const { data, error } = await supabaseBrowserClient
        .from("profiles")
        .select("is_teacher")
        .eq("user_id", user.id)
        .maybeSingle()

      if (!isMounted) return

      if (error) {
        console.error("Failed to determine teacher status", error)
        setState({ status: "pupil", userId: user.id })
        return
      }

      setState(data?.is_teacher ? { status: "teacher", userId: user.id } : { status: "pupil", userId: user.id })
    }

    const { data: listener } = supabaseBrowserClient.auth.onAuthStateChange(() => {
      void load()
    })

    void load()

    return () => {
      isMounted = false
      listener?.subscription.unsubscribe()
    }
  }, [])

  if (state.status === "loading") {
    return null
  }

  if (state.status === "teacher") {
    return (
      <>
        <Link
          href="/assignments"
          className="text-muted-foreground transition-colors hover:text-primary"
        >
          SoW
        </Link>
        <Link
          href="/groups"
          className="text-muted-foreground transition-colors hover:text-primary"
        >
          Groups
        </Link>
        <Link
          href="/units"
          className="text-muted-foreground transition-colors hover:text-primary"
        >
          Units
        </Link>
        <Link
          href="/reports"
          className="text-muted-foreground transition-colors hover:text-primary"
        >
          Reports
        </Link>
        <Link
          href="/curriculum"
          className="text-muted-foreground transition-colors hover:text-primary"
        >
          Curriculum
        </Link>
      </>
    )
  }

  if (state.status === "pupil") {
    return (
      <>
        <Link
          href={`/pupil-lessons/${encodeURIComponent(state.userId)}`}
          className="text-muted-foreground transition-colors hover:text-primary"
        >
          My Lessons
        </Link>
      </>
    )
  }

  return null
}
