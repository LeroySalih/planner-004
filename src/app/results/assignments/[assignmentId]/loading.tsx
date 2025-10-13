export default function AssignmentResultsLoading() {
  return (
    <div className="container mx-auto space-y-6 py-8">
      <div className="space-y-2">
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-[480px] animate-pulse rounded-lg bg-muted" />
    </div>
  )
}
