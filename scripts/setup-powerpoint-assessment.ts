// Create a PowerPoint assessment activity in a lesson from a spec file
// (scripts/powerpoint-assessments/*.json): its upload slots, supplied images,
// activity files, question paper, mark scheme and questions.
//
//   npx tsx scripts/setup-powerpoint-assessment.ts --spec <spec.json> [--apply] [--out <result.json>]
//
// Run it through scripts/setup-powerpoint-assessment.sh, which runs it beside
// the app as the app's own user. Without --apply nothing is written: the spec
// is checked against the database and the files (lesson, data files, papers,
// success criteria, evidence sources, EVIDENCE template headings) and what
// would be done is reported.
//
// The activity is found by lesson and title, so re-running is safe:
//   - an existing activity is reused, never duplicated;
//   - supplied images and activity files already there are left alone;
//   - the question paper and mark scheme are stored only when missing;
//   - questions are set only when the activity has none, so a re-run never
//     rewrites questions pupils have been marked against.
//
// Spec:
//   { "lesson_id", "title", "upload_slots": [...], "data_activity_id",
//     "supplied_images": ["LOGO.png", ...], "activity_files": ["EVIDENCE.docx", ...],
//     "evidence_template_file": "EVIDENCE.docx",
//     "question_paper": "lessons/<lesson>/.../x.pdf", "mark_scheme": "lessons/<lesson>/x.pdf",
//     "copy_mapping": "scripts/powerpoint-mappings/x.json",                   optional, used by the .sh
//     "questions": [ { "label", "max_marks", "question_text", "mark_scheme", "marking",
//                      "success_criteria_id", "evidence": [...] } ] }
//
// Paths are relative to the app's files directory. Image and activity file
// names are read from the data activity's folder.
import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { query } from "@/lib/db"
import { createActivity } from "@/lib/mcp/activities"
import { storePaperFile } from "@/lib/assessment-paper/files"
import { readAssessmentQuestions, setAssessmentQuestions, type QuestionMarking } from "@/lib/assessment-paper/store"
import { listSuppliedImages, storeSuppliedImage } from "@/lib/powerpoint-assessment/files"
import { checkActivityEvidenceTemplate } from "@/lib/powerpoint-assessment/editor"
import { evidenceHeading, powerPointBodyProblem, validateQuestionEvidence } from "@/lib/powerpoint-assessment/evidence-spec"
import { checkEvidenceTemplate } from "@/lib/docx/evidence"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

const FILES_ROOT = "/app/files"

type SpecQuestion = {
  label: string
  max_marks: number
  question_text: string
  mark_scheme: string
  marking?: QuestionMarking
  success_criteria_id: string
  evidence: unknown[]
}
type Spec = {
  lesson_id: string
  title: string
  upload_slots: unknown[]
  data_activity_id: string
  supplied_images: string[]
  activity_files: string[]
  evidence_template_file?: string
  question_paper: string
  mark_scheme: string
  copy_mapping?: string
  questions: SpecQuestion[]
}

function parseArgs(argv: string[]) {
  const args = { spec: "", apply: false, out: null as string | null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--spec") args.spec = argv[++i] ?? ""
    else if (arg === "--apply") args.apply = true
    else if (arg === "--out") args.out = argv[++i] ?? null
    else throw new Error(`Unknown argument ${arg}`)
  }
  if (!args.spec) throw new Error("--spec <spec.json> is required")
  return args
}

async function exists(file: string) {
  return stat(file).then((s) => s.isFile()).catch(() => false)
}

