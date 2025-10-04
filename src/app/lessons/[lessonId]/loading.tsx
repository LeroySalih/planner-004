export default function Loading() {
  return (
    <div className="container mx-auto p-6">
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
          <p className="text-muted-foreground">Loading lesson...</p>
        </div>
      </div>
    </div>
  )
}
