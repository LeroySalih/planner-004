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
                <div className="sticky top-[80px] h-[calc(100vh-80px)]">
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
