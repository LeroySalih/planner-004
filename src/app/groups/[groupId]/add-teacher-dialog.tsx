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

interface AddTeacherDialogProps {
  groupId: string
}

export function AddTeacherDialog({ groupId }: AddTeacherDialogProps) {
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [teachers, setTeachers] = useState<ReportsPupilListing[]>([])
  const [loadingTeachers, setLoadingTeachers] = useState(false)
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    setLoadingTeachers(true)
    listPupilsWithGroupsAction()
      .then((data) => setTeachers(data))
      .catch(() => {
        toast({
          variant: "destructive",
          title: "Failed to load teachers",
          description: "Could not load the teacher list. Please try again.",
        })
      })
      .finally(() => setLoadingTeachers(false))
  }, [open, toast])

  const eligibleTeachers = teachers
    .filter((p) => p.isTeacher)
    .filter((p) => !p.groups.some((g) => g.group_id === groupId))

  const selectedTeacher = eligibleTeachers.find((p) => p.pupilId === selectedTeacherId) ?? null

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setSelectedTeacherId("")
    }
  }

  async function handleAdd() {
    if (!selectedTeacherId) return

    startTransition(async () => {
      try {
        const result = await addGroupMemberAction({ groupId, userId: selectedTeacherId })

        if (result.success) {
          toast({
            title: "Teacher added",
            description: `${selectedTeacher?.pupilName ?? "Teacher"} was added to this group.`,
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
          Add Teacher
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Teacher</DialogTitle>
          <DialogDescription>
            Search for a teacher by name or email to add them directly to this group.
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
                {selectedTeacher ? selectedTeacher.pupilName : "Select a teacher..."}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-0">
              <Command>
                <CommandInput placeholder="Search by name or email..." />
                <CommandList>
                  <CommandEmpty>
                    {loadingTeachers ? "Loading teachers..." : "No eligible teachers found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {eligibleTeachers.map((teacher) => (
                      <CommandItem
                        key={teacher.pupilId}
                        value={`${teacher.pupilName} ${teacher.pupilEmail ?? ""}`}
                        onSelect={() => {
                          setSelectedTeacherId(teacher.pupilId)
                          setPickerOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedTeacherId === teacher.pupilId ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{teacher.pupilName}</span>
                          {teacher.pupilEmail ? (
                            <span className="text-xs text-slate-500">{teacher.pupilEmail}</span>
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
          <Button onClick={handleAdd} disabled={!selectedTeacherId || isPending} className="text-black">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Teacher
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
