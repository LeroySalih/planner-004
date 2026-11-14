// Copy pupils' work from old Upload File activities into a PowerPoint
// assessment's upload slots.
//
//   npx tsx scripts/copy-uploads-to-powerpoint-assessment.ts --mapping <mapping.json>
//     [--apply] [--hand-in --confirmed] [--replace] [--fallback-root <dir>] [--out <result.json>]
//
// Run it through scripts/copy-uploads-to-powerpoint-assessment.sh, which runs
// it beside the app as the app's own user. The mapping is data
// (scripts/powerpoint-mappings/*.json):
//
//   { "target_activity_id": "...",
//     "uploaded_by": "<teacher profile id>",          optional
//     "sources": [ { "activity_id": "...",
//                    "slots": [ { "slot": "notes", "extensions": ["pdf"], "name_contains": ["note"] } ] } ] }
//
// For each pupil with a submission to any source activity, the source's
// latest attempt's current files are read (past versions dropped, see
// src/lib/storage/file-versions.ts). Per slot, the files whose extension is
// listed (earlier extensions preferred) and whose name contains one of
// `name_contains` (case-insensitive, separators ignored) are candidates, the
// most recently uploaded first; extra candidates are reported as ambiguities.
// The file goes in through storePracticalFile as a teacher, so every check an
// upload gets runs here too: a refused file (.ppt, damaged) is reported with
// the reader's message and the next candidate tried.
//
// `uploaded_by` defaults to a teacher of the pupil's class among the classes
// the lesson is set to (lowest profile id when there are several), then any
// teacher of any class the lesson is set to. Units have no owner, so there is
// no unit fallback; set `uploaded_by` when no teacher is in those classes.
//
// Dry run by default: everything is read and checked, nothing is written. A
// slot that already has a file is left alone, and so is a pupil who has
// handed in, unless --replace (and even then a slot holding the same bytes is
// left alone, so re-running copies nothing twice). Replacing a handed-in
// pupil's file clears the AI marks and re-queues marking (storePracticalFile).
// --hand-in hands in, as the teacher, every pupil not yet handed in whose
// required slots are all filled: that queues real AI marking, so it also
// needs --confirmed (the wrapper asks first).
//
// Pupil names are never printed. The result JSON carries ids and the pupils'
// file names (which the teacher needs to resolve an ambiguity).

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"

import { query } from "@/lib/db"
import { assertPupilSitsAssessment } from "@/lib/assessment-paper/files"
import {
  PracticalFileRefusal,
  checkSlotFile,
  handInPowerPointAssessment,
  listPracticalFiles,
  readPracticalSlots,
  storePracticalFile,
} from "@/lib/powerpoint-assessment/files"
import { pastVersionNames } from "@/lib/storage/file-versions"
import { isPowerPointAssessmentType } from "@/dino.config"
import { PowerPointAssessmentActivityBodySchema, type PowerPointUploadSlot } from "@/types"

type MappingSlot = { slot: string; extensions: string[]; name_contains?: string[] }
type MappingSource = { activity_id: string; slots: MappingSlot[] }
type Mapping = { target_activity_id: string; uploaded_by?: string; sources: MappingSource[] }

type Args = {
  mapping: string
  apply: boolean
  handIn: boolean
  confirmed: boolean
  replace: boolean
  fallbackRoot: string | null
  out: string | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mapping: "", apply: false, handIn: false, confirmed: false, replace: false, fallbackRoot: null, out: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--mapping") args.mapping = argv[++i] ?? ""
    else if (arg === "--apply") args.apply = true
    else if (arg === "--hand-in") args.handIn = true
    else if (arg === "--confirmed") args.confirmed = true
    else if (arg === "--replace") args.replace = true
    else if (arg === "--fallback-root") args.fallbackRoot = argv[++i] || null
    else if (arg === "--out") args.out = argv[++i] ?? null
    else throw new Error(`Unknown argument ${arg}`)
  }
  if (!args.mapping) throw new Error("--mapping <mapping.json> is required")
  if (args.apply && args.handIn && !args.confirmed) {
    throw new Error("--hand-in queues real AI marking; pass --confirmed (the wrapper asks first)")
  }
  return args
}

