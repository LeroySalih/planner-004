"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { getSessionProfileAction } from "@/lib/server-updates"

type NavState =
  | { status: "loading" }
  | { status: "visitor" }
  | { status: "authenticated"; userId: string; roles: string[] }

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

        setState({
          status: "authenticated",
          userId: session.userId,
          roles: session.roles,
        })
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

  if (state.status === "authenticated") {
    const { roles, userId } = state
    const isTeacher = roles.includes("teacher")
    const isPupil = roles.includes("pupil")
    const isTechnician = roles.includes("technician")
    const isAdmin = roles.includes("admin")

    return (
      <>
        {isTeacher && (
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
              href="/curriculum"
              className="text-muted-foreground transition-colors hover:text-primary"
              onClick={onNavigate}
            >
              Curriculum
            </Link>
          </>
        )}
        {isTechnician && (
          <Link
            href="/queue"
            className="text-muted-foreground transition-colors hover:text-primary"
            onClick={onNavigate}
          >
            Queue
          </Link>
        )}
        {isPupil && (
          <>
            <Link
              href={`/pupil-lessons/${encodeURIComponent(userId)}`}
              className="text-muted-foreground transition-colors hover:text-primary"
              onClick={onNavigate}
            >
              My Units
            </Link>
            <Link
              href={`/reports/${encodeURIComponent(userId)}`}
              className="text-muted-foreground transition-colors hover:text-primary"
              onClick={onNavigate}
            >
              Dashboard
            </Link>
          </>
        )}
        {isAdmin && (
          <Link
            href="/admin"
            className="font-semibold text-primary transition-colors hover:text-primary/80"
            onClick={onNavigate}
          >
            Admin
          </Link>
        )}
      </>
    )
  }

  return null
}
