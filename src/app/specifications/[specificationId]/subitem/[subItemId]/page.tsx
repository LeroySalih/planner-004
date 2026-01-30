import { getSessionProfileAction } from "@/lib/server-updates"
import { readSubItemDetailAction, SubItem } from "@/lib/server-actions/specifications"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft, BookOpen, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface SubItemDetailPageProps {
  params: Promise<{
    specificationId: string
    subItemId: string
  }>
}

interface SubItemWithContext extends SubItem {
  key_idea_title: string;
  key_idea_number: string;
  unit_title: string;
  unit_number: string;
  specification_title: string;
  specification_id: string;
}

export default async function SubItemDetailPage({ params }: SubItemDetailPageProps) {
  const { specificationId, subItemId } = await params
  const result = await readSubItemDetailAction(subItemId)

  if (!result.success || !result.data) {
    if (result.error === "Sub Item not found") {
      notFound()
    }
    return <div className="p-8 text-destructive">Failed to load sub-item details.</div>
  }

  const { subItem: rawSubItem, linkedObjectives } = result.data
  const subItem = rawSubItem as unknown as SubItemWithContext
  
  const session = await getSessionProfileAction()
  const isTeacher = session?.roles.includes("teacher")
  const isPupil = session?.roles.includes("pupil")
  const userId = session?.userId

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-4xl">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1 text-muted-foreground hover:text-foreground">
          <Link href={`/specifications/${specificationId}`}>
            <ChevronLeft className="h-4 w-4" />
            Back to Specification
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-baseline gap-3">
             <span className="text-muted-foreground">{subItem.number}</span>
             {subItem.title}
          </h1>
          <div className="flex items-center gap-3 mt-2 text-muted-foreground">
            <span className="flex items-center gap-1">
              <BookOpen className="h-4 w-4" />
              {subItem.specification_title}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Layers className="h-4 w-4" />
              {subItem.unit_number} {subItem.unit_title}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <section>
           <h2 className="text-xl font-semibold mb-4">Linked Learning Objectives</h2>
           {linkedObjectives.length === 0 ? (
             <p className="text-muted-foreground italic">No learning objectives linked to this sub-item.</p>
           ) : (
             <div className="grid gap-4">
               {linkedObjectives.map((lo: any) => (
                 <Card key={lo.learning_objective_id}>
                   <CardHeader className="pb-2">
                     <CardTitle className="text-base font-medium flex justify-between items-start gap-4">
                       {lo.lo_title}
                       <Badge variant="secondary" className="font-normal shrink-0">
                         {lo.unit_title}
                       </Badge>
                     </CardTitle>
                   </CardHeader>
                   <CardContent>
                     <div className="space-y-3">
                       {lo.lessons.map((lesson: any) => (
                         <div key={lesson.lesson_id} className="text-sm text-muted-foreground space-y-1">
                           {(!isTeacher && !isPupil) && (
                             <div className="flex gap-2 items-center text-muted-foreground/70">
                               <span className="font-medium w-16">Lesson:</span>
                               <span>{lesson.lesson_title}</span>
                             </div>
                           )}
                           {isTeacher && (
                             <div className="flex gap-2 items-center">
                               <span className="font-medium w-16">Teacher:</span>
                               <Link 
                                 href={`/lessons/${lesson.lesson_id}`} 
                                 className="hover:underline flex items-center gap-1 text-primary"
                               >
                                 {lesson.lesson_title}
                               </Link>
                             </div>
                           )}
                           {isPupil && userId && lesson.is_assigned && (
                             <div className="flex gap-2 items-center">
                               <span className="font-medium w-16">Pupil:</span>
                               <Link 
                                 href={`/pupil-lessons/${encodeURIComponent(userId)}/lessons/${lesson.lesson_id}`} 
                                 className="hover:underline flex items-center gap-1 text-primary"
                               >
                                 {lesson.lesson_title}
                               </Link>
                             </div>
                           )}
                         </div>
                       ))}
                     </div>
                   </CardContent>
                 </Card>
               ))}
             </div>
           )}
        </section>
      </div>
    </div>
  )
}