function parseMapping(raw: unknown): Mapping {
  const m = raw as Mapping
  if (!m || typeof m.target_activity_id !== "string" || !Array.isArray(m.sources) || m.sources.length === 0) {
    throw new Error("The mapping needs target_activity_id and at least one source")
  }
  if (m.uploaded_by !== undefined && typeof m.uploaded_by !== "string") throw new Error("uploaded_by must be a profile id")
  for (const source of m.sources) {
    if (typeof source.activity_id !== "string" || !Array.isArray(source.slots) || source.slots.length === 0) {
      throw new Error("Each source needs activity_id and at least one slot")
    }
    for (const slot of source.slots) {
      if (typeof slot.slot !== "string" || !Array.isArray(slot.extensions) || slot.extensions.length === 0) {
        throw new Error(`Source ${source.activity_id}: each slot needs slot and extensions`)
      }
      if (slot.name_contains !== undefined && !Array.isArray(slot.name_contains)) {
        throw new Error(`Source ${source.activity_id}, slot ${slot.slot}: name_contains must be a list`)
      }
    }
  }
  return m
}

/** Lower case, separators (space _ - .) collapsed to nothing, so "Full_Page" matches "full page". */
function normalise(value: string) {
  return value.toLowerCase().replace(/[\s_.\-]+/g, "")
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase()
}

function stem(name: string) {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? name : name.slice(0, dot)
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex")
}

type SourceFile = { name: string; path: string; uploadedAt: string; sourceActivityId: string }

/** The latest attempt's current files on a source activity. */
async function currentSourceFiles(activityId: string, pupilId: string): Promise<SourceFile[]> {
  const { rows } = await query<{ body: unknown; submitted_at: Date | null }>(
    `select body, submitted_at from submissions
      where activity_id = $1 and user_id = $2
      order by attempt_number desc, submitted_at desc nulls last, submission_id desc
      limit 1`,
    [activityId, pupilId],
  )
  const latest = rows[0]
  if (!latest) return []
  const record = (latest.body ?? {}) as { uploaded_files?: unknown }
  const fallbackDate = latest.submitted_at ? new Date(latest.submitted_at).toISOString() : ""
  const files: SourceFile[] = Array.isArray(record.uploaded_files)
    ? record.uploaded_files
      .filter((f): f is { name: string; path?: unknown; uploaded_at?: unknown } =>
        typeof f === "object" && f !== null && typeof (f as { name?: unknown }).name === "string")
      .map((f) => ({
        name: f.name,
        path: typeof f.path === "string" ? f.path : "",
        uploadedAt: typeof f.uploaded_at === "string" ? f.uploaded_at : fallbackDate,
        sourceActivityId: activityId,
      }))
    : []
  const past = pastVersionNames(files.map((f) => f.name))
  return files.filter((f) => !past.has(f.name))
}

const LESSONS_BUCKET = "lessons"

/**
 * A source file's bytes: the stored_files row's stored_path under the app's
 * files root, then under the fallback root; without a row, the bucket path
 * itself. Null when it is on neither.
 */
