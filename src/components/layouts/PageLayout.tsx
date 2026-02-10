import { ReactNode } from "react"
import { PageBreadcrumbs, type BreadcrumbItem } from "@/components/common/PageBreadcrumbs"

type MaxWidth = "4xl" | "5xl" | "6xl" | "7xl" | "full"

type PageLayoutProps = {
  children: ReactNode
  maxWidth?: MaxWidth
  title?: string
  subtitle?: string
  breadcrumbs?: BreadcrumbItem[]
  headerAction?: ReactNode
}

const maxWidthClasses: Record<MaxWidth, string> = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
  "full": "max-w-full",
}

export function PageLayout({
  children,
  maxWidth = "7xl",
  title,
  subtitle,
  breadcrumbs,
  headerAction,
}: PageLayoutProps) {
  return (
    <main
      className={`mx-auto flex w-full ${maxWidthClasses[maxWidth]} flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10`}
    >
      {(title || breadcrumbs) && (
        <header className="space-y-2">
          {breadcrumbs && <PageBreadcrumbs items={breadcrumbs} />}

          {title && (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h1 className="text-3xl font-bold text-foreground">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
              </div>
              {headerAction && <div>{headerAction}</div>}
            </div>
          )}
        </header>
      )}

      {children}
    </main>
  )
}
