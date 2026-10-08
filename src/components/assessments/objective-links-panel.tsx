'use client'

import { useRef, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { mapAssessmentObjectiveAction } from '@/lib/server-updates'
import type { AssessmentLinkableObjective, AssessmentPaperObjective } from '@/types'

const NONE = '__none'

type Props = {
  assessmentId: string
  curriculumTitle: string
  objectives: AssessmentPaperObjective[]
  linkable: AssessmentLinkableObjective[]
}

export function ObjectiveLinksPanel({ assessmentId, curriculumTitle, objectives: initial, linkable }: Props) {
  const [objectives, setObjectives] = useState(initial)
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  // Pickers are all disabled while a request runs; the counter is the backstop
  // so a stale reply can never overwrite a newer one.
  const latestRequest = useRef(0)

  const link = (code: string, value: string) => {
    const learningObjectiveId = value === NONE ? null : value
    const request = ++latestRequest.current
    setPendingCode(code)
    startTransition(async () => {
      const { data, error } = await mapAssessmentObjectiveAction({ assessmentId, code, learningObjectiveId })
      if (request !== latestRequest.current) return
      setPendingCode(null)
      if (error || !data) {
        toast.error(error ?? 'Could not update the link')
        return
      }
      setObjectives(data)
      toast.success(learningObjectiveId ? `${code} linked` : `${code} unlinked`)
    })
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Objectives</h2>
        <p className="text-sm text-muted-foreground">
          Link each objective printed on the paper to one {curriculumTitle} learning objective.
        </p>
      </div>
      <ul className="divide-y">
        {objectives.map((objective) => {
          const linkedElsewhere = new Map(
            objectives
              .filter((o) => o.code !== objective.code && o.learning_objective_id)
              .map((o) => [o.learning_objective_id!, o.code]),
          )
          const busy = pendingCode === objective.code
          return (
            <li key={objective.code} className="grid gap-2 py-3 md:grid-cols-[1fr_minmax(0,24rem)] md:items-center">
              <div className="space-y-1">
                <p>
                  <span className="mr-2 font-semibold">{objective.code}</span>
                  {objective.title}
                </p>
                {objective.learning_objective_title ? (
                  <p className="text-sm text-muted-foreground">Linked: {objective.learning_objective_title}</p>
                ) : (
                  <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">Not linked</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={objective.learning_objective_id ?? NONE}
                  disabled={pendingCode !== null}
                  onValueChange={(value) => link(objective.code, value)}
                >
                  <SelectTrigger className="w-full" aria-label={`Link ${objective.code}`}>
                    <SelectValue placeholder="Choose a learning objective" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[min(90vw,36rem)]">
                    <SelectItem value={NONE}>Not linked</SelectItem>
                    {linkable.map((lo) => {
                      const other = linkedElsewhere.get(lo.learning_objective_id)
                      return (
                        <SelectItem key={lo.learning_objective_id} value={lo.learning_objective_id} disabled={Boolean(other)}>
                          <span className="whitespace-normal">
                            {lo.spec_ref && !lo.title.startsWith(lo.spec_ref) && (
                              <span className="mr-1 text-muted-foreground">{lo.spec_ref}</span>
                            )}
                            {lo.title}
                            {other && <span className="ml-1 text-xs text-muted-foreground">(linked to {other})</span>}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {busy && <Loader2 className="size-4 shrink-0 animate-spin" />}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
