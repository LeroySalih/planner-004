import { listSpecificationsAction } from "@/lib/server-actions/specifications"

export const dynamic = "force-dynamic"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function SpecificationsPage() {
  const result = await listSpecificationsAction()
  
  if (!result.success || !result.data) {
    return <div className="p-8 text-destructive">Failed to load specifications.</div>
  }

  const specifications = result.data

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Subject Specifications</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {specifications.map((spec) => (
          <Link href={`/specifications/${spec.specification_id}`} key={spec.specification_id}>
            <Card className="hover:bg-muted/50 transition-colors h-full">
              <CardHeader>
                <CardTitle>{spec.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm space-y-1">
                <p>Subject: {spec.subject}</p>
                {spec.exam_board && <p>Exam Board: {spec.exam_board}</p>}
                {spec.level && <p>Level: {spec.level}</p>}
              </CardContent>
            </Card>
          </Link>
        ))}

        {specifications.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No specifications found.
          </div>
        )}
      </div>
    </div>
  )
}
