'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { setAssessmentFeedbackVisibleAction } from '@/lib/server-updates'
import { cn } from '@/lib/utils'

/** Releasing is confirmed first because pupils see their marks the moment it is on. */
export function FeedbackReleaseSwitch({ assessmentId, visible }: { assessmentId: string; visible: boolean }) {
  const [released, setReleased] = useState(visible)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => setReleased(visible), [visible])

  const apply = (next: boolean) => {
    startTransition(async () => {
      const { data, error } = await setAssessmentFeedbackVisibleAction(assessmentId, next)
      if (error || !data) {
        toast.error(error ?? 'Could not change feedback release')
        return
      }
      setReleased(data.feedback_visible)
      toast.success(data.feedback_visible ? 'Feedback released to pupils' : 'Feedback hidden from pupils')
    })
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2',
        released ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950' : 'bg-muted/40',
      )}
    >
      <Switch
        id="release-feedback"
        checked={released}
        disabled={pending}
        onCheckedChange={(next) => (next ? setConfirming(true) : apply(false))}
      />
      <Label htmlFor="release-feedback" className="flex flex-col items-start gap-0">
        <span className="font-medium">Release feedback to pupils</span>
        <span className="text-xs text-muted-foreground">
          {released ? 'On: pupils can see their marks and feedback' : 'Off: pupils see nothing yet'}
        </span>
      </Label>
      {pending && <Loader2 className="size-4 animate-spin" />}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release feedback to pupils?</AlertDialogTitle>
            <AlertDialogDescription>
              Every pupil on this paper will be able to see their marks, comments, what went well and targets.
              You can switch it off again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => apply(true)}>Release</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
