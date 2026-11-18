"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, ChevronDown, ChevronUp, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react"

import {
  checkEvidenceTemplateAction,
  checkStartingDatabaseAction,
  listSuppliedImagesAction,
  removeSuppliedImageAction,
  renameSuppliedImageAction,
  updateLessonActivityAction,
  uploadSuppliedImageAction,
  type EvidenceTemplateCheck,
  type StartingDatabaseCheck,
  type SuppliedImage,
} from "@/lib/server-updates"
import {
  defaultPracticalBody,
  practicalBodyProblem,
  slotKeyFromLabel,
} from "@/lib/powerpoint-assessment/evidence-spec"
import { practicalTypeConfig, type PracticalAssessmentType } from "@/lib/practical-assessment/types"
import type { LessonActivity, PracticalUploadSlot, PracticalUploadSlotKind } from "@/types"
import {
  AssessmentPaperEditor,
  type AssessmentPaperCriterionOption,
} from "@/components/lessons/assessment-paper-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MediaImage } from "@/components/ui/media-image"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// Setup of a practical assessment that already exists (PowerPoint or
// database; `type`), in the lesson editor: the upload slots pupils hand their
// files into, the evidence template, the images the task supplies (PowerPoint)
// or the starting database (database), and (through AssessmentPaperEditor)
// the question paper, mark scheme and questions with their evidence sources.
// Each part saves on its own; the sheet's Save button saves the title and
// instructions. The slots, template and starting database save through
// updateLessonActivityAction, which checks them against the questions. The
// name is kept from when it served PowerPoint alone.

const KIND_LABELS: Record<PracticalUploadSlotKind, string> = {
  pptx: "Presentation (.pptx)",
  pdf: "Printout (.pdf)",
  docx: "Evidence document (.docx)",
  accdb: "Database (.accdb)",
}

/** Per type: how the main file is named in the slot messages, and the slots help text. */
const MAIN_FILE_TEXT: Record<PracticalAssessmentType, { name: string; handedIn: string; help: string; hint: string }> = {
  "powerpoint-assessment": {
    name: "presentation (.pptx)",
    handedIn: "pupils hand in exactly one presentation",
    help: "One slot takes the presentation (.pptx) and is always required. Add printouts (.pdf) and evidence documents (.docx) the task asks for.",
    hint: "Hint for pupils (optional), e.g. Save it as a PDF from PowerPoint",
  },
  "database-assessment": {
    name: "database (.accdb)",
    handedIn: "pupils hand in exactly one database",
    help: "One slot takes the database (.accdb) and is always required. Add evidence documents (.docx) and printouts (.pdf) the task asks for.",
    hint: "Hint for pupils (optional), e.g. Close Access before you upload the database",
  },
}

const NO_TEMPLATE = "__none__"
const SUPPLIED_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const SUPPLIED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

