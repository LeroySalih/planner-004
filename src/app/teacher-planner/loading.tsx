export default function TeacherPlannerLoading() {
  return (
    <main className="min-h-screen bg-[var(--color-background-tertiary)] p-8">
      <div className="max-w-[95%] mx-auto mb-6">
        <h1 className="text-xl font-medium text-[var(--color-text-primary)] m-0">
          Weekly planner
        </h1>
      </div>
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3 text-[var(--color-text-secondary)]">
          <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading planner…</span>
        </div>
      </div>
    </main>
  )
}
