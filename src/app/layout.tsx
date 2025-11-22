import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

import "./globals.css"

import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "sonner"

import { TopBar } from "@/components/navigation/top-bar"

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
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          <TopBar />
          <main className="flex-1">{children}</main>
        </div>
        <Analytics />
        <Toaster />
      </body>
    </html>
  )
}
