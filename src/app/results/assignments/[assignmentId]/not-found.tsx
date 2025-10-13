import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function AssignmentResultsNotFound() {
  return (
    <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center space-y-4 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Assignment not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          We couldn&apos;t find the assignment you were looking for. It might have been removed or you may not have access.
        </p>
      </div>
      <Button asChild>
        <Link href="/assignments">Back to assignments</Link>
      </Button>
    </div>
  )
}
