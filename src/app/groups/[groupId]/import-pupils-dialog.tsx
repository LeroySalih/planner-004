"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Import, Loader2 } from "lucide-react"

import type { Group } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { importGroupMembersAction } from "@/lib/server-updates"

interface ImportPupilsDialogProps {
  targetGroupId: string
  availableGroups: Group[]
}

export function ImportPupilsDialog({ targetGroupId, availableGroups }: ImportPupilsDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string>("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { toast } = useToast()

  const eligibleGroups = availableGroups.filter((g) => g.group_id !== targetGroupId)

  async function handleImport() {
    if (!selectedGroupId) return

    startTransition(async () => {
      try {
        const result = await importGroupMembersAction({
          targetGroupId,
          sourceGroupId: selectedGroupId,
        })

        if (result.success) {
          toast({
            title: "Pupils imported",
            description: `Successfully imported ${result.count} pupils.`,
          })
          setOpen(false)
          setSelectedGroupId("")
          router.refresh()
        } else {
          toast({
            variant: "destructive",
            title: "Import failed",
            description: result.error ?? "Unknown error occurred.",
          })
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Import failed",
          description: "An unexpected error occurred.",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto flex items-center gap-2 bg-white text-black hover:bg-slate-100">
          <Import className="h-4 w-4" />
          Import Pupils
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import Pupils</DialogTitle>
          <DialogDescription>
            Import pupils from another group into this one. Duplicates will be skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="source-group">Source Group</Label>
            <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
              <SelectTrigger id="source-group">
                <SelectValue placeholder="Select a group..." />
              </SelectTrigger>
              <SelectContent>
                {eligibleGroups.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No other groups available
                  </SelectItem>
                ) : (
                  eligibleGroups.map((group) => (
                    <SelectItem key={group.group_id} value={group.group_id}>
                      {group.group_id} ({group.subject})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!selectedGroupId || isPending} className="text-black">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import Pupils
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
