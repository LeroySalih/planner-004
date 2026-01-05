"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { getSessionProfileAction } from "@/lib/server-updates"

type NavState =
  | { status: "loading" }
  | { status: "visitor" }
  | { status: "teacher"; userId: string }
  | { status: "pupil"; userId: string }

type TeacherNavLinksProps = {
  onNavigate?: () => void
}

export function TeacherNavLinks({ onNavigate }: TeacherNavLinksProps) {
  const [state, setState] = useState<NavState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const session = await getSessionProfileAction()
        if (cancelled) return
        if (!session) {
          setState({ status: "visitor" })
          return
        }

        setState(
          session.isTeacher
            ? { status: "teacher", userId: session.userId }
            : { status: "pupil", userId: session.userId },
        )
      } catch (error) {
        if (cancelled) return
        console.error("Failed to load nav session", error)
        setState({ status: "visitor" })
      }
    }

    void load()

    const handleAuthChange = () => {
      void load()
    }

    if (typeof window !== "undefined") {
      window.addEventListener("auth-state-changed", handleAuthChange)
    }

    return () => {
      cancelled = true
      if (typeof window !== "undefined") {
        window.removeEventListener("auth-state-changed", handleAuthChange)
      }
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
          onClick={onNavigate}
        >
          SoW
        </Link>
        <Link
          href="/groups"
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          Groups
        </Link>
        <Link
          href="/units"
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          Units
        </Link>
        <Link
          href="/reports"
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          Reports
        </Link>
        <Link
          href="/queue"
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          Queue
        </Link>
        <Link
          href="/curriculum"
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={onNavigate}
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
          onClick={onNavigate}
        >
          My Units
        </Link>
        <Link
          href={`/reports/${encodeURIComponent(state.userId)}`}
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          Dashboard
        </Link>
      </>
    )
  }

  return null
}
