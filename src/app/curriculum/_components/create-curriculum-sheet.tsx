"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  createCurriculumAction,
  createCurriculumAssessmentObjectiveAction,
  createCurriculumLearningObjectiveAction,
  createCurriculumSuccessCriterionAction,
} from "@/lib/server-updates"
import type { Curriculum } from "@/types"
import type { Cell, Worksheet } from "exceljs"

type SubjectOption = {
  subject: string
}

type CreateCurriculumSheetProps = {
  subjects: SubjectOption[]
  subjectsError?: string | null
  onCurriculumCreated?: (curriculum: Curriculum) => void
}

type ValidationIssue = {
  cell: string
  message: string
}

type ParsedSuccessCriterion = {
  description: string
  order: number
  sourceCell: string
  displayId: string | null
  level: number
  levelCell: string
}

type ParsedLearningObjective = {
  key: string
  identifier: string | null
  title: string
  order: number
  sourceCell: string
  successCriteria: ParsedSuccessCriterion[]
}

type ParsedAssessmentObjective = {
  code: string
  title: string
  order: number
  sourceCell: string
  displayLabel: string
  learningObjectives: ParsedLearningObjective[]
}

type ParsedWorkbook = {
  assessmentObjectives: ParsedAssessmentObjective[]
  learningObjectiveCount: number
  successCriterionCount: number
}

type ParseOutcome =
  | { ok: true; workbook: ParsedWorkbook }
  | { ok: false; issues: ValidationIssue[]; error: string }

type ProgressState = {
  total: number
  completed: number
  message: string
}

const REQUIRED_HEADERS: Array<{ key: keyof ColumnMap; label: string }> = [
  { key: "aoId", label: "AO ID" },
  { key: "ao", label: "AO" },
  { key: "loId", label: "LO ID" },
  { key: "lo", label: "LO" },
  { key: "scId", label: "SC ID" },
  { key: "sc", label: "SC" },
  { key: "level", label: "Level" },
]

type ColumnMap = {
  aoId: number
  ao: number
  loId: number
  lo: number
  scId: number
  sc: number
  level: number
}

type ExcelModule = typeof import("exceljs")

let excelModulePromise: Promise<ExcelModule> | null = null

