import { requireRole } from "@/lib/auth"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireRole("admin")

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-muted/40">
        <div className="container flex h-14 items-center gap-4 px-4 lg:h-[60px] lg:px-6">
          <div className="font-semibold">Admin Console</div>
        </div>
      </header>
      <main className="flex-1 p-4 lg:p-6">{children}</main>
    </div>
  )
}