interface DraftSlot {
  id: string
  key: string
  /** A saved slot's key never changes; a new one follows its label until saved. */
  keyFixed: boolean
  label: string
  kind: PracticalUploadSlotKind
  required: boolean
  hint: string
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Math.random().toString(36).slice(2, 10)}`
}

function savedSlotsOf(activity: LessonActivity, type: PracticalAssessmentType): PracticalUploadSlot[] {
  const parsed = practicalTypeConfig(type).bodySchema.safeParse(activity.body_data ?? {})
  return parsed.success
    ? (parsed.data as { uploadSlots: PracticalUploadSlot[] }).uploadSlots
    : defaultPracticalBody(type).uploadSlots
}

function templateOf(activity: LessonActivity): string | null {
  const body = (activity.body_data ?? {}) as Record<string, unknown>
  return typeof body.evidenceTemplateFile === "string" ? body.evidenceTemplateFile : null
}

function startingDatabaseOf(activity: LessonActivity): string | null {
  const body = (activity.body_data ?? {}) as Record<string, unknown>
  return typeof body.startingDatabaseFile === "string" ? body.startingDatabaseFile : null
}

/** "3 tables (APPOINTMENTS 60 records, …); no queries, forms or reports." */
function describeStartingDatabase(check: StartingDatabaseCheck): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const tables =
    check.tables.length === 0
      ? "No tables"
      : `${count(check.tables.length, "table", "tables")} (${check.tables
          .map((table) => `${table.name} ${count(table.rows, "record", "records")}`)
          .join(", ")})`
  const objects = [
    { names: check.queries, one: "query", many: "queries" },
    { names: check.forms, one: "form", many: "forms" },
    { names: check.reports, one: "report", many: "reports" },
  ]
  const present = objects.filter((o) => o.names.length > 0)
  const absent = objects.filter((o) => o.names.length === 0).map((o) => o.many)
  const parts = present.map((o) => `${count(o.names.length, o.one, o.many)} (${o.names.join(", ")})`)
  if (absent.length > 0) {
    const list = absent.length === 1 ? absent[0] : `${absent.slice(0, -1).join(", ")} or ${absent[absent.length - 1]}`
    parts.push(`no ${list}`)
  }
  return `${tables}; ${parts.join("; ")}.`
}

function toDraftSlots(slots: PracticalUploadSlot[]): DraftSlot[] {
  return slots.map((slot) => ({
    id: newId(),
    key: slot.key,
    keyFixed: true,
    label: slot.label,
    kind: slot.kind,
    required: slot.required,
    hint: slot.hint ?? "",
  }))
}

/** Each draft slot's key: a new slot's follows its label, kept clear of the others'. */
function withKeys(drafts: DraftSlot[]): DraftSlot[] {
  const taken = new Set(drafts.filter((d) => d.keyFixed).map((d) => d.key))
  return drafts.map((draft) => {
    if (draft.keyFixed) return draft
    const key = slotKeyFromLabel(draft.label, taken)
    taken.add(key)
    return { ...draft, key }
  })
}

function fromDraftSlots(drafts: DraftSlot[]): PracticalUploadSlot[] {
  return drafts.map((draft) => ({
    key: draft.key,
    label: draft.label.trim(),
    kind: draft.kind,
    required: draft.required,
    ...(draft.hint.trim() ? { hint: draft.hint.trim() } : {}),
  }))
}

/** The slots' first problem, in the editor's words, or null. */
function slotsProblem(drafts: DraftSlot[], type: PracticalAssessmentType): string | null {
  const { mainKind } = practicalTypeConfig(type)
  const text = MAIN_FILE_TEXT[type]
  const mains = drafts.filter((d) => d.kind === mainKind)
  if (mains.length === 0) return `Add a ${text.name} slot: ${text.handedIn}.`
  if (mains.length > 1) {
    return `Only one slot can take the ${text.name}. Make the others printouts or evidence documents.`
  }
  if (!mains[0].required) return `The ${text.name.replace(/ \(.*\)$/, "")} slot must be required.`
  if (drafts.some((d) => !d.label.trim())) return "Every upload slot needs a label."
  return practicalBodyProblem({ uploadSlots: fromDraftSlots(drafts) }, type)
}

interface PowerPointAssessmentEditorProps {
  /** The practical type: PowerPoint or database. */
  type: PracticalAssessmentType
  unitId: string
  lessonId: string
  activity: LessonActivity
  lessonCriteria: AssessmentPaperCriterionOption[]
  /** The activity's current files (not past versions), for the template and reference files. */
  activityFiles: string[]
  /** Called after anything is saved, so the lesson can refresh when the sheet closes. */
  onSaved?: () => void
}

export function PowerPointAssessmentEditor({
  type,
  unitId,
  lessonId,
  activity,
  lessonCriteria,
  activityFiles,
  onSaved,
}: PowerPointAssessmentEditorProps) {
  const activityId = activity.activity_id
  const config = practicalTypeConfig(type)
  const mainKind = config.mainKind
  const mainText = MAIN_FILE_TEXT[type]

  // ------------------------------------------------------------ upload slots
  const [savedSlots, setSavedSlots] = useState<PracticalUploadSlot[]>(() => savedSlotsOf(activity, type))
  const [draftSlots, setDraftSlots] = useState<DraftSlot[]>(() => toDraftSlots(savedSlotsOf(activity, type)))
  const [slotsDirty, setSlotsDirty] = useState(false)
  const [isSavingSlots, setIsSavingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  // Remounts the questions after a save that moved their evidence.
  const [questionsKey, setQuestionsKey] = useState(0)

  const slotProblem = useMemo(() => slotsProblem(draftSlots, type), [draftSlots, type])

  // One key gone and one new of the same kind: the server carries the
  // questions' evidence and the pupils' files across (a rename).
  const pendingRename = useMemo(() => {
    const keys = new Set(draftSlots.map((d) => d.key))
    const removed = savedSlots.filter((slot) => !keys.has(slot.key))
    const added = draftSlots.filter((d) => !savedSlots.some((slot) => slot.key === d.key))
    if (removed.length !== 1 || added.length !== 1 || removed[0].kind !== added[0].kind) return null
    return { from: removed[0].label, to: added[0].label.trim() || added[0].key }
  }, [draftSlots, savedSlots])

  const changeSlots = (updater: (current: DraftSlot[]) => DraftSlot[]) => {
    setDraftSlots((current) => withKeys(updater(current)))
    setSlotsDirty(true)
    setSlotsError(null)
  }

  const updateSlot = (id: string, patch: Partial<DraftSlot>) =>
    changeSlots((current) =>
      current.map((draft) => {
        if (draft.id !== id) return draft
        const next = { ...draft, ...patch }
        // The main file (presentation or database) is always required.
        if (next.kind === mainKind) next.required = true
        return next
      }),
    )

  const addSlot = () =>
    changeSlots((current) => [
      ...current,
      {
        id: newId(),
        key: "",
        keyFixed: false,
        label: current.some((d) => d.kind === "docx") ? "Printout" : "Evidence document",
        kind: current.some((d) => d.kind === "docx") ? "pdf" : "docx",
        required: false,
        hint: "",
      },
    ])

  const moveSlot = (index: number, delta: -1 | 1) =>
    changeSlots((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = current.slice()
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const removeSlot = (id: string) => changeSlots((current) => current.filter((d) => d.id !== id))

  const handleSaveSlots = async () => {
    if (slotProblem) return
    setIsSavingSlots(true)
    setSlotsError(null)
    try {
      const uploadSlots = fromDraftSlots(draftSlots)
      const result = await updateLessonActivityAction(unitId, lessonId, activityId, { bodyData: { uploadSlots } })
      if (!result.success) {
        setSlotsError(result.error ?? "Unable to save the upload slots.")
        toast.error("Upload slots not saved", { description: result.error ?? "Please try again." })
        return
      }
      const saved = result.data ? savedSlotsOf(result.data, type) : uploadSlots
      if (pendingRename) setQuestionsKey((n) => n + 1)
      setSavedSlots(saved)
      setDraftSlots(toDraftSlots(saved))
      setSlotsDirty(false)
      toast.success("Upload slots saved")
      onSaved?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save the upload slots."
      setSlotsError(message)
      toast.error("Upload slots not saved", { description: message })
    } finally {
      setIsSavingSlots(false)
    }
  }

  // -------------------------------------------------------- evidence template
  const docxFiles = useMemo(() => activityFiles.filter((name) => /\.docx$/i.test(name)), [activityFiles])
  const [templateFile, setTemplateFile] = useState<string | null>(() => templateOf(activity))
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [templateCheck, setTemplateCheck] = useState<EvidenceTemplateCheck | null>(null)
  const [templateCheckError, setTemplateCheckError] = useState<string | null>(null)
  const [isCheckingTemplate, setIsCheckingTemplate] = useState(false)

  const runTemplateCheck = useCallback(
    async (fileName: string | null) => {
      setTemplateCheck(null)
      setTemplateCheckError(null)
      if (!fileName) return
      setIsCheckingTemplate(true)
      try {
        const result = await checkEvidenceTemplateAction(activityId, fileName)
        if (result.error || !result.data) {
          setTemplateCheckError(result.error ?? "Unable to check the evidence template.")
          return
        }
        setTemplateCheck(result.data)
      } catch (error) {
        setTemplateCheckError(error instanceof Error ? error.message : "Unable to check the evidence template.")
      } finally {
        setIsCheckingTemplate(false)
      }
    },
    [activityId],
  )

  const initialTemplate = useRef(templateFile)
  useEffect(() => {
    if (initialTemplate.current) void runTemplateCheck(initialTemplate.current)
  }, [runTemplateCheck])

  const handleTemplateChange = async (value: string) => {
    const next = value === NO_TEMPLATE ? null : value
    setIsSavingTemplate(true)
    try {
      const result = await updateLessonActivityAction(unitId, lessonId, activityId, {
        bodyData: { evidenceTemplateFile: next },
      })
      if (!result.success) {
        toast.error("Evidence template not saved", { description: result.error ?? "Please try again." })
        return
      }
      setTemplateFile(next)
      onSaved?.()
      toast.success(next ? "Evidence template saved" : "Evidence template removed")
      await runTemplateCheck(next)
    } catch (error) {
      toast.error("Evidence template not saved", {
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsSavingTemplate(false)
    }
  }

  // ------------------------------------------------- starting database (database)
  const accdbFiles = useMemo(() => activityFiles.filter((name) => /\.accdb$/i.test(name)), [activityFiles])
  const [startingDatabase, setStartingDatabase] = useState<string | null>(() => startingDatabaseOf(activity))
  const [isSavingStart, setIsSavingStart] = useState(false)
  const [startCheck, setStartCheck] = useState<StartingDatabaseCheck | null>(null)
  const [startCheckError, setStartCheckError] = useState<string | null>(null)
  const [isCheckingStart, setIsCheckingStart] = useState(false)

  // Reading a database takes a while: only the latest check's answer is shown.
  const startCheckRun = useRef(0)
  const runStartCheck = useCallback(
    async (fileName: string | null) => {
      const run = ++startCheckRun.current
      setStartCheck(null)
      setStartCheckError(null)
      if (!fileName) {
        setIsCheckingStart(false)
        return
      }
      setIsCheckingStart(true)
      try {
        const result = await checkStartingDatabaseAction(activityId, fileName)
        if (run !== startCheckRun.current) return
        if (result.error || !result.data) {
          setStartCheckError(result.error ?? "Unable to read the starting database.")
          return
        }
        setStartCheck(result.data)
      } catch (error) {
        if (run !== startCheckRun.current) return
        setStartCheckError(error instanceof Error ? error.message : "Unable to read the starting database.")
      } finally {
        if (run === startCheckRun.current) setIsCheckingStart(false)
      }
    },
    [activityId],
  )

  const initialStart = useRef(config.hasStartingDatabase ? startingDatabase : null)
  useEffect(() => {
    if (initialStart.current) void runStartCheck(initialStart.current)
  }, [runStartCheck])

  const handleStartingDatabaseChange = async (value: string) => {
    const next = value === NO_TEMPLATE ? null : value
    setIsSavingStart(true)
    try {
      const result = await updateLessonActivityAction(unitId, lessonId, activityId, {
        bodyData: { startingDatabaseFile: next },
      })
      if (!result.success) {
        toast.error("Starting database not saved", { description: result.error ?? "Please try again." })
        return
      }
      setStartingDatabase(next)
      onSaved?.()
      toast.success(next ? "Starting database saved" : "Starting database removed")
      await runStartCheck(next)
    } catch (error) {
      toast.error("Starting database not saved", {
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsSavingStart(false)
    }
  }

  // --------------------------------------------------------- supplied images
  const [images, setImages] = useState<SuppliedImage[]>([])
  const [imagesLoaded, setImagesLoaded] = useState(false)
  const [imagesError, setImagesError] = useState<string | null>(null)
  const [isUploadingImages, setIsUploadingImages] = useState(false)
  const [imageWarnings, setImageWarnings] = useState<string[]>([])
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [busyImage, setBusyImage] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!config.hasSuppliedImages) return
    let cancelled = false
    listSuppliedImagesAction(activityId)
      .then((result) => {
        if (cancelled) return
        if (result.error || !result.data) setImagesError(result.error ?? "Unable to load the supplied images.")
        else setImages(result.data)
      })
      .catch((error) => {
        if (!cancelled) setImagesError(error instanceof Error ? error.message : "Unable to load the supplied images.")
      })
      .finally(() => {
        if (!cancelled) setImagesLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [activityId, config.hasSuppliedImages])

  const handleUploadImages = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    setIsUploadingImages(true)
    const warnings: string[] = []
    let uploaded = 0
    try {
      for (const file of files) {
        if (!SUPPLIED_IMAGE_TYPES.includes(file.type)) {
          toast.error(`${file.name} not uploaded`, { description: "A supplied image must be a PNG, JPEG, GIF or WebP." })
          continue
        }
        if (file.size > SUPPLIED_IMAGE_MAX_BYTES) {
          toast.error(`${file.name} not uploaded`, { description: "A supplied image must be 10 MB or smaller." })
          continue
        }
        const formData = new FormData()
        formData.append("activityId", activityId)
        formData.append("file", file)
        const result = await uploadSuppliedImageAction(formData)
        if (result.error || !result.data) {
          toast.error(`${file.name} not uploaded`, { description: result.error ?? "Please try again." })
          continue
        }
        uploaded += 1
        warnings.push(...result.data.warnings)
        setImages(result.data.images)
      }
      setImageWarnings(warnings)
      if (uploaded > 0) {
        onSaved?.()
        toast.success(`${uploaded} image${uploaded === 1 ? "" : "s"} uploaded`, {
          description: warnings.length > 0 ? "Some look alike; see the warnings." : undefined,
        })
      }
    } finally {
      setIsUploadingImages(false)
    }
  }

  const handleRenameImage = async (image: SuppliedImage) => {
    const next = (nameDrafts[image.name] ?? image.name).trim()
    if (next === image.name) return
    if (!next) {
      toast.error("The image needs a name.")
      setNameDrafts((current) => ({ ...current, [image.name]: image.name }))
      return
    }
    setBusyImage(image.name)
    try {
      const result = await renameSuppliedImageAction(activityId, image.name, next)
      if (result.error || !result.data) {
        toast.error("Image not renamed", { description: result.error ?? "Please try again." })
        return
      }
      setImages(result.data.images)
      setNameDrafts((current) => {
        const rest = { ...current }
        delete rest[image.name]
        return rest
      })
      onSaved?.()
      toast.success("Image renamed")
    } catch (error) {
      toast.error("Image not renamed", { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setBusyImage(null)
    }
  }

  const handleRemoveImage = async (image: SuppliedImage) => {
    setBusyImage(image.name)
    try {
      const result = await removeSuppliedImageAction(activityId, image.name)
      if (result.error || !result.data) {
        toast.error("Image not removed", { description: result.error ?? "Please try again." })
        return
      }
      setImages(result.data.images)
      setImageWarnings((current) => current.filter((warning) => !warning.includes(`"${image.name}"`)))
      onSaved?.()
      toast.success("Image removed")
    } catch (error) {
      toast.error("Image not removed", { description: error instanceof Error ? error.message : "Please try again." })
    } finally {
      setBusyImage(null)
    }
  }

  const powerPoint = useMemo(
    () => ({ type, slots: savedSlots, referenceFiles: activityFiles }),
    [type, savedSlots, activityFiles],
  )

  return (
    <div className="space-y-6">
      {/* Upload slots */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Files pupils hand in</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addSlot}
            disabled={isSavingSlots || draftSlots.length >= 8}
          >
            <Plus className="mr-1 h-4 w-4" /> Add upload slot
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {mainText.help} Each question&apos;s evidence names these slots.
        </p>
        <ol className="space-y-2">
          {draftSlots.map((slot, index) => (
            <li key={slot.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[10rem] flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground" htmlFor={`slot-label-${slot.id}`}>
                    Label
                  </Label>
                  <Input
                    id={`slot-label-${slot.id}`}
                    value={slot.label}
                    onChange={(event) => updateSlot(slot.id, { label: event.target.value })}
                    disabled={isSavingSlots}
                  />
                </div>
                <div className="w-52 space-y-1">
                  <Label className="text-xs text-muted-foreground" htmlFor={`slot-kind-${slot.id}`}>
                    Takes
                  </Label>
                  <Select
                    value={slot.kind}
                    onValueChange={(value) => updateSlot(slot.id, { kind: value as PracticalUploadSlotKind })}
                    disabled={isSavingSlots}
                  >
                    <SelectTrigger id={`slot-kind-${slot.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {config.slotKinds.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {KIND_LABELS[kind]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Move slot up"
                    disabled={index === 0 || isSavingSlots}
                    onClick={() => moveSlot(index, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Move slot down"
                    disabled={index === draftSlots.length - 1 || isSavingSlots}
                    onClick={() => moveSlot(index, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove slot ${slot.label}`}
                    disabled={isSavingSlots || draftSlots.length === 1}
                    onClick={() => removeSlot(slot.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Switch
                    checked={slot.required}
                    onCheckedChange={(checked) => updateSlot(slot.id, { required: checked })}
                    disabled={isSavingSlots || slot.kind === mainKind}
                  />
                  {slot.kind === mainKind
                    ? `Required (the ${mainText.name.replace(/ \(.*\)$/, "")} always is)`
                    : "Required before hand-in"}
                </label>
                <span className="text-xs text-muted-foreground">
                  Key: <code>{slot.key || "…"}</code>
                  {slot.keyFixed ? "" : " (set from the label when saved)"}
                </span>
              </div>
              <Input
                aria-label={`Hint for ${slot.label}`}
                placeholder={mainText.hint}
                value={slot.hint}
                onChange={(event) => updateSlot(slot.id, { hint: event.target.value })}
                disabled={isSavingSlots}
              />
            </li>
          ))}
        </ol>
        {slotProblem ? <p className="text-xs text-destructive">{slotProblem}</p> : null}
        {pendingRename && !slotProblem ? (
          <p className="text-xs text-muted-foreground">
            Saving moves the questions&apos; evidence and pupils&apos; files from &ldquo;{pendingRename.from}&rdquo; to
            &ldquo;{pendingRename.to}&rdquo;.
          </p>
        ) : null}
        {slotsError ? <p className="text-sm text-destructive">{slotsError}</p> : null}
        <div className="flex items-center justify-end gap-2">
          {slotsDirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSavingSlots}
              onClick={() => {
                setDraftSlots(toDraftSlots(savedSlots))
                setSlotsDirty(false)
                setSlotsError(null)
              }}
            >
              Discard changes
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={handleSaveSlots}
            disabled={!slotsDirty || slotProblem !== null || isSavingSlots}
          >
            {isSavingSlots ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save upload slots
          </Button>
        </div>
      </section>

      {/* Evidence template */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Evidence template</h3>
        <p className="text-xs text-muted-foreground">
          The blank evidence document pupils fill in. Its own text is left out of what the marker reads, and its
          headings are checked against the ones the questions read. Upload it to the activity&apos;s files first.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={templateFile ?? NO_TEMPLATE}
            onValueChange={(value) => void handleTemplateChange(value)}
            disabled={isSavingTemplate}
          >
            <SelectTrigger className="w-72" aria-label="Evidence template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
              {docxFiles.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
              {templateFile && !docxFiles.includes(templateFile) ? (
                <SelectItem value={templateFile}>{templateFile} (missing)</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          {templateFile ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runTemplateCheck(templateFile)}
              disabled={isCheckingTemplate || isSavingTemplate}
            >
              {isCheckingTemplate || isSavingTemplate ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Check headings
            </Button>
          ) : null}
        </div>
        {templateCheckError ? <p className="text-xs text-destructive">{templateCheckError}</p> : null}
        {templateCheck ? (
          templateCheck.headings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No question reads an evidence document heading yet.</p>
          ) : templateCheck.missingHeadings.length === 0 ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              All {templateCheck.headings.length} headings the questions read are in {templateCheck.fileName}.
            </p>
          ) : (
            <div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                {templateCheck.fileName} has no heading for{" "}
                {templateCheck.missingHeadings.map((heading) => `"${heading}"`).join(", ")}. Pupils filling it in
                will have nowhere to put that evidence, so those questions would score 0. Add the headings to the
                template or change the questions&apos; headings.
              </span>
            </div>
          )
        ) : null}
      </section>

      {/* Starting database (database assessment) */}
      {config.hasStartingDatabase ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Starting database</h3>
          <p className="text-xs text-muted-foreground">
            The database pupils download and start from. Each pupil&apos;s database is compared with it, so the marker
            is told what they changed. Upload it to the activity&apos;s files first.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={startingDatabase ?? NO_TEMPLATE}
              onValueChange={(value) => void handleStartingDatabaseChange(value)}
              disabled={isSavingStart}
            >
              <SelectTrigger className="w-72" aria-label="Starting database">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>No starting database</SelectItem>
                {accdbFiles.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
                {startingDatabase && !accdbFiles.includes(startingDatabase) ? (
                  <SelectItem value={startingDatabase}>{startingDatabase} (missing)</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {startingDatabase ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void runStartCheck(startingDatabase)}
                disabled={isCheckingStart || isSavingStart}
              >
                {isCheckingStart || isSavingStart ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Check
              </Button>
            ) : null}
          </div>
          {startCheckError ? <p className="text-xs text-destructive">{startCheckError}</p> : null}
          {startCheck ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{startCheck.fileName}:</span>{" "}
              {describeStartingDatabase(startCheck)}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Supplied images (PowerPoint assessment) */}
      {config.hasSuppliedImages ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Supplied images</h3>
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept={SUPPLIED_IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(event) => {
                const files = event.target.files
                void handleUploadImages(files).finally(() => {
                  event.target.value = ""
                })
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => imageInputRef.current?.click()}
              disabled={isUploadingImages}
            >
              {isUploadingImages ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 h-4 w-4" />}
              Upload images
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The images the task gives pupils (PNG, JPEG, GIF or WebP, up to 10 MB each). The marker is told which of
            them appear on each slide, by these names.
          </p>
          {imageWarnings.length > 0 ? (
            <div className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
              {imageWarnings.map((warning) => (
                <p key={warning} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  {warning}
                </p>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setImageWarnings([])}>
                Dismiss
              </Button>
            </div>
          ) : null}
          {imagesError ? <p className="text-xs text-destructive">{imagesError}</p> : null}
          {!imagesLoaded ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading images…
            </p>
          ) : images.length === 0 ? (
            <p className="text-sm text-muted-foreground">No supplied images.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.map((image) => {
                const draftName = nameDrafts[image.name] ?? image.name
                const busy = busyImage === image.name
                return (
                  <li key={image.name} className="space-y-1 rounded-md border border-border p-2">
                    <div className="flex aspect-video items-center justify-center overflow-hidden rounded bg-muted/30">
                      <MediaImage
                        src={image.url}
                        alt={image.name}
                        width={image.width ?? 160}
                        height={image.height ?? 90}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    <Input
                      aria-label={`Name of ${image.name}`}
                      className={cn("h-8 text-xs", draftName.trim() !== image.name && "border-primary")}
                      value={draftName}
                      onChange={(event) => setNameDrafts((current) => ({ ...current, [image.name]: event.target.value }))}
                      onBlur={() => void handleRenameImage(image)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          void handleRenameImage(image)
                        }
                      }}
                      disabled={busy}
                    />
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[11px] text-muted-foreground" title={image.file_name}>
                        {image.file_name}
                        {image.width && image.height ? ` · ${image.width}×${image.height}` : ""}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Remove ${image.name}`}
                        disabled={busy}
                        onClick={() => void handleRemoveImage(image)}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* Question paper, mark scheme and questions with their evidence */}
      <AssessmentPaperEditor
        key={questionsKey}
        activityId={activityId}
        lessonCriteria={lessonCriteria}
        onSaved={onSaved}
        powerPoint={powerPoint}
        onQuestionsSaved={() => {
          if (templateFile) void runTemplateCheck(templateFile)
        }}
      />
    </div>
  )
}
