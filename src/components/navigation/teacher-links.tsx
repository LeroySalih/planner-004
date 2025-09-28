"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { supabaseBrowserClient } from "@/lib/supabase-browser"

type TeacherState = "loading" | "teacher" | "pupil"

export function TeacherNavLinks() {
  const [state, setState] = useState<TeacherState>("loading")

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      const { data: authData } = await supabaseBrowserClient.auth.getUser()
      const user = authData?.user

      if (!user) {
        if (isMounted) {
          setState("pupil")
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
        setState("pupil")
        return
      }

      setState(data?.is_teacher ? "teacher" : "pupil")
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

  if (state !== "teacher") {
    return null
  }

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

