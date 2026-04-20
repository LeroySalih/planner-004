"use client"

import { useEffect, useState } from "react"
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
import { getSessionProfileAction } from "@/lib/server-updates"

import { SideNav } from "./side-nav"

function SignInButton() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    getSessionProfileAction().then((session) => setIsSignedIn(!!session))

    const handler = (e: Event) => {
      const status = (e as CustomEvent<{ status?: string }>).detail?.status
      if (status === "signed-in") setIsSignedIn(true)
      if (status === "signed-out") setIsSignedIn(false)
    }
    window.addEventListener("auth-state-changed", handler)
    return () => window.removeEventListener("auth-state-changed", handler)
  }, [])

  if (isSignedIn !== false) return null

  return (
    <Button asChild size="sm">
      <Link href="/signin">Sign in</Link>
    </Button>
  )
}

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
            className="h-auto w-auto dark:hidden"
          />
          <Image
            src="/header-logo-dark.png"
            alt="Planner"
            width={48}
            height={16}
            priority
            className="hidden h-auto w-auto dark:block"
          />
          Dino
        </Link>

        <SignInButton />
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
