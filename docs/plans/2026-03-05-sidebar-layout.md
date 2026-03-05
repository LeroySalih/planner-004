# Sidebar Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the top navigation bar dropdowns with an always-visible left sidebar (collapsible sections), leaving the top bar for logo and sign in/out only.

**Architecture:** Root layout switches from `flex-col` to a top bar + `flex-row` body (sidebar + main). A new `SideNav` component holds all nav links using Radix Accordion. On mobile, the sidebar is hidden and a hamburger in TopBar opens it as a Sheet overlay.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4, Radix UI Accordion + Sheet (already in `src/components/ui/`), Lucide icons.

---

### Task 1: Create the SideNav component

**Files:**
- Create: `src/components/navigation/side-nav.tsx`

This component handles both desktop (always-visible aside) and mobile (rendered inside Sheet from TopBar). It fetches the session client-side and renders role-appropriate nav sections using Radix Accordion.

**Step 1: Create the file**

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { cn } from "@/lib/utils"
import { getSessionProfileAction } from "@/lib/server-updates"

type NavState =
  | { status: "loading" }
  | { status: "visitor" }
  | { status: "authenticated"; userId: string; roles: string[] }

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
        setState({ status: "authenticated", userId: session.userId, roles: session.roles })
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

  const { roles, userId } = state
  const isTeacher = roles.includes("teacher")
  const isPupil = roles.includes("pupil")
  const isAdmin = roles.includes("admin")
  const isTechnician = roles.includes("technician")

  const defaultOpen = [
    isTeacher && "planning",
    isTeacher && "resources",
    isTeacher && "feedback",
    (isAdmin || isTechnician) && "admin",
  ].filter(Boolean) as string[]

  return (
    <nav className="flex flex-col gap-1 p-2">
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
      </Accordion>

      {isPupil && (
        <div className="flex flex-col gap-0.5 pt-1">
          <NavLink href={`/pupil-lessons/${encodeURIComponent(userId)}`} onNavigate={onNavigate}>My Units</NavLink>
          <NavLink href="/tasks" onNavigate={onNavigate}>My Tasks</NavLink>
          <NavLink href="/flashcards" onNavigate={onNavigate}>Flashcards</NavLink>
          <NavLink href="/specifications" onNavigate={onNavigate}>Specs</NavLink>
          <NavLink href={`/reports/${encodeURIComponent(userId)}`} onNavigate={onNavigate}>My Reports</NavLink>
        </div>
      )}
    </nav>
  )
}
```

**Step 2: Verify the file exists and has no obvious syntax issues**

Run: `pnpm build 2>&1 | head -40`

There's nothing to assert yet — we haven't wired it in. This just checks the file compiles.

**Step 3: Commit**

```bash
git add src/components/navigation/side-nav.tsx
git commit -m "feat: add SideNav component with collapsible accordion sections"
```

---

### Task 2: Update TopBar — simplify and add mobile sidebar trigger

**Files:**
- Modify: `src/components/navigation/top-bar.tsx`

Remove `TeacherNavLinks` and the mobile drawer that contained them. The TopBar keeps logo + `UserNav`. On mobile it gains a hamburger that opens the `SideNav` inside a `Sheet`.

**Step 1: Rewrite `top-bar.tsx`**

```tsx
"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { SideNav } from "./side-nav"
import { UserNav } from "./user-nav"

