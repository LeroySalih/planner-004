"use client"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

type SubjectOption = {
  subject: string
}

type CreateCurriculumSheetProps = {
  action: (formData: FormData) => Promise<void>
  subjects: SubjectOption[]
  subjectsError?: string | null
}

export function CreateCurriculumSheet({ action, subjects, subjectsError }: CreateCurriculumSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button">Add Curriculum</Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Create a new curriculum</SheetTitle>
          <SheetDescription>Provide the basic details to spin up a curriculum workspace.</SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="curriculum-title" className="text-muted-foreground">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="curriculum-title"
              name="title"
              required
              placeholder="e.g. Design & Technology (KS3)"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="curriculum-subject" className="text-muted-foreground">
              Subject
            </Label>
            <select
              id="curriculum-subject"
              name="subject"
              defaultValue=""
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            >
              <option value="">No subject</option>
              {subjects.map((subject) => (
                <option key={subject.subject} value={subject.subject}>
                  {subject.subject}
                </option>
              ))}
            </select>
            {subjectsError ? (
              <span className="text-xs text-destructive">{subjectsError}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="curriculum-description" className="text-muted-foreground">
              Description
            </Label>
            <Textarea
              id="curriculum-description"
              name="description"
              placeholder="Optional summary for the curriculum"
              className="min-h-[120px]"
            />
          </div>
          <SheetFooter>
            <Button type="submit" className="w-full sm:w-auto">
              Create curriculum
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
