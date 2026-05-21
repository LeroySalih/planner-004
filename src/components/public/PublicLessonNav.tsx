import Link from "next/link"
import { Button } from "@/components/ui/button"

export function PublicLessonNav() {
  return (
    <nav className="flex items-center justify-between border-b border-border bg-background px-6 py-3">
      <Link href="/" className="text-lg font-bold text-foreground">
        🦕 Dino
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground hidden sm:block">
          Want to track your progress?
        </span>
        <Button asChild size="sm">
          <Link href="/signin">Sign in</Link>
        </Button>
      </div>
    </nav>
  )
}
