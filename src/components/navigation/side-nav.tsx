"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getSessionProfileAction } from "@/lib/server-updates"

type NavState =
  | { status: "loading" }
  | { status: "visitor" }
  | { status: "authenticated"; userId: string; displayName: string; roles: string[] }

type SideNavProps = {
  onNavigate?: () => void
}

function NavLink({
  href,
  children,
  onNavigate,
}: {
  href: string
  children: React.ReactNode
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const isActive = pathname === href

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-accent text-accent-foreground font-medium"
      )}
    >
      {children}
    </Link>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start px-3 py-1.5 text-sm font-normal h-auto"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark
        ? <Sun className="mr-2 size-4 shrink-0" aria-hidden="true" />
        : <Moon className="mr-2 size-4 shrink-0" aria-hidden="true" />}
      {isDark ? "Light mode" : "Dark mode"}
    </Button>
  )
}

export function SideNav({ onNavigate }: SideNavProps) {
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
        const first = session.firstName?.trim() ?? ""
        const last = session.lastName?.trim() ?? ""
        const combined = `${first} ${last}`.trim()
        const displayName = combined.length > 0 ? combined : (session.email ?? session.userId)
        setState({ status: "authenticated", userId: session.userId, displayName, roles: session.roles })
      } catch {
        if (cancelled) return
        setState({ status: "visitor" })
      }
    }

    void load()

    const handleAuthChange = () => void load()
    window.addEventListener("auth-state-changed", handleAuthChange)

    return () => {
      cancelled = true
      window.removeEventListener("auth-state-changed", handleAuthChange)
    }
  }, [])

  if (state.status === "loading" || state.status === "visitor") {
    return null
  }

  const { roles, userId, displayName } = state
  const isTeacher = roles.includes("teacher")
  const isPupil = roles.includes("pupil")
  const isAdmin = roles.includes("admin")
  const isTechnician = roles.includes("technician")

  const defaultOpen = [
    isTeacher && "planning",
    isTeacher && "resources",
    isTeacher && "feedback",
    (isAdmin || isTechnician) && "admin",
    isPupil && "pupil-tools",
  ].filter(Boolean) as string[]

  return (
    <nav className="flex h-full flex-col">
      {/* Scrollable nav sections */}
      <div className="flex-1 overflow-y-auto p-2">
        <Accordion type="multiple" defaultValue={defaultOpen} className="w-full">
          {isTeacher && (
            <>
              <AccordionItem value="planning">
                <AccordionTrigger className="px-3 py-2 text-sm font-semibold">
                  Planning
                </AccordionTrigger>
                <AccordionContent className="pb-1">
                  <div className="flex flex-col gap-0.5">
                    <NavLink href="/specifications" onNavigate={onNavigate}>Specs</NavLink>
                    <NavLink href="/curriculum" onNavigate={onNavigate}>Curriculum</NavLink>
                    <NavLink href="/assignments" onNavigate={onNavigate}>SoW</NavLink>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="resources">
                <AccordionTrigger className="px-3 py-2 text-sm font-semibold">
                  Resources
                </AccordionTrigger>
                <AccordionContent className="pb-1">
                  <div className="flex flex-col gap-0.5">
                    <NavLink href="/units" onNavigate={onNavigate}>Units</NavLink>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="feedback">
                <AccordionTrigger className="px-3 py-2 text-sm font-semibold">
                  Feedback
                </AccordionTrigger>
                <AccordionContent className="pb-1">
                  <div className="flex flex-col gap-0.5">
                    <NavLink href="/reports" onNavigate={onNavigate}>Dashboards</NavLink>
                    <NavLink href="/reports" onNavigate={onNavigate}>Reports</NavLink>
                    <NavLink href="/unit-progress-reports" onNavigate={onNavigate}>Unit Progress</NavLink>
                    <NavLink href="/lo-progress-reports" onNavigate={onNavigate}>LO Progress</NavLink>
                    <NavLink href="/feedback/peer-review" onNavigate={onNavigate}>Peer Review</NavLink>
                    <NavLink href="/flashcard-monitor" onNavigate={onNavigate}>Flashcard Monitor</NavLink>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </>
          )}

          {(isAdmin || isTechnician) && (
            <AccordionItem value="admin">
              <AccordionTrigger className="px-3 py-2 text-sm font-semibold">
                Admin
              </AccordionTrigger>
              <AccordionContent className="pb-1">
                <div className="flex flex-col gap-0.5">
                  {isAdmin && (
                    <>
                      <NavLink href="/admin" onNavigate={onNavigate}>Admin</NavLink>
                      <NavLink href="/groups" onNavigate={onNavigate}>Groups</NavLink>
                      <NavLink href="/ai-queue" onNavigate={onNavigate}>AI Queue</NavLink>
                      <NavLink href="/admin/safety-logs" onNavigate={onNavigate}>Safety Logs</NavLink>
                      <NavLink href="/queue" onNavigate={onNavigate}>Queue</NavLink>
                    </>
                  )}
                  {isTechnician && !isAdmin && (
                    <NavLink href="/queue" onNavigate={onNavigate}>Queue</NavLink>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {isPupil && (
            <AccordionItem value="pupil-tools">
              <AccordionTrigger className="px-3 py-2 text-sm font-semibold">
                Pupil Tools
              </AccordionTrigger>
              <AccordionContent className="pb-1">
                <div className="flex flex-col gap-0.5">
                  <NavLink href={`/pupil-lessons/${encodeURIComponent(userId)}`} onNavigate={onNavigate}>My Units</NavLink>
                  <NavLink href="/tasks" onNavigate={onNavigate}>My Tasks</NavLink>
                  <NavLink href="/flashcards" onNavigate={onNavigate}>Flashcards</NavLink>
                  <NavLink href="/specifications" onNavigate={onNavigate}>Specs</NavLink>
                  <NavLink href={`/reports/${encodeURIComponent(userId)}`} onNavigate={onNavigate}>My Reports</NavLink>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>

      {/* User footer — always visible at bottom */}
      <div className="shrink-0 border-t">
        <Accordion type="single" collapsible defaultValue="user">
          <AccordionItem value="user" className="border-0">
            <AccordionTrigger className="px-3 py-2 text-sm font-semibold">
              {displayName}
            </AccordionTrigger>
            <AccordionContent className="pb-2">
              <div className="flex flex-col gap-0.5">
                <NavLink href={`/profiles/${encodeURIComponent(userId)}`} onNavigate={onNavigate}>
                  Profile
                </NavLink>
                <ThemeToggle />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </nav>
  )
}
