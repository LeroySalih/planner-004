import type { ReactNode } from "react"

/**
 * For activity types with no read-only mode of their own (flashcards, sketch,
 * review others' work): when the lesson is locked, the pupil can still see the
 * activity but cannot interact with it. The server refuses the writes anyway;
 * this stops the page offering them.
 */
export function LockedWhen({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (!locked) return <>{children}</>
  return (
    <div className="space-y-2">
      <div inert className="opacity-70">
        {children}
      </div>
      <p className="text-center text-xs text-muted-foreground">This lesson is locked, so this activity is view only.</p>
    </div>
  )
}