export function CreateCurriculumSheet({ subjects, subjectsError, onCurriculumCreated }: CreateCurriculumSheetProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)

  const orderedSubjects = useMemo(() => subjects.map((entry) => entry.subject).sort((a, b) => a.localeCompare(b)), [subjects])

  const resetState = () => {
    setValidationIssues([])
    setFormError(null)
    setProgress(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return
    setOpen(nextOpen)
    if (!nextOpen) {
      resetState()
    }
  }

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (isSubmitting) return

    resetState()

    const form = event.currentTarget
    const formData = new FormData(form)

    const rawTitle = String(formData.get("title") ?? "").trim()
    const rawSubject = formData.get("subject")
    const rawDescription = String(formData.get("description") ?? "").trim()
    const file = formData.get("curriculum-upload")

    if (rawTitle.length === 0) {
      setFormError("Curriculum title is required.")
      return
    }

    const selectedFile = file instanceof File && file.size > 0 ? file : null

    let parsedWorkbook: ParsedWorkbook | null = null

    if (selectedFile) {
      const parseResult = await parseCurriculumSpreadsheet(selectedFile)
      if (!parseResult.ok) {
        setValidationIssues(parseResult.issues)
        setFormError(parseResult.error)
        toast.error("Upload needs attention", {
          description: parseResult.error,
        })
        return
      }
      parsedWorkbook = parseResult.workbook
    }

    setIsSubmitting(true)

    const totalSteps = calculateTotalSteps(parsedWorkbook)
    let completedSteps = 0

    const updateProgress = (message: string, completedOverride?: number) => {
      const completed = completedOverride ?? completedSteps
      setProgress({
        total: totalSteps,
        completed,
        message,
      })
    }

    try {
      updateProgress(`Creating curriculum record (step ${completedSteps + 1} of ${totalSteps})`)

      const createResult = await createCurriculumAction({
        title: rawTitle,
        subject: rawSubject ? String(rawSubject).trim() || null : null,
        description: rawDescription.length > 0 ? rawDescription : null,
      })

      if (createResult.error || !createResult.data) {
        const description = createResult.error ?? "Unexpected error while creating curriculum."
        setFormError(description)
        toast.error("Failed to create curriculum", { description })
        setProgress(null)
        return
      }

      completedSteps += 1
      updateProgress(`Curriculum created (step ${completedSteps} of ${totalSteps})`)

      const createdCurriculum = createResult.data
      const curriculumId = createdCurriculum.curriculum_id

      if (parsedWorkbook) {
        const aoIdMap = new Map<string, string>()
        const loIdMap = new Map<string, string>()

        for (const ao of parsedWorkbook.assessmentObjectives) {
          updateProgress(`Creating assessment objective ${ao.displayLabel} (step ${completedSteps + 1} of ${totalSteps})`)

          const aoResult = await createCurriculumAssessmentObjectiveAction(curriculumId, {
            code: ao.code,
            title: ao.title,
            order_index: ao.order,
          })

          if (aoResult.error || !aoResult.data) {
            const description = aoResult.error ?? `Failed to create assessment objective ${ao.code}.`
            throw new Error(description)
          }

          aoIdMap.set(ao.code, aoResult.data.assessment_objective_id)
          completedSteps += 1
          updateProgress(`Assessment objective ${ao.displayLabel} created (step ${completedSteps} of ${totalSteps})`)

          for (const lo of ao.learningObjectives) {
            const loLabel = lo.identifier ? `${lo.identifier}` : lo.title
            updateProgress(`Creating learning objective ${loLabel} (step ${completedSteps + 1} of ${totalSteps})`)

            const parentAoId = aoIdMap.get(ao.code)
            if (!parentAoId) {
              throw new Error(`Missing assessment objective reference for ${ao.code}.`)
            }

            const loResult = await createCurriculumLearningObjectiveAction(
              parentAoId,
              { title: lo.title, order_index: lo.order, spec_ref: lo.identifier },
              curriculumId,
            )

            if (loResult.error || !loResult.data) {
              const description = loResult.error ?? `Failed to create learning objective ${loLabel}.`
              throw new Error(description)
            }

            const learningObjectiveId = loResult.data.learning_objective_id
            loIdMap.set(lo.key, learningObjectiveId)
            completedSteps += 1
            updateProgress(`Learning objective ${loLabel} created (step ${completedSteps} of ${totalSteps})`)

            for (const sc of lo.successCriteria) {
              const scLabel = sc.displayId ?? truncate(sc.description, 32)
              updateProgress(`Creating success criterion ${scLabel} (step ${completedSteps + 1} of ${totalSteps})`)

              const loId = loIdMap.get(lo.key)
              if (!loId) {
                throw new Error(`Missing learning objective reference for ${loLabel}.`)
              }

              const scResult = await createCurriculumSuccessCriterionAction(loId, curriculumId, {
                description: sc.description,
                level: sc.level,
                order_index: sc.order,
                unit_ids: [],
              })

              if (scResult.error || !scResult.data) {
                const description = scResult.error ?? `Failed to create success criterion ${scLabel}.`
                throw new Error(description)
              }

              completedSteps += 1
              updateProgress(`Success criterion ${scLabel} created (step ${completedSteps} of ${totalSteps})`)
            }
          }
        }
      }

      toast.success("Curriculum created", {
        description: parsedWorkbook
          ? `${rawTitle} initialised with ${parsedWorkbook.assessmentObjectives.length} AO(s).`
          : rawTitle,
      })

      onCurriculumCreated?.(createdCurriculum)
      form.reset()
      resetState()
      setOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error while creating curriculum."
      setFormError(message)
      setProgress(null)
      toast.error("Curriculum upload failed", { description: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const progressValue = useMemo(() => {
    if (!progress || progress.total === 0) return 0
    return Math.round((progress.completed / progress.total) * 100)
  }, [progress])

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button type="button">Add Curriculum</Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Create a new curriculum</SheetTitle>
          <SheetDescription>
            Provide the basic details and optionally seed the structure from a spreadsheet (AO → LO → SC).
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="curriculum-title" className="text-muted-foreground">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input id="curriculum-title" name="title" placeholder="e.g. Design & Technology (KS3)" required disabled={isSubmitting} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="curriculum-subject" className="text-muted-foreground">
              Subject
            </Label>
            <select
              id="curriculum-subject"
              name="subject"
              defaultValue=""
              disabled={isSubmitting}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            >
              <option value="">No subject</option>
              {orderedSubjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
            {subjectsError ? <span className="text-xs text-destructive">{subjectsError}</span> : null}
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
              disabled={isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="curriculum-upload" className="text-muted-foreground">
              Upload structure (.xlsx)
            </Label>
            <Input
              id="curriculum-upload"
              name="curriculum-upload"
              type="file"
              accept=".xlsx"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Expected headers: AO ID, AO, LO ID, LO, SC ID, SC, Level. Leave the field empty to create a blank curriculum.
            </p>
          </div>

          {formError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </div>
          ) : null}

          {validationIssues.length > 0 ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
              <p className="font-medium">Fix the following before trying again:</p>
              <ul className="mt-2 space-y-1">
                {validationIssues.map((issue, index) => (
                  <li key={`${issue.cell}-${index}`}>
                    <span className="font-semibold">{issue.cell}</span>: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {progress ? (
            <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.message}</span>
                <span>
                  {progress.completed} / {progress.total}
                </span>
              </div>
              <Progress value={progressValue} />
            </div>
          ) : null}

          <SheetFooter>
            <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create curriculum"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

async function loadExcelModule(): Promise<ExcelModule> {
  if (!excelModulePromise) {
    excelModulePromise = import("exceljs").then((mod) => {
      const candidate = mod as ExcelModule & { default?: ExcelModule }
      if ("Workbook" in candidate && typeof candidate.Workbook === "function") {
        return candidate
      }
      if (candidate.default && "Workbook" in candidate.default && typeof candidate.default.Workbook === "function") {
        return candidate.default
      }
      throw new Error("Unable to load ExcelJS module")
    })
  }

  return excelModulePromise
}

async function parseCurriculumSpreadsheet(file: File): Promise<ParseOutcome> {
  if (file.type && file.type !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return {
      ok: false,
      error: "The upload must be an .xlsx spreadsheet.",
      issues: [{ cell: "Upload", message: "Unsupported file type" }],
    }
  }

  let workbookArrayBuffer: ArrayBuffer
  try {
    workbookArrayBuffer = await file.arrayBuffer()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the uploaded file."
    return { ok: false, error: message, issues: [{ cell: "Upload", message }] }
  }

  const Excel = await loadExcelModule()
  const workbook = new Excel.Workbook()

  try {
    await workbook.xlsx.load(workbookArrayBuffer)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse the spreadsheet."
    return { ok: false, error: message, issues: [{ cell: "Upload", message }] }
  }

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    return { ok: false, error: "Workbook does not contain a usable sheet.", issues: [{ cell: "A1", message: "No worksheet found" }] }
  }

  return parseWorksheet(worksheet)
}

function parseWorksheet(worksheet: Worksheet): ParseOutcome {
  const issues: ValidationIssue[] = []
  const headerRowNumber = 1
  const headerRow = worksheet.getRow(headerRowNumber)

  if (!headerRow || headerRow.cellCount === 0) {
    return {
      ok: false,
      error: "The first row must contain the headers AO ID, AO, LO ID, LO, SC ID, SC.",
      issues: [{ cell: "A1", message: "Header row is missing" }],
    }
  }

  const headerMap = new Map<string, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const headerText = normalizeHeader(cell.text)
    if (headerText.length > 0) {
      headerMap.set(headerText, colNumber)
    }
  })

  const columns = {} as ColumnMap

  for (let index = 0; index < REQUIRED_HEADERS.length; index += 1) {
    const { key, label } = REQUIRED_HEADERS[index]
    const normalizedLabel = normalizeHeader(label)
    const match = headerMap.get(normalizedLabel)
    if (!match) {
      issues.push({ cell: `${columnLetter(index + 1)}1`, message: `Expected header "${label}".` })
    } else {
      columns[key] = match
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: "The spreadsheet headers do not match the expected template.",
      issues,
    }
  }

  const aoMap = new Map<string, ParsedAssessmentObjective>()
  const aoOrder: ParsedAssessmentObjective[] = []

  let currentAo: ParsedAssessmentObjective | null = null
  let currentLo: ParsedLearningObjective | null = null

  const rowCount = worksheet.rowCount

  for (let rowNumber = headerRowNumber + 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    if (!row) continue

    const aoIdCell = row.getCell(columns.aoId)
    const aoCell = row.getCell(columns.ao)
    const loIdCell = row.getCell(columns.loId)
    const loCell = row.getCell(columns.lo)
    const scIdCell = row.getCell(columns.scId)
    const scCell = row.getCell(columns.sc)
    const levelCell = row.getCell(columns.level)

    const aoIdValue = getCellText(aoIdCell)
    const aoValue = getCellText(aoCell)
    const loIdValue = getCellText(loIdCell)
    const loValue = getCellText(loCell)
    const scIdValue = getCellText(scIdCell)
    const scValue = getCellText(scCell)
    const levelText = getCellText(levelCell)

    const hasAoData = aoIdValue.length > 0 || aoValue.length > 0
    const hasLoData = loIdValue.length > 0 || loValue.length > 0
    const hasScData = scIdValue.length > 0 || scValue.length > 0
    const hasLevelData = levelText.length > 0
    const rowIsEmpty = !hasAoData && !hasLoData && !hasScData && !hasLevelData

    if (rowIsEmpty) {
      continue
    }

    if (hasAoData) {
      if (aoValue.length === 0) {
        issues.push({ cell: aoCell.address, message: "Assessment objective value is required." })
        continue
      }

      const parsedAo = parseAoLabel(aoValue, aoIdValue)
      if (!parsedAo) {
        issues.push({ cell: aoCell.address, message: "Could not extract an assessment objective code." })
        continue
      }

      const existingAo = aoMap.get(parsedAo.code)
      if (!existingAo) {
        const order = aoMap.size
        const aoEntry: ParsedAssessmentObjective = {
          code: parsedAo.code,
          title: parsedAo.title,
          order,
          sourceCell: aoCell.address,
          displayLabel: aoValue,
          learningObjectives: [],
        }
        aoMap.set(parsedAo.code, aoEntry)
        aoOrder.push(aoEntry)
        currentAo = aoEntry
      } else {
        if (existingAo.title !== parsedAo.title) {
          issues.push({ cell: aoCell.address, message: `Title mismatch for assessment objective ${parsedAo.code}.` })
        }
        currentAo = existingAo
      }

      currentLo = null
    } else if (!currentAo) {
      issues.push({ cell: aoCell.address, message: "Provide an assessment objective before defining learning objectives or success criteria." })
      continue
    }

    if (hasLoData) {
      if (!currentAo) {
        issues.push({ cell: loCell.address, message: "Learning objective must belong to an assessment objective." })
        continue
      }

      if (loValue.length === 0) {
        issues.push({ cell: loCell.address, message: "Learning objective description is required." })
        continue
      }

      const identifier = loIdValue.length > 0 ? loIdValue : null
      const key = `${currentAo.code}::${identifier ?? `row-${rowNumber}`}`
      let learningObjective = currentAo.learningObjectives.find((entry) => entry.key === key)

      if (!learningObjective) {
        const order = currentAo.learningObjectives.length
        learningObjective = {
          key,
          identifier,
          title: loValue,
          order,
          sourceCell: loCell.address,
          successCriteria: [],
        }
        currentAo.learningObjectives.push(learningObjective)
      } else if (learningObjective.title !== loValue) {
        issues.push({ cell: loCell.address, message: `Learning objective ${identifier ?? key} already defined with a different description.` })
      }

      currentLo = learningObjective
    } else if (!currentLo && hasScData) {
      issues.push({ cell: loCell.address, message: "Provide a learning objective before listing success criteria." })
      continue
    }

    if (hasScData || hasLevelData) {
      if (!currentLo) {
        issues.push({ cell: scCell.address, message: "Success criterion must belong to a learning objective." })
        continue
      }
      if (scValue.length === 0) {
        issues.push({ cell: scCell.address, message: "Success criterion description is required." })
        continue
      }

      const parsedLevel = parseLevel(levelText, levelCell.address, issues)
      if (parsedLevel === null) {
        continue
      }

      const scEntry: ParsedSuccessCriterion = {
        description: scValue,
        order: currentLo.successCriteria.length,
        sourceCell: scCell.address,
        displayId: scIdValue.length > 0 ? scIdValue : null,
        level: parsedLevel,
        levelCell: levelCell.address,
      }

      currentLo.successCriteria.push(scEntry)
    }
  }

  for (const ao of aoOrder) {
    if (ao.learningObjectives.length === 0) {
      issues.push({ cell: ao.sourceCell, message: "Assessment objective has no learning objectives." })
    }
    for (const lo of ao.learningObjectives) {
      if (lo.successCriteria.length === 0) {
        issues.push({ cell: lo.sourceCell, message: "Learning objective has no success criteria." })
      }
    }
  }

  if (aoOrder.length === 0) {
    issues.push({ cell: "A2", message: "The spreadsheet does not contain any assessment objectives." })
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: "Please resolve the highlighted issues in the spreadsheet.",
      issues,
    }
  }

  const learningObjectiveCount = aoOrder.reduce((total, ao) => total + ao.learningObjectives.length, 0)
  const successCriterionCount = aoOrder.reduce(
    (total, ao) => total + ao.learningObjectives.reduce((sum, lo) => sum + lo.successCriteria.length, 0),
    0,
  )

  return {
    ok: true,
    workbook: {
      assessmentObjectives: aoOrder,
      learningObjectiveCount,
      successCriterionCount,
    },
  }
}

function normalizeHeader(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function getCellText(cell: Cell): string {
  const value = cell.value
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number") return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("").trim()
  }
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim()
  }
  return (cell.text ?? "").trim()
}

function parseAoLabel(value: string, idValue: string): { code: string; title: string } | null {
  const [codePart, ...titleParts] = value.split("-")
  const inferredCode = codePart?.trim()
  const title = titleParts.join("-").trim() || value.trim()

  let code: string | null = null
  if (inferredCode && /^ao\s*\d+$/i.test(inferredCode)) {
    code = inferredCode.replace(/\s+/g, "").toUpperCase()
  } else if (inferredCode && /^ao\d+/i.test(inferredCode)) {
    code = inferredCode.toUpperCase()
  } else if (idValue.trim().length > 0) {
    const trimmedId = idValue.trim()
    code = /^ao/i.test(trimmedId) ? trimmedId.toUpperCase() : `AO${trimmedId}`
  }

  if (!code) {
    return null
  }

  return { code, title }
}

function parseLevel(raw: string, cellAddress: string, issues: ValidationIssue[]): number | null {
  if (raw.length === 0) {
    return 1
  }

  const value = Number(raw)

  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push({ cell: cellAddress, message: "Level must be a whole number." })
    return null
  }

  if (value < 1 || value > 7) {
    issues.push({ cell: cellAddress, message: "Level must be between 1 and 7." })
    return null
  }

  return value
}

function columnLetter(index: number): string {
  let value = index
  let result = ""
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function calculateTotalSteps(parsedWorkbook: ParsedWorkbook | null): number {
  if (!parsedWorkbook) return 1
  return (
    1 +
    parsedWorkbook.assessmentObjectives.length +
    parsedWorkbook.learningObjectiveCount +
    parsedWorkbook.successCriterionCount
  )
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value
  return `${value.slice(0, length - 1)}…`
}
