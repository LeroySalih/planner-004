"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, UserPlus } from "lucide-react"

import type { ReportsPupilListing } from "@/types"
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/components/ui/use-toast"
import { addGroupMemberAction, listPupilsWithGroupsAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"

interface AddMemberDialogProps {
  groupId: string
}

export function AddMemberDialog({ groupId }: AddMemberDialogProps) {
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pupils, setPupils] = useState<ReportsPupilListing[]>([])
  const [loadingPupils, setLoadingPupils] = useState(false)
  const [selectedPupilId, setSelectedPupilId] = useState<string>("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    setLoadingPupils(true)
    listPupilsWithGroupsAction()
      .then((data) => setPupils(data))
      .finally(() => setLoadingPupils(false))
  }, [open])

  const eligiblePupils = pupils
    .filter((p) => !p.isTeacher)
    .filter((p) => !p.groups.some((g) => g.group_id === groupId))

  const selectedPupil = eligiblePupils.find((p) => p.pupilId === selectedPupilId) ?? null

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setSelectedPupilId("")
    }
  }

  async function handleAdd() {
    if (!selectedPupilId) return

    startTransition(async () => {
      try {
        const result = await addGroupMemberAction({ groupId, userId: selectedPupilId })

        if (result.success) {
          toast({
            title: "Pupil added",
            description: `${selectedPupil?.pupilName ?? "Pupil"} was added to this group.`,
          })
          handleOpenChange(false)
          router.refresh()
        } else {
          toast({
            variant: "destructive",
            title: "Add failed",
            description: result.error ?? "Unknown error occurred.",
          })
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Add failed",
          description: "An unexpected error occurred.",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2 bg-white text-black hover:bg-slate-100">
          <UserPlus className="h-4 w-4" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Member</DialogTitle>
          <DialogDescription>
            Search for a pupil by name or email to add them directly to this group.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                className="w-full justify-start font-normal"
              >
                {selectedPupil ? selectedPupil.pupilName : "Select a pupil..."}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0">
              <Command>
                <CommandInput placeholder="Search by name or email..." />
                <CommandList>
                  <CommandEmpty>
                    {loadingPupils ? "Loading pupils..." : "No eligible pupils found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {eligiblePupils.map((pupil) => (
                      <CommandItem
                        key={pupil.pupilId}
                        value={`${pupil.pupilName} ${pupil.pupilEmail ?? ""}`}
                        onSelect={() => {
                          setSelectedPupilId(pupil.pupilId)
                          setPickerOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedPupilId === pupil.pupilId ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{pupil.pupilName}</span>
                          {pupil.pupilEmail ? (
                            <span className="text-xs text-slate-500">{pupil.pupilEmail}</span>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!selectedPupilId || isPending} className="text-black">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
