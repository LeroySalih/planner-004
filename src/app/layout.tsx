import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import Link from "next/link"
import { Analytics } from "@vercel/analytics/next"
import Image from "next/image"

import "./globals.css"
import { Toaster } from "sonner"

import { UserNav } from "@/components/navigation/user-nav"

export const metadata: Metadata = {
  title: 'Dino',
  description: 'mr-salih.org',
  generator: 'open-ai & v0',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          <header className="sticky top-0 z-50 border-b bg-card" style={{ height: '80px' }}>
            <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-6">
              <Link href="/" className="flex items-center gap-3">
                <Image src="/header-logo.png" alt="Planner" width={48} height={16} priority />
                Dino
              </Link>
              <nav className="flex items-center gap-4 text-sm font-medium">
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
              </nav>
              <UserNav />
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
        <Analytics />
        <Toaster />
      </body>
    </html>
  )
}
