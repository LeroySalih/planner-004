import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import Link from 'next/link'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Planner',
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
          <header className="border-b bg-card">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
              <Link href="/" className="text-lg font-semibold text-primary">
                Planner
              </Link>
              <nav className="flex items-center gap-4 text-sm font-medium">
                <Link
                  href="/assignments"
                  className="text-muted-foreground transition-colors hover:text-primary"
                >
                  Assignments
                </Link>
                <Link
                  href="/units"
                  className="text-muted-foreground transition-colors hover:text-primary"
                >
                  Units
                </Link>
              </nav>
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
