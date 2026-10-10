'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteAssessmentAction, renameAssessmentAction, setAssessmentFeedbackVisibleAction } from '@/lib/server-updates'

type Props = { assessmentId: string; title: string; feedbackVisible: boolean }

export function AssessmentRowMenu({ assessmentId, title, feedbackVisible }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [confirmingRelease, setConfirmingRelease] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const [pending, startTransition] = useTransition()

  // Releasing is confirmed first, as on the paper page, because pupils see
  // their marks the moment it is on. Hiding applies straight away.
  const setReleased = (next: boolean) => {
    startTransition(async () => {
      const { data, error } = await setAssessmentFeedbackVisibleAction(assessmentId, next)
      if (error || !data) {
        toast.error(error ?? 'Could not change feedback release')
        return
      }
      setConfirmingRelease(false)
      toast.success(data.feedback_visible ? `Feedback released for ${title}` : `Feedback hidden for ${title}`)
      router.refresh()
    })
  }

  const rename = () => {
    const next = draftTitle.trim()
    if (!next) {
      toast.error('A title is required')
      return
    }
    startTransition(async () => {
      const { title: saved, error } = await renameAssessmentAction(assessmentId, next)
      if (error || !saved) {
        toast.error(error ?? 'Could not rename the assessment')
        return
      }
      setRenaming(false)
      toast.success(`Renamed to ${saved}`)
      router.refresh()
    })
  }

  const remove = () => {
    startTransition(async () => {
      const { success, error } = await deleteAssessmentAction(assessmentId)
      if (!success) {
        toast.error(error ?? 'Could not delete the assessment')
        return
      }
      setConfirming(false)
      toast.success(`Deleted ${title}`)
      router.refresh()
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" disabled={pending} aria-label={`Actions for ${title}`}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setDraftTitle(title)
              setRenaming(true)
            }}
          >
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          {feedbackVisible ? (
            <DropdownMenuItem onSelect={() => setReleased(false)}>
              <EyeOff className="size-4" />
              Hide feedback from pupils
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirmingRelease(true)}>
              <Eye className="size-4" />
              Release feedback to pupils
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirming(true)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={(open) => !pending && setRenaming(open)}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              rename()
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename assessment</DialogTitle>
              <DialogDescription>Pupils see the new title on their released papers.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={`rename-${assessmentId}`}>Title</Label>
              <Input
                id={`rename-${assessmentId}`}
                value={draftTitle}
                maxLength={200}
                autoFocus
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !draftTitle.trim() || draftTitle.trim() === title}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingRelease} onOpenChange={setConfirmingRelease}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release feedback for {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every pupil on this paper will be able to see their marks, comments, what went well and targets.
              You can switch it off again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                setReleased(true)
              }}
            >
              {pending ? 'Releasing…' : 'Release'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The paper disappears for teachers and pupils, including any feedback already released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                remove()
              }}
            >
              {pending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
