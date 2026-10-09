import type { Metadata } from "next"
import { connection } from "next/server"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

import "./globals.css"
import "katex/dist/katex.min.css"

import { Toaster } from "@/components/ui/sonner"

import { TopBar } from "@/components/navigation/top-bar"
import { ThemeProvider } from "@/components/theme-provider"
import { StaleDeploymentDetector } from "@/components/stale-deployment-detector"
import { isCodingSite } from "@/lib/app-env"

export async function generateMetadata(): Promise<Metadata> {
  await connection()
  // The coding site gets a red dino so its tabs can't be mistaken for the live site.
  const suffix = isCodingSite() ? "-coding" : ""
  return {
    title: "Dino",
    description: "mr-salih.org",
    generator: "open-ai & v0",
    icons: {
      icon: [
        { url: `/icons/favicon${suffix}.ico`, sizes: "48x48" },
        { url: `/icons/icon${suffix}.png`, type: "image/png", sizes: "512x512" },
      ],
      apple: { url: `/icons/apple-icon${suffix}.png`, sizes: "180x180" },
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Request time, not build time — see isCodingSite.
  await connection()
  const isCoding = isCodingSite()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="flex min-h-screen flex-col bg-background text-foreground">
            <TopBar isCoding={isCoding} />
            <div className="flex flex-1">
              <main className="min-w-0 flex-1">{children}</main>
            </div>
          </div>
          <Toaster />
          <StaleDeploymentDetector />
        </ThemeProvider>
      </body>
    </html>
  )
}