async function readSourceBytes(file: SourceFile, fallbackRoot: string | null): Promise<Buffer | null> {
  if (!file.path) return null
  const cleaned = file.path.replace(/^\/+/, "")
  const parts = cleaned.split("/")
  const fileName = parts.pop() ?? ""
  const scope = parts.join("/").replace(new RegExp(`^${LESSONS_BUCKET}/`), "")
  const { rows } = await query<{ stored_path: string }>(
    "select stored_path from stored_files where bucket = $1 and scope_path = $2 and file_name = $3 limit 1",
    [LESSONS_BUCKET, scope, fileName],
  )
  const relative = rows[0]?.stored_path ?? `${LESSONS_BUCKET}/${scope}/${fileName}`
  const roots = [path.join(process.cwd(), "files"), ...(fallbackRoot ? [fallbackRoot] : [])]
  for (const root of roots) {
    const full = path.join(root, relative)
    if (!full.startsWith(path.resolve(root) + path.sep)) continue
    try {
      return await fs.readFile(full)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return null
}

type SlotOutcome = {
  status: "copied" | "would_copy" | "skipped" | "refused" | "missing" | "no_file" | "error"
  reason?: string
  source_activity_id?: string
  file?: string
  file_id?: string
  tried?: Array<{ file: string; outcome: string }>
}

type PupilResult = {
  user_id: string
  handed_in_before: boolean
  slots: Record<string, SlotOutcome>
  ambiguities: Array<{ slot: string; chosen: string; also_matched: string[] }>
  not_copied: Array<{ file: string; source_activity_id: string; reason: string }>
  required_filled: boolean
  handed_in: "yes" | "would" | "no" | "already" | string
}

function hasTeacherRoleSql(alias: string) {
  return `exists (select 1 from user_roles ur where ur.user_id = ${alias}.user_id and lower(ur.role_id) = 'teacher')`
}

async function defaultTeacherFor(lessonId: string, pupilId: string): Promise<string | null> {
  const { rows: own } = await query<{ user_id: string }>(
    `select distinct t.user_id
       from lesson_assignments la
       join group_membership p on p.group_id = la.group_id and p.user_id = $2
       join group_membership t on t.group_id = la.group_id and t.user_id <> $2
      where la.lesson_id = $1 and ${hasTeacherRoleSql("t")}
      order by t.user_id limit 1`,
    [lessonId, pupilId],
  )
  if (own[0]) return own[0].user_id
  const { rows: anyTeacher } = await query<{ user_id: string }>(
    `select distinct t.user_id
       from lesson_assignments la
       join group_membership t on t.group_id = la.group_id
      where la.lesson_id = $1 and ${hasTeacherRoleSql("t")}
      order by t.user_id limit 1`,
    [lessonId],
  )
  return anyTeacher[0]?.user_id ?? null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mapping = parseMapping(JSON.parse(await readFile(args.mapping, "utf8")))
  const targetId = mapping.target_activity_id

  const { rows: targetRows } = await query<{ lesson_id: string; type: string | null; body_data: unknown }>(
    "select lesson_id, type, body_data from activities where activity_id = $1",
    [targetId],
  )
  const target = targetRows[0]
  if (!target) throw new Error(`Target activity ${targetId} not found`)
  if (!isPowerPointAssessmentType(target.type)) throw new Error(`Target activity ${targetId} is not a PowerPoint assessment`)
  const body = PowerPointAssessmentActivityBodySchema.safeParse(target.body_data ?? {})
  if (!body.success) throw new Error(`Target activity ${targetId} has no valid upload slots`)
  const slotsByKey = new Map<string, PowerPointUploadSlot>(body.data.uploadSlots.map((s) => [s.key, s]))

  const warnings: string[] = []
  for (const source of mapping.sources) {
    const { rows } = await query<{ lesson_id: string; type: string | null }>(
      "select lesson_id, type from activities where activity_id = $1",
      [source.activity_id],
    )
    if (!rows[0]) throw new Error(`Source activity ${source.activity_id} not found`)
    if (rows[0].type !== "upload-file") warnings.push(`source ${source.activity_id} is a ${rows[0].type}, not an upload-file`)
    if (rows[0].lesson_id !== target.lesson_id) warnings.push(`source ${source.activity_id} is in another lesson`)
    for (const slot of source.slots) {
      const targetSlot = slotsByKey.get(slot.slot)
      if (!targetSlot) throw new Error(`The target has no upload slot "${slot.slot}"`)
      if (!slot.extensions.map((e) => e.toLowerCase()).includes(targetSlot.kind)) {
        warnings.push(`slot ${slot.slot} takes ${targetSlot.kind}, which its extensions do not list`)
      }
    }
  }
  const slotOrder = [...new Set(mapping.sources.flatMap((s) => s.slots.map((slot) => slot.slot)))]
  const slotsCovered = new Set(slotOrder)
  for (const slot of body.data.uploadSlots) {
    if (slot.required && !slotsCovered.has(slot.key)) warnings.push(`required slot ${slot.key} has no source in the mapping`)
  }

  if (mapping.uploaded_by) {
    const { rows } = await query("select 1 from user_roles where user_id = $1 and lower(role_id) = 'teacher'", [mapping.uploaded_by])
    if (rows.length === 0) throw new Error(`uploaded_by ${mapping.uploaded_by} is not a teacher`)
  }

  const { rows: pupilRows } = await query<{ user_id: string }>(
    "select distinct user_id from submissions where activity_id = any($1::text[]) order by user_id",
    [mapping.sources.map((s) => s.activity_id)],
  )

  const pupils: PupilResult[] = []
  for (const { user_id: pupilId } of pupilRows) {
    const state = await readPracticalSlots(targetId, pupilId)
    const result: PupilResult = {
      user_id: pupilId,
      handed_in_before: state.handedIn,
      slots: {},
      ambiguities: [],
      not_copied: [],
      required_filled: false,
      handed_in: "no",
    }
    pupils.push(result)

    const sitting = await assertPupilSitsAssessment(targetId, pupilId).then(() => null, (e: Error) => e.message)
    if (sitting) {
      for (const key of slotOrder) result.slots[key] = { status: "refused", reason: sitting }
      result.handed_in = "no: not a pupil of a class this lesson is set to"
      continue
    }

    const existingFiles = state.submissionId ? await listPracticalFiles(state.submissionId) : []
    const existingBySlot = new Map(existingFiles.map((f) => [f.slot_key, f]))
    const filledAfter = new Set(existingFiles.map((f) => f.slot_key))
    const leaveAlone = state.handedIn && !args.replace

    let teacher = mapping.uploaded_by ?? null
    if (!teacher) teacher = await defaultTeacherFor(target.lesson_id, pupilId)

    for (const source of mapping.sources) {
      const files = await currentSourceFiles(source.activity_id, pupilId)
      const used = new Set<string>()
      const chosen = new Set<string>()

      for (const slot of source.slots) {
        const extensions = slot.extensions.map((e) => e.toLowerCase().replace(/^\./, ""))
        const needles = (slot.name_contains ?? []).map(normalise).filter(Boolean)
        const candidates = files
          .filter((f) => !chosen.has(f.name))
          .filter((f) => extensions.includes(extensionOf(f.name)))
          .filter((f) => needles.length === 0 || needles.some((n) => normalise(stem(f.name)).includes(n)))
          .sort((a, b) =>
            extensions.indexOf(extensionOf(a.name)) - extensions.indexOf(extensionOf(b.name))
            || b.uploadedAt.localeCompare(a.uploadedAt))
        for (const c of candidates) used.add(c.name)

        if (candidates.length === 0) {
          result.slots[slot.slot] ??= { status: "no_file", source_activity_id: source.activity_id }
          continue
        }
        if (candidates.length > 1) {
          result.ambiguities.push({ slot: slot.slot, chosen: candidates[0].name, also_matched: candidates.slice(1).map((c) => c.name) })
        }
        chosen.add(candidates[0].name)
        if (leaveAlone) {
          result.slots[slot.slot] = { status: "skipped", reason: "already handed in, left alone", source_activity_id: source.activity_id, file: candidates[0].name }
          continue
        }
        const existing = existingBySlot.get(slot.slot)
        if (existing && !args.replace) {
          result.slots[slot.slot] = { status: "skipped", reason: "slot already has a file", source_activity_id: source.activity_id, file: candidates[0].name }
          continue
        }
        if (!teacher) {
          result.slots[slot.slot] = { status: "refused", reason: "no teacher to upload as; set uploaded_by in the mapping", source_activity_id: source.activity_id }
          continue
        }

        const targetSlot = slotsByKey.get(slot.slot)!
        const tried: Array<{ file: string; outcome: string }> = []
        let outcome: SlotOutcome | null = null
        for (const candidate of candidates) {
          const bytes = await readSourceBytes(candidate, args.fallbackRoot)
          if (!bytes) {
            tried.push({ file: candidate.name, outcome: "missing on disk" })
            continue
          }
          if (existing && existing.sha256 === sha256(bytes)) {
            outcome = { status: "skipped", reason: "slot already holds this file", source_activity_id: source.activity_id, file: candidate.name }
            break
          }
          try {
            if (args.apply) {
              const stored = await storePracticalFile({
                activityId: targetId,
                pupilId,
                slotKey: slot.slot,
                bytes,
                originalName: candidate.name,
                uploadedBy: teacher,
                byTeacher: true,
              })
              outcome = {
                status: "copied",
                source_activity_id: source.activity_id,
                file: candidate.name,
                file_id: stored.file_id,
                ...(stored.requeued ? { reason: "handed in: marks cleared and re-queued" } : {}),
              }
            } else {
              await checkSlotFile(targetSlot.kind, bytes, candidate.name)
              outcome = {
                status: "would_copy",
                source_activity_id: source.activity_id,
                file: candidate.name,
                ...(state.handedIn ? { reason: "handed in: marks would be cleared and re-queued" } : {}),
              }
            }
            filledAfter.add(slot.slot)
            break
          } catch (error) {
            if (!(error instanceof PracticalFileRefusal)) {
              outcome = { status: "error", reason: error instanceof Error ? error.message : String(error), source_activity_id: source.activity_id, file: candidate.name }
              break
            }
            tried.push({ file: candidate.name, outcome: `refused: ${error.message}` })
          }
        }
        if (!outcome) {
          const allMissing = tried.every((t) => t.outcome === "missing on disk")
          outcome = {
            status: allMissing ? "missing" : "refused",
            reason: allMissing ? "file not found under the files root or the fallback root" : tried[tried.length - 1].outcome,
            source_activity_id: source.activity_id,
          }
        }
        if (tried.length > 0) outcome.tried = tried
        result.slots[slot.slot] = outcome
      }

      for (const file of files) {
        if (used.has(file.name)) continue
        const ext = extensionOf(file.name)
        const typeTaken = source.slots.some((s) => s.extensions.map((e) => e.toLowerCase()).includes(ext))
        result.not_copied.push({
          file: file.name,
          source_activity_id: source.activity_id,
          reason: typeTaken ? "not copied (no slot's name matches)" : `not copied (type .${ext || "none"})`,
        })
      }
    }

    const missingRequired = body.data.uploadSlots.filter((s) => s.required && !filledAfter.has(s.key)).map((s) => s.key)
    result.required_filled = missingRequired.length === 0
    if (state.handedIn) result.handed_in = "already"
    else if (!args.handIn) result.handed_in = "no"
    else if (missingRequired.length > 0) result.handed_in = `no: missing ${missingRequired.join(", ")}`
    else if (!args.apply) result.handed_in = "would"
    else {
      try {
        await handInPowerPointAssessment(targetId, pupilId, { userId: teacher!, isTeacher: true })
        result.handed_in = "yes"
      } catch (error) {
        if (!(error instanceof PracticalFileRefusal)) throw error
        result.handed_in = `no: ${error.message}`
      }
    }
  }

  const count = (pred: (o: SlotOutcome) => boolean) =>
    pupils.reduce((n, p) => n + Object.values(p.slots).filter(pred).length, 0)
  const summary = {
    pupils: pupils.length,
    pupils_already_handed_in: pupils.filter((p) => p.handed_in_before).length,
    slots_copied: count((o) => o.status === "copied"),
    slots_would_copy: count((o) => o.status === "would_copy"),
    slots_skipped: count((o) => o.status === "skipped"),
    slots_refused: count((o) => o.status === "refused"),
    slots_missing: count((o) => o.status === "missing"),
    slots_no_file: count((o) => o.status === "no_file"),
    slots_error: count((o) => o.status === "error"),
    ambiguities: pupils.reduce((n, p) => n + p.ambiguities.length, 0),
    files_not_copied: pupils.reduce((n, p) => n + p.not_copied.length, 0),
    pupils_required_filled: pupils.filter((p) => p.required_filled).length,
    // Hand-in candidates and handed-in pupils whose files would change: both queue real AI marking.
    would_hand_in: pupils.filter((p) => !p.handed_in_before && p.required_filled).length,
    would_requeue: pupils.filter((p) => p.handed_in_before && Object.values(p.slots).some((o) => o.status === "would_copy" || o.status === "copied")).length,
    handed_in: pupils.filter((p) => p.handed_in === "yes").length,
  }

  const report = {
    mode: args.apply ? "apply" : "dry-run",
    options: { hand_in: args.handIn, replace: args.replace, fallback_root: args.fallbackRoot },
    target_activity_id: targetId,
    lesson_id: target.lesson_id,
    uploaded_by: mapping.uploaded_by ?? "default: a teacher of the pupil's class",
    warnings,
    summary,
    pupils,
  }
  const text = JSON.stringify(report, null, 2)
  if (args.out) await writeFile(args.out, text)

  // The table: ids and statuses only, never names.
  const code: Record<SlotOutcome["status"], string> = {
    copied: "COPIED", would_copy: "would", skipped: "skip", refused: "REFUSED", missing: "MISSING", no_file: "-", error: "ERROR",
  }
  const width = 12
  const header = ["user_id".padEnd(36), "h/in".padEnd(5), ...slotOrder.map((s) => s.slice(0, width).padEnd(width)), "amb", "other", "hand-in"]
  const lines = [header.join(" ")]
  for (const p of pupils) {
    lines.push([
      p.user_id.padEnd(36),
      (p.handed_in_before ? "yes" : "no").padEnd(5),
      ...slotOrder.map((s) => (p.slots[s] ? code[p.slots[s].status] : "-").padEnd(width)),
      String(p.ambiguities.length).padEnd(3),
      String(p.not_copied.length).padEnd(5),
      p.handed_in,
    ].join(" "))
  }
  lines.push("", JSON.stringify(summary, null, 2))
  if (warnings.length) lines.push("", ...warnings.map((w) => `warning: ${w}`))
  console.log(lines.join("\n"))

  // handInPowerPointAssessment triggers the queue processor fire-and-forget.
  if (summary.handed_in > 0) await new Promise((resolve) => setTimeout(resolve, 3000))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exit(1)
  })
