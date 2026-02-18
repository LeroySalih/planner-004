"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"

import { getSessionProfileAction } from "@/lib/server-updates"

type NavState =
  | { status: "loading" }
  | { status: "visitor" }
  | { status: "authenticated"; userId: string; roles: string[] }

type TeacherNavLinksProps = {
  onNavigate?: () => void
}

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { cn } from "@/lib/utils"

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
      <NavigationMenu>
        <NavigationMenuList>
          {isTeacher && (
            <>
              {/* Planning Dropdown */}
              <NavigationMenuItem>
                <NavigationMenuTrigger>Planning</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px]">
                    <ListItem href="/specifications" title="Specs" onClick={onNavigate}>
                      Manage subject specifications
                    </ListItem>
                    <ListItem href="/curriculum" title="Curriculum" onClick={onNavigate}>
                      View complete curriculum
                    </ListItem>
                    <ListItem href="/assignments" title="SoW" onClick={onNavigate}>
                      Schemes of Work
                    </ListItem>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>

              {/* Resources Dropdown */}
              <NavigationMenuItem>
                <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid gap-3 p-6 md:w-[400px] lg:w-[500px]">
                    <ListItem href="/units" title="Units" onClick={onNavigate}>
                      Manage resource units
                    </ListItem>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>

              {/* Feedback Dropdown */}
              <NavigationMenuItem>
                <NavigationMenuTrigger>Feedback</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid gap-3 p-6 md:w-[400px] lg:w-[500px]">
                    <ListItem href="/reports" title="Dashboards" onClick={onNavigate}>
                      View class dashboards
                    </ListItem>
                    <ListItem href="/reports" title="Reports" onClick={onNavigate}>
                      View pupil reports
                    </ListItem>
                    <ListItem href="/unit-progress-reports" title="Unit Progress" onClick={onNavigate}>
                      Monitor class progress by units
                    </ListItem>
                    <ListItem href="/lo-progress-reports" title="LO Progress" onClick={onNavigate}>
                      Monitor class progress by learning objectives
                    </ListItem>
                    <ListItem href="/feedback/peer-review" title="Peer Review" onClick={onNavigate}>
                      View peer review comments across lessons
                    </ListItem>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </>
          )}

          {/* Admin Dropdown */}
          {(isAdmin || isTechnician) && (
             <NavigationMenuItem>
               <NavigationMenuTrigger>Admin</NavigationMenuTrigger>
               <NavigationMenuContent>
                 <ul className="grid gap-3 p-6 md:w-[400px] lg:w-[500px]">
                   {isAdmin && (
                     <>
                        <ListItem href="/admin" title="Admin" onClick={onNavigate}>
                          System administration
                        </ListItem>
                        <ListItem href="/groups" title="Groups" onClick={onNavigate}>
                          Manage teaching groups
                        </ListItem>
                        <ListItem href="/ai-queue" title="AI Queue" onClick={onNavigate}>
                          Manage AI processing queue
                        </ListItem>
                        <ListItem href="/admin/safety-logs" title="Safety Logs" onClick={onNavigate}>
                          View flagged AI submissions
                        </ListItem>
                        <ListItem href="/queue" title="Queue" onClick={onNavigate}>
                          Manage file processing queue
                        </ListItem>
                     </>
                   )}
                   {isTechnician && !isAdmin && (
                      <ListItem href="/queue" title="Queue" onClick={onNavigate}>
                        Manage file processing queue
                      </ListItem>
                   )}
                 </ul>
               </NavigationMenuContent>
             </NavigationMenuItem>
          )}

          {/* Pupil Links (Top Level) */}
          {isPupil && (
            <>
              <NavigationMenuItem>
                <NavigationMenuLink asChild onClick={onNavigate}>
                  <Link href={`/pupil-lessons/${encodeURIComponent(userId)}`} className={navigationMenuTriggerStyle()}>
                    My Units
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild onClick={onNavigate}>
                  <Link href="/tasks" className={navigationMenuTriggerStyle()}>
                    My Tasks
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild onClick={onNavigate}>
                  <Link href="/flashcards" className={navigationMenuTriggerStyle()}>
                    Flashcards
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                 <NavigationMenuLink asChild onClick={onNavigate}>
                  <Link href="/specifications" className={navigationMenuTriggerStyle()}>
                    Specs
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild onClick={onNavigate}>
                  <Link href={`/reports/${encodeURIComponent(userId)}`} className={navigationMenuTriggerStyle()}>
                    My Reports
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </>
          )}
        </NavigationMenuList>
      </NavigationMenu>
    )
  }

  return null
}

const ListItem = React.forwardRef<
  React.ElementRef<"a">,
  React.ComponentPropsWithoutRef<"a"> & { title: string; href: string }
>(({ className, title, children, href, onClick, ...props }, ref) => {
  return (
    <li>
      <NavigationMenuLink asChild>
        <Link
          ref={ref as any}
          href={href}
          onClick={onClick as any}
          className={cn(
            "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
            className
          )}
          {...props}
        >
          <div className="text-sm font-medium leading-none">{title}</div>
          <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
            {children}
          </p>
        </Link>
      </NavigationMenuLink>
    </li>
  )
})
ListItem.displayName = "ListItem"
