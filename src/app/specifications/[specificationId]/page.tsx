import { readSpecificationDetailAction, SubItem, SubItemPoint } from "@/lib/server-actions/specifications"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface SpecificationDetailProps {
  params: Promise<{
    specificationId: string
  }>
}

function getKeyIdeaStatusColor(keyIdea: any) {
  const total = keyIdea.sub_items.length;
  // If no sub-items, maybe keep it neutral or red? 
  // "If no sub item has a linked LO, make the Key Idea text red" implies if count(linked) == 0 -> Red.
  // If total is 0, then count(linked) is 0, so it should be red by that logic, 
  // or maybe neutral if it's just a placeholder. 
  // Let's assume neutral if absolutely empty to avoid shouting red at empty specs.
  if (total === 0) return "text-muted-foreground";

  const withLos = keyIdea.sub_items.filter((si: any) => si.linked_lo_count > 0).length;
  
  if (withLos === 0) return "text-red-600";
  if (withLos === total) return "text-green-600";
  return "text-amber-600";
}

export default async function SpecificationDetailPage({ params }: SpecificationDetailProps) {
  const { specificationId } = await params
  const result = await readSpecificationDetailAction(specificationId)

  if (!result.success || !result.data) {
    if (result.error === "Specification not found") {
      notFound()
    }
    return <div className="p-8 text-destructive">Failed to load specification.</div>
  }

  const spec = result.data

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1 text-muted-foreground hover:text-foreground">
          <Link href="/specifications">
            <ChevronLeft className="h-4 w-4" />
            Back to Specifications
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{spec.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-muted-foreground">
            <Badge variant="outline">{spec.subject}</Badge>
            {spec.exam_board && <span className="text-sm">• {spec.exam_board}</span>}
            {spec.level && <span className="text-sm">• {spec.level}</span>}
          </div>
        </div>
      </div>

      <div className="grid gap-12 lg:grid-cols-[280px_1fr] items-start">
        <aside className="hidden lg:block sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto pr-4">
          <nav className="space-y-6">
            {spec.units.map((unit) => (
              <div key={unit.unit_id} className="space-y-2">
                <a 
                  href={`#unit-${unit.unit_id}`}
                  className="block font-medium text-sm hover:text-primary transition-colors text-muted-foreground/90 hover:underline"
                >
                  <span className="text-muted-foreground mr-1">{unit.number}</span>
                  {unit.title}
                </a>
                
                {unit.key_ideas.length > 0 && (
                  <ul className="pl-4 space-y-1.5 border-l ml-1">
                    {unit.key_ideas.map((ki) => (
                      <li key={ki.key_idea_id}>
                        <a 
                          href={`#ki-${ki.key_idea_id}`}
                          className={`block text-xs hover:text-primary transition-colors line-clamp-1 ${getKeyIdeaStatusColor(ki)}`}
                          title={`${ki.number} ${ki.title}`}
                        >
                          <span className="font-medium mr-1">{ki.number}</span>
                          {ki.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {spec.units.length === 0 && (
              <p className="text-sm text-muted-foreground">No navigation items.</p>
            )}
          </nav>
        </aside>

        <div className="space-y-12 min-w-0">
          {spec.units.map((unit) => (
            <section key={unit.unit_id} id={`unit-${unit.unit_id}`} className="scroll-mt-8 space-y-6">
              <div className="border-b pb-4">
                <h2 className="text-2xl font-semibold flex items-baseline gap-3">
                  <span className="text-muted-foreground font-medium">{unit.number}</span>
                  {unit.title}
                </h2>
              </div>

              <div className="space-y-8 pl-4 sm:pl-8">
                {unit.key_ideas.map((keyIdea) => (
                  <div key={keyIdea.key_idea_id} id={`ki-${keyIdea.key_idea_id}`} className="scroll-mt-24 space-y-4">
                    <div className="space-y-2">
                      <h3 className={`text-xl font-medium flex items-baseline gap-3 ${getKeyIdeaStatusColor(keyIdea)}`}>
                        <span className="text-muted-foreground text-base">{keyIdea.number}</span>
                        {keyIdea.title}
                      </h3>
                      {keyIdea.description && (
                        <p className="text-muted-foreground pl-[calc(2em+0.75rem)] max-w-prose">
                          {keyIdea.description}
                        </p>
                      )}
                    </div>

                    {keyIdea.sub_items.length > 0 && (
                      <div className="pl-[calc(1em+1rem)] sm:pl-[calc(2em+1rem)] space-y-6">
                        {keyIdea.sub_items.map((subItem) => (
                          <div key={subItem.sub_item_id} className="space-y-2">
                            <h4 className="font-medium flex items-baseline gap-2">
                              <span className="text-muted-foreground text-sm min-w-[3em]">{subItem.number}</span>
                              {subItem.linked_lo_count > 0 ? (
                                <Link 
                                  href={`/specifications/${specificationId}/subitem/${subItem.sub_item_id}`}
                                  className="text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary transition-colors flex items-center gap-2"
                                >
                                  {subItem.title}
                                  <span className="text-xs font-normal text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full no-underline">
                                    {subItem.linked_lo_count} LOs
                                  </span>
                                </Link>
                              ) : (
                                <span>{subItem.title}</span>
                              )}
                            </h4>
                            
                            {subItem.points.length > 0 && (
                              <ul className="space-y-1 ml-[calc(3em+0.5rem)]">
                                {subItem.points.map((point) => (
                                  <li key={point.point_id} className="flex gap-2 text-sm text-foreground/90">
                                    <span className="text-muted-foreground font-medium w-4">{point.label}.</span>
                                    <span>{point.content}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {unit.key_ideas.length === 0 && (
                  <p className="text-muted-foreground text-sm italic">No key ideas yet.</p>
                )}
              </div>
            </section>
          ))}
          
          {spec.units.length === 0 && (
             <div className="py-12 text-center border rounded-lg bg-muted/20">
               <p className="text-muted-foreground">This specification has no content yet.</p>
             </div>
          )}
        </div>
      </div>
    </div>
  )
}
