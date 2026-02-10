import { ReactNode } from "react"
import { redirect } from "next/navigation"
import { requireAuthenticatedProfile } from "@/lib/auth"
import { PageLayout } from "./PageLayout"
import { type BreadcrumbItem } from "@/components/common/PageBreadcrumbs"

type MaxWidth = "4xl" | "5xl" | "6xl" | "7xl" | "full"

type TeacherPageLayoutProps = {
  children: ReactNode
  maxWidth?: MaxWidth
  title?: string
  subtitle?: string
  breadcrumbs?: BreadcrumbItem[]
  headerAction?: ReactNode
}

/**
 * TeacherPageLayout - A layout component that requires teacher authentication
 *
 * Automatically handles:
 * - Authentication check
 * - Redirect to home if not a teacher
 * - Standard page layout
 *
 * Usage:
 * ```tsx
 * export default async function MyPage() {
 *   return (
 *     <TeacherPageLayout title="My Page" subtitle="Description">
 *       <MyComponent />
 *     </TeacherPageLayout>
 *   )
 * }
 * ```
 */
export async function TeacherPageLayout({
  children,
  maxWidth,
  title,
  subtitle,
  breadcrumbs,
  headerAction,
}: TeacherPageLayoutProps) {
  // Auth check - this runs on the server
  const profile = await requireAuthenticatedProfile()

  if (!profile.isTeacher) {
    redirect("/")
  }

  // If auth passes, render the page layout
  return (
    <PageLayout
      maxWidth={maxWidth}
      title={title}
      subtitle={subtitle}
      breadcrumbs={breadcrumbs}
      headerAction={headerAction}
    >
      {children}
    </PageLayout>
  )
}