/** The body the activity is created with, built from the spec alone. */
function bodyFor(spec: Spec) {
  return {
    uploadSlots: spec.upload_slots,
    ...(spec.evidence_template_file ? { evidenceTemplateFile: spec.evidence_template_file } : {}),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const spec = JSON.parse(await readFile(args.spec, "utf8")) as Spec
  const problems: string[] = []
  const actions: string[] = []
  const out: Record<string, unknown> = { spec: args.spec, mode: args.apply ? "apply" : "dry-run", lesson_id: spec.lesson_id, title: spec.title }

  // --- checks (no writes) -------------------------------------------------
  const { rows: lessons } = await query<{ title: string; kind: string; unit_id: string }>(
    "select title, kind, unit_id from lessons where lesson_id = $1 and active is not false",
    [spec.lesson_id],
  )
  if (!lessons[0]) throw new Error(`Lesson ${spec.lesson_id} not found (or inactive)`)
  out.lesson = lessons[0].title
  if (lessons[0].kind !== "standard") problems.push(`Lesson is a ${lessons[0].kind} lesson, not standard`)

  const { rows: dataRows } = await query<{ lesson_id: string }>("select lesson_id from activities where activity_id = $1", [spec.data_activity_id])
  if (dataRows[0]?.lesson_id !== spec.lesson_id) problems.push(`Data activity ${spec.data_activity_id} is not in this lesson`)
  const dataDir = path.join(FILES_ROOT, "lessons", spec.lesson_id, "activities", spec.data_activity_id)
  for (const name of [...spec.supplied_images, ...spec.activity_files]) {
    if (!(await exists(path.join(dataDir, name)))) problems.push(`Missing data file ${name} in ${dataDir}`)
  }
  for (const [label, rel] of [["question paper", spec.question_paper], ["mark scheme", spec.mark_scheme]] as const) {
    if (!(await exists(path.join(FILES_ROOT, rel)))) problems.push(`Missing ${label} at files/${rel}`)
  }

  const bodyProblem = powerPointBodyProblem(bodyFor(spec))
  if (bodyProblem) problems.push(bodyProblem)

  const labels = spec.questions.map((q) => q.label)
  const duplicates = labels.filter((l, i) => labels.indexOf(l) !== i)
  if (duplicates.length) problems.push(`Duplicate question labels: ${[...new Set(duplicates)].join(", ")}`)
  const evidenceCheck = validateQuestionEvidence(
    spec.questions.map((q) => ({ label: q.label, evidence: q.evidence })) as Parameters<typeof validateQuestionEvidence>[0],
    bodyFor(spec),
  )
  problems.push(...evidenceCheck.errors)

  const criteriaIds = [...new Set(spec.questions.map((q) => q.success_criteria_id))]
  const { rows: criteria } = await query<{ success_criteria_id: string }>(
    "select success_criteria_id from success_criteria where success_criteria_id::text = any($1::text[])",
    [criteriaIds],
  )
  const found = new Set(criteria.map((c) => c.success_criteria_id))
  const missingCriteria = criteriaIds.filter((id) => !found.has(id))
  if (missingCriteria.length) problems.push(`Success criteria not found: ${missingCriteria.join(", ")}`)

  if (spec.evidence_template_file && spec.activity_files.includes(spec.evidence_template_file)) {
    const templatePath = path.join(dataDir, spec.evidence_template_file)
    if (await exists(templatePath)) {
      const headings = [...new Set(spec.questions.flatMap((q) =>
        (q.evidence as Array<{ source?: string; heading?: string }>)
          .filter((e) => e?.source === "evidence_section")
          .map((e) => evidenceHeading(e, q.label))))]
      const missing = await checkEvidenceTemplate(await readFile(templatePath), headings)
      out.templateHeadings = headings
      if (missing.length) problems.push(`EVIDENCE template has no heading for: ${missing.join(", ")}`)
    }
  } else if (spec.evidence_template_file) {
    problems.push(`evidence_template_file ${spec.evidence_template_file} is not in activity_files`)
  }

  out.questions = spec.questions.length
  out.marks = spec.questions.reduce((sum, q) => sum + q.max_marks, 0)

  const { rows: existing } = await query<{ activity_id: string; body_data: Record<string, unknown> | null }>(
    "select activity_id, body_data from activities where lesson_id = $1 and title = $2 and type = 'powerpoint-assessment' and active is not false",
    [spec.lesson_id, spec.title],
  )
  if (existing.length > 1) problems.push(`${existing.length} activities named "${spec.title}" in this lesson`)

  out.problems = problems
  if (problems.length) {
    out.actions = actions
    await finish(args.out, out)
    console.error(`Problems:\n  - ${problems.join("\n  - ")}`)
    process.exit(2)
  }

  // --- plan / apply -------------------------------------------------------
  let activityId = existing[0]?.activity_id ?? null
  if (activityId) actions.push(`reuse activity ${activityId}`)
  else {
    actions.push("create the activity")
    if (args.apply) {
      const created = await createActivity(spec.lesson_id, "powerpoint-assessment" as never, spec.title, bodyFor(spec))
      activityId = created.activity_id
      actions.push(`created ${activityId}`)
    }
  }
  out.activity_id = activityId

  const haveImages = new Set(activityId ? (await listSuppliedImages(activityId)).map((i) => i.name) : [])
  const imageWarnings: Record<string, string[]> = {}
  for (const file of spec.supplied_images) {
    if (haveImages.has(file.replace(/\.[^.]+$/, ""))) continue
    actions.push(`add supplied image ${file}`)
    if (args.apply && activityId) {
      const result = await storeSuppliedImage({ activityId, fileName: file, bytes: await readFile(path.join(dataDir, file)), uploadedBy: null })
      if (result.warnings.length) imageWarnings[file] = result.warnings
    }
  }
  out.imageWarnings = imageWarnings

  const storage = createLocalStorageClient("lessons")
  for (const name of spec.activity_files) {
    const target = `lessons/${spec.lesson_id}/activities/${activityId ?? "<new>"}/${name}`
    if (activityId && (await storage.stat(target))) continue
    actions.push(`add activity file ${name}`)
    if (args.apply && activityId) {
      const { error } = await storage.upload(target, await readFile(path.join(dataDir, name)), {
        contentType: name.endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/octet-stream",
        uploadedBy: "script",
        originalPath: name,
      })
      if (error) throw new Error(`upload ${name}: ${error.message}`)
    }
  }

  const body = (activityId ? (await query<{ body_data: Record<string, unknown> | null }>(
    "select body_data from activities where activity_id = $1", [activityId])).rows[0]?.body_data : null) ?? {}
  for (const [kind, key, rel] of [
    ["question_paper", "questionPaperPath", spec.question_paper],
    ["mark_scheme", "markSchemePath", spec.mark_scheme],
  ] as const) {
    if (body[key]) continue
    actions.push(`store the ${kind.replace("_", " ")}`)
    if (args.apply && activityId) await storePaperFile(activityId, kind, await readFile(path.join(FILES_ROOT, rel)), null)
  }

  const current = activityId ? await readAssessmentQuestions(activityId) : []
  if (current.length > 0) {
    actions.push(`keep the ${current.length} questions already set (not rewritten)`)
  } else {
    actions.push(`set ${spec.questions.length} questions (${out.marks} marks)`)
    if (args.apply && activityId) {
      await setAssessmentQuestions(activityId, spec.questions.map((q) => ({
        label: q.label,
        maxMarks: q.max_marks,
        questionText: q.question_text,
        markScheme: q.mark_scheme,
        marking: q.marking ?? "ai",
        dependsOn: null,
        evidence: q.evidence,
        criteria: [{ successCriteriaId: q.success_criteria_id, maxMarks: q.max_marks }],
      })) as Parameters<typeof setAssessmentQuestions>[1])
    }
  }

  if (args.apply && activityId) {
    const saved = await readAssessmentQuestions(activityId)
    const { rows } = await query<{ max_marks: number | null }>("select max_marks from activities where activity_id = $1", [activityId])
    out.saved = { questions: saved.length, marks: saved.reduce((s, q) => s + q.maxMarks, 0), max_marks: rows[0]?.max_marks }
    out.templateCheck = await checkActivityEvidenceTemplate(activityId)
  }
  out.actions = actions
  await finish(args.out, out)

  console.log(`${spec.title} — lesson "${out.lesson}"`)
  for (const action of actions) console.log(`  ${args.apply ? "done" : "would"}: ${action}`)
  for (const [file, warnings] of Object.entries(imageWarnings)) console.log(`  warning (${file}): ${warnings.join("; ")}`)
}

async function finish(file: string | null, out: Record<string, unknown>) {
  if (file) await writeFile(file, JSON.stringify(out, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