export function TopBar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b bg-card" style={{ height: "80px" }}>
      <div className="flex h-full w-full items-center justify-between px-4 sm:px-6">
        {/* Mobile hamburger */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation menu"
          className="md:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-5" />
        </Button>

        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/header-logo.png"
            alt="Planner"
            width={48}
            height={16}
            priority
            className="h-auto w-auto"
          />
          Dino
        </Link>

        <UserNav />
      </div>

      {/* Mobile sidebar sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-left text-base font-semibold">Menu</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto">
            <SideNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  )
}
```

**Step 2: Check the build compiles**

Run: `pnpm build 2>&1 | head -40`
Expected: no TypeScript errors related to top-bar or side-nav

**Step 3: Commit**

```bash
git add src/components/navigation/top-bar.tsx
git commit -m "feat: simplify TopBar to logo+UserNav, add mobile sidebar Sheet"
```

---

### Task 3: Update root layout to sidebar + full-width content

**Files:**
- Modify: `src/app/layout.tsx`

Change the body from `flex-col` to a structure where the area below TopBar is `flex-row`: sidebar on the left (desktop only), main content taking the rest.

**Step 1: Rewrite `layout.tsx`**

```tsx
import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

import "./globals.css"

import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/sonner"

import { TopBar } from "@/components/navigation/top-bar"
import { SideNav } from "@/components/navigation/side-nav"
import { ThemeProvider } from "@/components/theme-provider"

export const metadata: Metadata = {
  title: "Dino",
  description: "mr-salih.org",
  generator: "open-ai & v0",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="flex min-h-screen flex-col bg-background text-foreground">
            <TopBar />
            <div className="flex flex-1">
              {/* Desktop sidebar */}
              <aside className="hidden w-60 shrink-0 border-r md:block">
                <div className="sticky top-[80px] h-[calc(100vh-80px)] overflow-y-auto">
                  <SideNav />
                </div>
              </aside>
              <main className="min-w-0 flex-1">{children}</main>
            </div>
          </div>
          <Analytics />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
```

**Step 2: Run the dev server and visually verify**

Run: `pnpm dev`

Check in browser:
- Desktop (>768px): sidebar visible on left, content full-width to the right
- TopBar has logo + UserNav only (no dropdown menus)
- Mobile (<768px): no sidebar, hamburger visible in TopBar, clicking it opens Sheet with nav

**Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: switch root layout to sidebar + full-width main content"
```

---

### Task 4: Delete teacher-links.tsx

**Files:**
- Delete: `src/components/navigation/teacher-links.tsx`

This file is now dead code — all its logic lives in `SideNav`.

**Step 1: Verify nothing imports it**

Run: `grep -r "teacher-links" src/`
Expected: no output (nothing imports it after TopBar was updated)

**Step 2: Delete the file**

Run: `rm src/components/navigation/teacher-links.tsx`

**Step 3: Build to confirm no broken imports**

Run: `pnpm build 2>&1 | grep -E "error|Error"`
Expected: no errors

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove teacher-links.tsx, replaced by side-nav"
```

---

### Task 5: Update existing navigation tests

**Files:**
- Modify: `tests/navigation/teacher-navigation.spec.ts`

The existing test checks links are visible after sign-in. With the sidebar always expanded, links like "SoW", "Groups", "Units", "Reports", "Curriculum" will now be visible as sidebar links (not inside dropdown menus that need clicking first). The assertions should still pass but verify the test still works correctly.

**Step 1: Run the existing navigation tests**

Run: `pnpm test tests/navigation/teacher-navigation.spec.ts`

Expected: PASS — sidebar links are directly visible without needing to open dropdowns

**Step 2: If any assertions fail, update selectors**

The test checks:
```ts
await expect(page.getByRole("link", { name: "SoW", exact: true })).toBeVisible()
await expect(page.getByRole("link", { name: "Groups", exact: true })).toBeVisible()
await expect(page.getByRole("link", { name: "Units", exact: true })).toBeVisible()
await expect(page.getByRole("link", { name: "Reports", exact: true })).toBeVisible()
await expect(page.getByRole("link", { name: "Curriculum", exact: true })).toBeVisible()
```

These should pass as-is since sidebar links are always visible. The old dropdown-opening steps (if any) should be removed if they exist. Check for any `.click()` calls that opened dropdown menus and remove them.

**Step 3: Commit if tests pass (or after fixing)**

```bash
git add tests/navigation/teacher-navigation.spec.ts
git commit -m "test: verify navigation tests pass with sidebar layout"
```
