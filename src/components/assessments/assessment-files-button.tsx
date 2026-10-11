'use client'

import { useState } from 'react'
import { Paperclip } from 'lucide-react'

import { AssessmentFilesDialog } from '@/components/assessments/assessment-files-dialog'
import { Button } from '@/components/ui/button'

type Props = { assessmentId: string; title: string }

/** Opens the paper's Scans & files dialog from the paper page. */
export function AssessmentFilesButton({ assessmentId, title }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Paperclip className="size-4" />
        Scans &amp; files
      </Button>
      <AssessmentFilesDialog assessmentId={assessmentId} title={title} open={open} onOpenChange={setOpen} />
    </>
  )
}
