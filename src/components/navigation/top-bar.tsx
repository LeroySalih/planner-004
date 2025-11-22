"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Menu, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"

import { TeacherNavLinks } from "./teacher-links"
import { UserNav } from "./user-nav"

export function TopBar() {
  const [isClient, setIsClient] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  return (
    <header className="sticky top-0 z-50 border-b bg-card" style={{ height: "80px" }}>
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4 sm:px-6">
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

        <nav className="hidden items-center gap-4 text-sm font-medium md:flex">
          <TeacherNavLinks />
        </nav>

        <div className="hidden md:flex">
          <UserNav />
        </div>

        {isClient ? (
          <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Open navigation menu"
                className="md:hidden"
              >
                <Menu className="size-5" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="border-t">
              <DrawerHeader className="flex flex-row items-center justify-between">
                <DrawerTitle className="text-lg font-semibold text-foreground">Menu</DrawerTitle>
                <DrawerClose asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Close navigation menu">
                    <X className="size-5" />
                  </Button>
                </DrawerClose>
              </DrawerHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="flex flex-col gap-3 text-base font-medium">
                  <TeacherNavLinks onNavigate={() => setOpen(false)} />
                </div>
                <div className="rounded-lg border border-border bg-card/60 p-3 shadow-sm">
                  <UserNav />
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open navigation menu"
            className="md:hidden"
            disabled
          >
            <Menu className="size-5" />
          </Button>
        )}
      </div>
    </header>
  )
}
