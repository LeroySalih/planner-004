// Fold the old assessment papers (src/lib/assessments, migrations 104/113–115)
// into assessment-paper activities in their host lessons.
//
//   npx tsx scripts/fold-assessment-papers.ts --mapping <fold-mapping.json> [--apply] [--out <result.json>]
//
// Only the papers in the mapping are folded, so a mapping with one paper
// (e.g. scripts/fold-mappings/systems-assessment-1.json) folds just that one.
//
// Dry run by default: reads everything, writes nothing, prints the plan. With
// --apply it creates (or, on a re-run, brings up to date) one activity per
// paper — the three Isometric papers share one — keyed by
// body_data.foldedFromAssessmentIds, so running it again never duplicates.
//
// The old assessment tables are only read, except that each folded paper is
// set inactive once all its pupils are across. Old marks become legacy question
// rows (every criterion on a question records the question's mark), old
// went-well/targets become the overall teacher feedback, and old pupil scripts
// are attached without marking. Nothing is sent to a model.
//
// Run where `files/` is the storage root (the app's working directory), with
// poppler-utils installed. `server-only` must resolve (stub it with NODE_PATH).

import { readFile, writeFile } from "node:fs/promises"

import { query, withDbClient } from "@/lib/db"
import { attachLegacyScript, storePaperFile, type PaperFileKind } from "@/lib/assessment-paper/files"
import {
  readAssessmentQuestions,
  recordLegacyQuestionMark,
  setAssessmentQuestions,
  type AssessmentQuestionInput,
} from "@/lib/assessment-paper/store"
import { applyTeacherActivityFeedback } from "@/lib/feedback/teacher-feedback"
import { createLocalStorageClient } from "@/lib/storage/local-storage"

type MappingQuestion = {
  assessment_id: string
  question_id: string
  label: string
  max_marks: number
  paper_lo_code: string
  proposed_sc_ids: string
  note: string
}
type MappingPaper = {
  assessment_id: string
  paper_title: string
  host_lesson_id: string
  questions_needing_new_sc: string[]
  questions: MappingQuestion[]
}

// New success criteria Leroy approved where no existing one fits, drafted from
// each question's mark scheme: one skill each, binary. A question listed here
// is tested by its new criterion alone (it replaces the stand-in proposed for
// it). `lo` is the learning objective the paper's objective maps to, except
// Systems LO6 (Design modification), which is linked to no objective: its two
// go under the paper's LO1, "describe an electronic product as a system of
// inputs, processes and outputs", the objective a design modification adding
// input and output components exercises.
const NEW_CRITERIA: Array<{ assessmentId: string; labels: string[]; lo: string; description: string }> = [
  {
    assessmentId: "6a122b4e-106f-4eaa-b06a-4a35066b67ac", labels: ["Q9 A4vi"],
    lo: "92c9c086-ec85-40a5-9802-5ac83b13ba1b",
    description: "I can identify a weakness in an image I have made and suggest an improvement that fixes it.",
  },
  {
    assessmentId: "65a07775-d7dc-44b7-a651-f9daa4e404bc", labels: ["Q4(a)"],
    lo: "74c5c025-a0c3-41a2-bc7c-f266b41a2c38",
    description: "I can tell paper from board by its weight (board is over 220 gsm).",
  },
  {
    assessmentId: "65a07775-d7dc-44b7-a651-f9daa4e404bc", labels: ["Q4(b)"],
    lo: "74c5c025-a0c3-41a2-bc7c-f266b41a2c38",
    description: "I can give the typical weight of copier paper in gsm (about 80 gsm).",
  },
  {
    assessmentId: "65a07775-d7dc-44b7-a651-f9daa4e404bc", labels: ["Q4(d)"],
    lo: "74c5c025-a0c3-41a2-bc7c-f266b41a2c38",
    description: "I can state that paper and board are made from wood pulp (cellulose fibres).",
  },
  {
    assessmentId: "86ba9d0a-d070-46ce-a9be-506b14a44d45", labels: ["Q22 bullet 1"],
    lo: "fe818128-3b74-488d-8235-7f0b6118a787",
    description: "I can add an input component to a product design that senses the condition the product must respond to.",
  },
  {
    assessmentId: "86ba9d0a-d070-46ce-a9be-506b14a44d45", labels: ["Q22 bullet 2"],
    lo: "fe818128-3b74-488d-8235-7f0b6118a787",
    description: "I can add an output component to a product design and connect it to the control circuit so it responds at the right time.",
  },
  {
    assessmentId: "445eb3a7-2a5e-44df-916b-87dbed60c8c6", labels: ["Q25"],
    lo: "729d6310-c9dd-49b1-9428-c2d6b88cdab7",
    description: "I can explain a drawback of open source software with a linked consequence.",
  },
  {
    assessmentId: "445eb3a7-2a5e-44df-916b-87dbed60c8c6", labels: ["Q31"],
    lo: "729d6310-c9dd-49b1-9428-c2d6b88cdab7",
    description: "I can explain an advantage of proprietary software with a linked consequence.",
  },
  {
    assessmentId: "0bee4ed5-90e8-4b46-a37e-2c664851cb31", labels: ["Q11"],
    lo: "7e4a9a3b-808a-461f-adc9-b936496dde8e",
    description: "I can describe a task an embedded system carries out inside a product.",
  },
  {
    assessmentId: "0bee4ed5-90e8-4b46-a37e-2c664851cb31", labels: ["Q13"],
    lo: "7e4a9a3b-808a-461f-adc9-b936496dde8e",
    description: "I can explain a limitation of an embedded system for its user.",
  },
  {
    assessmentId: "0bee4ed5-90e8-4b46-a37e-2c664851cb31", labels: ["Q18"],
    lo: "7e4a9a3b-808a-461f-adc9-b936496dde8e",
    description: "I can name devices that a smartphone can connect to.",
  },
  {
    assessmentId: "0bee4ed5-90e8-4b46-a37e-2c664851cb31", labels: ["Q23"],
    lo: "acbe32db-96e0-4bc3-b33a-08e67f83ed57",
    description: "I can explain how a sensor in a device detects a condition and what output the device then gives.",
  },
  {
    assessmentId: "0bee4ed5-90e8-4b46-a37e-2c664851cb31", labels: ["Q25"],
    lo: "f91b7b40-fedb-48a2-b756-02bd7c307069",
    description: "I can describe how a PIN protects a device: it is stored, compared with what is typed and access is allowed or refused.",
  },
]

// Question paper and mark scheme per paper, from the reviewed files list:
// PDFs only. `bucket/path` is the storage path the file is read through.
const PAPER_FILES: Record<string, Partial<Record<PaperFileKind, { bucket: string; path: string }>>> = {
  "6a122b4e-106f-4eaa-b06a-4a35066b67ac": {
    question_paper: { bucket: "lessons", path: "f67fa987-9007-44fc-adc3-a0e6ced6a2fb/Graphics Assessment - Up and Away Events.pdf" },
    mark_scheme: { bucket: "lessons", path: "f67fa987-9007-44fc-adc3-a0e6ced6a2fb/Graphics Assessment - Mark Scheme.pdf" },
  },
  isometric: {
    question_paper: { bucket: "lessons", path: "533c5865-1dd9-485e-bf20-8deb4683de10/Isometric Drawing - Curved Block with Cylinder.pdf" },
  },
  "65a07775-d7dc-44b7-a651-f9daa4e404bc": {
    question_paper: { bucket: "assessments", path: "65a07775-d7dc-44b7-a651-f9daa4e404bc/Practice Assessment B - Question Paper.pdf" },
    mark_scheme: { bucket: "assessments", path: "65a07775-d7dc-44b7-a651-f9daa4e404bc/Practice Assessment B - Mark Scheme.pdf" },
  },
  "86ba9d0a-d070-46ce-a9be-506b14a44d45": {
    // The dated copy is the version the re-upload replaced.
    question_paper: { bucket: "lessons", path: "46286a57-d2f6-4648-810c-ca753aaa1a89/Systems Assessment 1 - Question Paper.pdf" },
    mark_scheme: { bucket: "lessons", path: "46286a57-d2f6-4648-810c-ca753aaa1a89/Systems Assessment 1 - Mark Scheme.pdf" },
  },
}
const DOCX_ONLY: Record<string, string[]> = {
  "445eb3a7-2a5e-44df-916b-87dbed60c8c6": [
    "YEAR_10_ICT_ASSESSMENT_2.docx", "YEAR_10_ICT_ASSESSMENT_2_QUESTIONS.docx",
    "YEAR_10_ICT_ASSESSMENT_2_PAST_PAPER_QUESTIONS.docx", "YEAR_10_ICT_ASSESSMENT_2_SUMMARY.docx",
  ],
  "0bee4ed5-90e8-4b46-a37e-2c664851cb31": [
    "YEAR_10_ICT_OCT_ASSESSMENT_V2.docx", "YEAR_10_ICT_OCT_ASSESSMENT_QUESTIONS_V2 (1).docx",
  ],
}

const ISOMETRIC_IDS = [
  "1cd42fff-93d6-48fc-902d-6c0f9377df9a", // 8B
  "aecec493-1f58-42e7-8a35-c3285ccaf625", // 8C
  "0cca1e06-8051-4333-908b-8b5589da68de", // 8D
]

// Per-pupil files named "...-Feedback.pdf" are the old module's generated
// feedback sheets (criteria met, how to improve), not the pupil's work: never
// a script for the marker.
const FEEDBACK_SHEET = /-Feedback\.pdf$/i

type Args = { apply: boolean; mapping: string; out: string | null }

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, mapping: "", out: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--apply") args.apply = true
    else if (arg === "--dry-run") args.apply = false
    else if (arg === "--mapping") args.mapping = argv[++i] ?? ""
    else if (arg === "--out") args.out = argv[++i] ?? null
    else throw new Error(`Unknown argument ${arg}`)
  }
  if (!args.mapping) throw new Error("--mapping <fold-mapping.json> is required")
  return args
}

function ddmmyyyy(value: Date | string): string {
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`
}

async function readFromStorage(bucket: string, storagePath: string): Promise<Buffer | null> {
  const { stream, error } = await createLocalStorageClient(bucket).getFileStream(storagePath)
  if (error || !stream) return null
  try {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  } catch {
    return null
  }
}

/** Even split, remainder to the first. Callers keep criteria.length <= marks. */
function splitMarks(marks: number, count: number): number[] {
  const base = Math.floor(marks / count)
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? marks % count : 0))
}

type Group = {
  key: string
  assessmentIds: string[]
  canonical: MappingPaper
  title: string
  hostLessonId: string
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mapping = JSON.parse(await readFile(args.mapping, "utf8")) as { papers: MappingPaper[] }
  const mode = args.apply ? "apply" : "dry-run"
  const report: Record<string, unknown> = { mode, ran_at: new Date().toISOString() }

  // Papers, the Isometric three as one group.
  const groups: Group[] = []
  const isometric = mapping.papers.filter((p) => ISOMETRIC_IDS.includes(p.assessment_id))
  for (const paper of mapping.papers.filter((p) => !ISOMETRIC_IDS.includes(p.assessment_id))) {
    groups.push({ key: paper.assessment_id, assessmentIds: [paper.assessment_id], canonical: paper, title: paper.paper_title, hostLessonId: paper.host_lesson_id })
  }
  if (isometric.length > 0) {
    const canonical = isometric.find((p) => p.assessment_id === ISOMETRIC_IDS[0]) ?? isometric[0]
    for (const other of isometric) {
      const shape = (p: MappingPaper) => JSON.stringify(p.questions.map((q) => [q.label, q.max_marks, q.proposed_sc_ids]))
      if (shape(other) !== shape(canonical) || other.host_lesson_id !== canonical.host_lesson_id) {
        throw new Error(`Isometric paper ${other.assessment_id} differs from ${canonical.assessment_id}; cannot fold as one.`)
      }
    }
    groups.push({
      key: "isometric",
      assessmentIds: isometric.map((p) => p.assessment_id),
      canonical,
      title: canonical.paper_title.replace(/\s*\((8[A-D])\)\s*$/, ""),
      hostLessonId: canonical.host_lesson_id,
    })
  }

  // 1. New success criteria, for the papers in this mapping only.
  const mappedIds = new Set(mapping.papers.map((p) => p.assessment_id))
  const createdCriteria: Array<{ success_criteria_id: string | null; learning_objective_id: string; description: string; for: string[]; status: string }> = []
  const newCriterionFor = new Map<string, string | null>() // `${assessmentId}::${label}` -> sc id
  for (const spec of NEW_CRITERIA.filter((c) => mappedIds.has(c.assessmentId))) {
    const { rows: lo } = await query<{ learning_objective_id: string }>(
      "select learning_objective_id from learning_objectives where learning_objective_id = $1",
      [spec.lo],
    )
    if (!lo[0]) throw new Error(`Learning objective ${spec.lo} not found for ${spec.description}`)
    const { rows: existing } = await query<{ success_criteria_id: string }>(
      "select success_criteria_id from success_criteria where learning_objective_id = $1 and description = $2 limit 1",
      [spec.lo, spec.description],
    )
    let id: string | null = existing[0]?.success_criteria_id ?? null
    let status = id ? "exists" : "to create"
    if (!id && args.apply) {
      const { rows } = await query<{ success_criteria_id: string }>(
        `insert into success_criteria (learning_objective_id, description, level, order_index, active, sc_type)
         values ($1, $2, 1,
                 coalesce((select max(order_index) + 1 from success_criteria where learning_objective_id = $1), 0),
                 true, 'binary')
         returning success_criteria_id`,
        [spec.lo, spec.description],
      )
      id = rows[0].success_criteria_id
      status = "created"
    }
    createdCriteria.push({
      success_criteria_id: id,
      learning_objective_id: spec.lo,
      description: spec.description,
      for: spec.labels.map((label) => `${spec.assessmentId} ${label}`),
      status,
    })
    for (const label of spec.labels) newCriterionFor.set(`${spec.assessmentId}::${label}`, id ?? `NEW:${spec.description}`)
  }
  report.new_success_criteria = createdCriteria

  const papersReport: unknown[] = []
  const droppedCriteria: unknown[] = []

  for (const group of groups) {
    const paper = group.canonical
    const { rows: oldPapers } = await query<{ assessment_id: string; title: string; assessed_on: Date; feedback_visible: boolean; group_ids: string[] }>(
      `select a.assessment_id::text as assessment_id, a.title, a.assessed_on, a.feedback_visible,
              coalesce(array_agg(g.group_id order by g.group_id) filter (where g.group_id is not null), '{}') as group_ids
         from assessments a left join assessment_groups g on g.assessment_id = a.assessment_id
        where a.assessment_id = any($1::uuid[])
        group by a.assessment_id order by a.assessed_on, a.created_at`,
      [group.assessmentIds],
    )
    if (oldPapers.length !== group.assessmentIds.length) throw new Error(`Old paper missing for ${group.key}`)

    const { rows: oldQuestions } = await query<{ assessment_id: string; question_id: string; label: string; max_marks: number; correct_answer: string | null; position: number }>(
      `select assessment_id::text as assessment_id, question_id::text as question_id, label, max_marks, correct_answer, position
         from assessment_questions where assessment_id = any($1::uuid[]) order by assessment_id, position`,
      [group.assessmentIds],
    )
    const canonicalQuestions = oldQuestions.filter((q) => q.assessment_id === paper.assessment_id)
    const mappingByOldId = new Map(paper.questions.map((q) => [q.question_id, q]))
    if (canonicalQuestions.length !== paper.questions.length) {
      throw new Error(`${paper.paper_title}: ${canonicalQuestions.length} questions in the database, ${paper.questions.length} in the mapping`)
    }

    // 2. Questions with their criteria.
    const questions: AssessmentQuestionInput[] = []
    for (const old of canonicalQuestions) {
      const mapped = mappingByOldId.get(old.question_id)
      if (!mapped || mapped.label !== old.label || Number(mapped.max_marks) !== Number(old.max_marks)) {
        throw new Error(`${paper.paper_title} ${old.label}: mapping does not match the database`)
      }
      const replacement = newCriterionFor.get(`${paper.assessment_id}::${old.label}`)
      let ids = replacement
        ? [replacement]
        : mapped.proposed_sc_ids.split(";").map((id) => id.trim()).filter(Boolean)
      if (ids.length === 0) throw new Error(`${paper.paper_title} ${old.label}: no success criterion`)
      ids = Array.from(new Set(ids))
      const maxMarks = Number(old.max_marks)
      if (ids.length > maxMarks) {
        droppedCriteria.push({ paper: group.title, question: old.label, max_marks: maxMarks, kept: ids.slice(0, maxMarks), dropped: ids.slice(maxMarks) })
        ids = ids.slice(0, maxMarks)
      }
      const allocations = splitMarks(maxMarks, ids.length)
      questions.push({
        label: old.label,
        maxMarks,
        questionText: null,
        markScheme: old.correct_answer,
        criteria: ids.map((id, i) => ({ successCriteriaId: id, maxMarks: allocations[i] })),
      })
    }
    const totalMarks = questions.reduce((sum, q) => sum + q.maxMarks, 0)

    // Unknown criteria (other than the new ones still to create) stop the run.
    const existingIds = questions.flatMap((q) => q.criteria.map((c) => c.successCriteriaId)).filter((id) => !id.startsWith("NEW:"))
    const { rows: foundSc } = await query<{ success_criteria_id: string }>(
      "select success_criteria_id from success_criteria where success_criteria_id = any($1::text[])",
      [existingIds],
    )
    const missingSc = existingIds.filter((id) => !foundSc.some((row) => row.success_criteria_id === id))
    if (missingSc.length > 0) throw new Error(`${paper.paper_title}: success criteria not found: ${missingSc.join(", ")}`)

    // 3. The activity.
    const { rows: lessonRows } = await query<{ lesson_id: string; title: string; active: boolean | null }>(
      "select lesson_id, title, active from lessons where lesson_id = $1",
      [group.hostLessonId],
    )
    if (!lessonRows[0]) throw new Error(`Host lesson ${group.hostLessonId} not found`)
    const dates = oldPapers.map((p) => `${ddmmyyyy(p.assessed_on)}${group.key === "isometric" ? ` (${p.group_ids.join(", ").replace(/^26-|-DT/g, "")})` : ""}`)
    const instructions = group.assessmentIds.length > 1
      ? `Folded in from the assessment papers of ${dates.join(", ")}.`
      : `Folded in from the assessment paper of ${dates[0]}.`
    const body = { instructions, foldedFromAssessmentIds: [...group.assessmentIds].sort() }

    const { rows: existingActivity } = await query<{ activity_id: string; title: string | null; body_data: Record<string, unknown> | null; active: boolean | null }>(
      `select activity_id, title, body_data, active from activities
        where type = 'assessment-paper' and body_data -> 'foldedFromAssessmentIds' ?| $1::text[]`,
      [group.assessmentIds],
    )
    if (existingActivity.length > 1) throw new Error(`${group.title}: more than one folded activity exists`)
    let activityId: string | null = existingActivity[0]?.activity_id ?? null
    let activityStatus = activityId ? "exists" : "to create"

    if (args.apply) {
      if (!activityId) {
        activityId = await withDbClient(async (client) => {
          await client.query("BEGIN")
          try {
            await client.query("select 1 from lessons where lesson_id = $1 for update", [group.hostLessonId])
            const { rows: order } = await client.query<{ next: number }>(
              "select coalesce(max(order_by) + 1, 0)::int as next from activities where lesson_id = $1",
              [group.hostLessonId],
            )
            const { rows } = await client.query<{ activity_id: string }>(
              `insert into activities (lesson_id, title, type, body_data, is_summative, order_by, max_marks, active)
               values ($1, $2, 'assessment-paper', $3, true, $4, 1, true)
               returning activity_id`,
              [group.hostLessonId, group.title, body, order[0].next],
            )
            await client.query("COMMIT")
            return rows[0].activity_id
          } catch (error) {
            await client.query("ROLLBACK")
            throw error
          }
        })
        activityStatus = "created"
      } else {
        const current = existingActivity[0]
        const currentBody = current.body_data ?? {}
        if (current.title !== group.title || currentBody.instructions !== instructions
          || JSON.stringify(currentBody.foldedFromAssessmentIds) !== JSON.stringify(body.foldedFromAssessmentIds)) {
          await query(
            `update activities set title = $2, body_data = coalesce(body_data, '{}'::jsonb) || $3::jsonb
              where activity_id = $1`,
            [activityId, group.title, JSON.stringify(body)],
          )
          activityStatus = "updated"
        }
      }

      // Questions: written only when they differ, so a re-run changes nothing.
      const resolved = questions.map((q) => ({
        ...q,
        criteria: q.criteria.map((c) => {
          if (!c.successCriteriaId.startsWith("NEW:")) return c
          const created = createdCriteria.find((sc) => `NEW:${sc.description}` === c.successCriteriaId)
          if (!created?.success_criteria_id) throw new Error(`New criterion not created: ${c.successCriteriaId}`)
          return { ...c, successCriteriaId: created.success_criteria_id }
        }),
      }))
      const shape = (list: Array<{ label: string; maxMarks: number; markScheme?: string | null; criteria: Array<{ successCriteriaId: string; maxMarks: number }> }>) =>
        JSON.stringify(list.map((q) => [q.label, q.maxMarks, q.markScheme?.trim() || null, q.criteria.map((c) => [c.successCriteriaId, c.maxMarks])]))
      const stored = await readAssessmentQuestions(activityId)
      if (shape(stored) !== shape(resolved)) {
        await setAssessmentQuestions(activityId, resolved)
      }
    }

    // 4. Paper files.
    const filesReport: unknown[] = []
    const fileSpecs = PAPER_FILES[group.key] ?? {}
    for (const kind of ["question_paper", "mark_scheme"] as PaperFileKind[]) {
      const spec = fileSpecs[kind]
      if (!spec) {
        filesReport.push({ kind, status: "none known" })
        continue
      }
      const { rows: sf } = await query<{ stored_path: string; size_bytes: string | null }>(
        "select stored_path, size_bytes from stored_files where bucket = $1 and scope_path || '/' || file_name = $2",
        [spec.bucket, spec.path],
      )
      if (!sf[0]) {
        filesReport.push({ kind, source: `${spec.bucket}/${spec.path}`, status: "no stored_files row" })
        continue
      }
      let alreadyThere = false
      if (activityId) {
        const { rows: a } = await query<{ path: string | null }>(
          `select body_data ->> $2 as path from activities where activity_id = $1`,
          [activityId, kind === "question_paper" ? "questionPaperPath" : "markSchemePath"],
        )
        if (a[0]?.path) {
          const { rows: there } = await query(
            "select 1 from stored_files where bucket = 'assessment-scripts' and scope_path || '/' || file_name = $1",
            [a[0].path],
          )
          alreadyThere = there.length > 0
        }
      }
      if (alreadyThere) {
        filesReport.push({ kind, source: `${spec.bucket}/${spec.path}`, status: "already copied" })
        continue
      }
      const bytes = await readFromStorage(spec.bucket, spec.path)
      if (!bytes) {
        filesReport.push({ kind, source: `${spec.bucket}/${spec.path}`, status: "missing on disk" })
        continue
      }
      if (args.apply && activityId) {
        await storePaperFile(activityId, kind, bytes)
        filesReport.push({ kind, source: `${spec.bucket}/${spec.path}`, status: "copied", bytes: bytes.byteLength })
      } else {
        filesReport.push({ kind, source: `${spec.bucket}/${spec.path}`, status: "to copy", bytes: bytes.byteLength })
      }
    }
    for (const assessmentId of group.assessmentIds) {
      for (const name of DOCX_ONLY[assessmentId] ?? []) filesReport.push({ kind: "unusable", source: name, status: "docx, not copied" })
    }

    // 5. Pupils.
    const { rows: marks } = await query<{ assessment_id: string; pupil_id: string; label: string; awarded: number; why_not_awarded: string | null; how_to_improve: string | null }>(
      `select m.assessment_id::text as assessment_id, m.pupil_id, q.label, m.awarded, m.why_not_awarded, m.how_to_improve
         from assessment_question_marks m
         join assessment_questions q on q.question_id = m.question_id and q.assessment_id = m.assessment_id
        where m.assessment_id = any($1::uuid[])
        order by m.pupil_id, q.position`,
      [group.assessmentIds],
    )
    const { rows: feedbackRows } = await query<{ assessment_id: string; pupil_id: string; went_well: string[]; targets: string[] }>(
      "select assessment_id::text as assessment_id, pupil_id, went_well, targets from assessment_pupil_feedback where assessment_id = any($1::uuid[])",
      [group.assessmentIds],
    )
    const { rows: pupilFiles } = await query<{ assessment_id: string; pupil_id: string; file_name: string }>(
      "select assessment_id::text as assessment_id, pupil_id, file_name from assessment_pupil_files where assessment_id = any($1::uuid[]) order by linked_at",
      [group.assessmentIds],
    )
    const paperOf = new Map(oldPapers.map((p) => [p.assessment_id, p]))

    const pupils = Array.from(new Set(marks.map((m) => m.pupil_id)))
    const pupilPapers = new Map<string, Set<string>>()
    for (const m of marks) {
      if (!pupilPapers.has(m.pupil_id)) pupilPapers.set(m.pupil_id, new Set())
      pupilPapers.get(m.pupil_id)!.add(m.assessment_id)
    }
    const inTwoPapers = pupils.filter((p) => (pupilPapers.get(p)?.size ?? 0) > 1)
    if (inTwoPapers.length > 0) throw new Error(`${group.title}: ${inTwoPapers.length} pupil(s) have marks on more than one of the papers folded together`)

    const { rows: roster } = await query<{ user_id: string }>(
      `select distinct gm.user_id from lesson_assignments la join group_membership gm on gm.group_id = la.group_id
        where la.lesson_id = $1`,
      [group.hostLessonId],
    )
    const rosterIds = new Set(roster.map((r) => r.user_id))

    const counts = {
      pupils: pupils.length,
      pupils_not_in_host_lesson_classes: pupils.filter((p) => !rosterIds.has(p)).length,
      submissions_created: 0,
      question_marks_written: 0,
      question_marks_unchanged: 0,
      question_marks_kept_newer: 0,
      feedback_written: 0,
      feedback_unchanged: 0,
      feedback_without_text: 0,
      scripts_attached: 0,
      scripts_already_attached: 0,
      scripts_missing_on_disk: 0,
      feedback_sheets_skipped: 0,
      scripts_failed: [] as string[],
    }
    const questionIdByLabel = new Map<string, string>()
    if (activityId) {
      for (const q of await readAssessmentQuestions(activityId)) questionIdByLabel.set(q.label, q.questionId)
    }

    for (const pupilId of pupils) {
      const oldPaperId = Array.from(pupilPapers.get(pupilId)!)[0]
      const oldPaper = paperOf.get(oldPaperId)!
      const pupilMarks = marks.filter((m) => m.pupil_id === pupilId)
      const fb = feedbackRows.find((f) => f.pupil_id === pupilId && f.assessment_id === oldPaperId)
      const files = pupilFiles.filter((f) => f.pupil_id === pupilId && f.assessment_id === oldPaperId)

      if (!args.apply || !activityId) {
        for (const f of files) {
          if (FEEDBACK_SHEET.test(f.file_name)) counts.feedback_sheets_skipped += 1
          else if (!(await readFromStorage("assessments", `${oldPaperId}/${f.file_name}`))) counts.scripts_missing_on_disk += 1
        }
        continue
      }

      // The pupil's submission: their latest, or a new first attempt.
      const { rows: latest } = await query<{ submission_id: string }>(
        `select submission_id from submissions where activity_id = $1 and user_id = $2
          order by attempt_number desc, submitted_at desc nulls last, submission_id desc limit 1`,
        [activityId, pupilId],
      )
      let submissionId = latest[0]?.submission_id
      if (!submissionId) {
        const { rows } = await query<{ submission_id: string }>(
          `insert into submissions (activity_id, user_id, attempt_number, body, submitted_at, submission_status, mark_status)
           values ($1, $2, 1, '{}'::json, $3, 'submitted', 'marked')
           returning submission_id`,
          [activityId, pupilId, oldPaper.assessed_on],
        )
        submissionId = rows[0].submission_id
        counts.submissions_created += 1
      }

      for (const m of pupilMarks) {
        const questionId = questionIdByLabel.get(m.label)
        if (!questionId) throw new Error(`${group.title}: question ${m.label} not on the activity`)
        const why = m.why_not_awarded?.trim() || null
        const how = m.how_to_improve?.trim() || null
        const { rows: current } = await query<{ provenance: string; awarded: number; criteria_ok: boolean }>(
          `select qm.provenance, qm.awarded,
                  (select count(*) = (select count(*) from activity_question_criteria c where c.question_id = $2)
                          and bool_and(cm.provenance = 'legacy' and cm.awarded = $3
                                       and cm.why_not_awarded is not distinct from $4
                                       and cm.how_to_improve is not distinct from $5)
                     from submission_question_criterion_marks cm
                    where cm.submission_id = $1 and cm.question_id = $2) as criteria_ok
             from submission_question_marks qm
            where qm.submission_id = $1 and qm.question_id = $2`,
          [submissionId, questionId, Number(m.awarded), why, how],
        )
        const row = current[0]
        if (row && row.provenance !== "legacy") {
          counts.question_marks_kept_newer += 1
          continue
        }
        if (row && Number(row.awarded) === Number(m.awarded) && row.criteria_ok) {
          counts.question_marks_unchanged += 1
          continue
        }
        await recordLegacyQuestionMark(submissionId, questionId, Number(m.awarded), why, how)
        counts.question_marks_written += 1
      }

      // Overall feedback, as the results page saves it.
      const parts: string[] = []
      if (fb && fb.went_well.length > 0) parts.push(`What went well: ${fb.went_well.map((s) => s.trim()).filter(Boolean).join(" ")}`)
      if (fb && fb.targets.length > 0) parts.push(`Targets: ${fb.targets.map((s) => s.trim()).filter(Boolean).join(" ")}`)
      const feedbackText = parts.join("\n")
      if (!feedbackText) {
        counts.feedback_without_text += 1
      } else {
        const { rows: latestFeedback } = await query<{ feedback_text: string | null }>(
          `select feedback_text from pupil_activity_feedback
            where activity_id = $1 and pupil_id = $2 and source = 'teacher'
            order by created_at desc limit 1`,
          [activityId, pupilId],
        )
        const { rows: bodyRow } = await query<{ teacher_feedback: string | null }>(
          "select body::jsonb ->> 'teacher_feedback' as teacher_feedback from submissions where submission_id = $1",
          [submissionId],
        )
        if (latestFeedback[0]?.feedback_text === feedbackText && bodyRow[0]?.teacher_feedback === feedbackText) {
          counts.feedback_unchanged += 1
        } else {
          const result = await applyTeacherActivityFeedback({ submissionId, feedback: feedbackText }, null)
          if (!result.success) throw new Error(`Feedback not saved: ${result.error}`)
          counts.feedback_written += 1
        }
      }

      // Old scripts, attached without marking.
      for (const f of files) {
        if (FEEDBACK_SHEET.test(f.file_name)) {
          counts.feedback_sheets_skipped += 1
          continue
        }
        const { rows: attached } = await query(
          "select 1 from assessment_scripts where activity_id = $1 and pupil_id = $2 and submission_id = $3 limit 1",
          [activityId, pupilId, submissionId],
        )
        if (attached.length > 0) {
          counts.scripts_already_attached += 1
          continue
        }
        const bytes = await readFromStorage("assessments", `${oldPaperId}/${f.file_name}`)
        if (!bytes) {
          counts.scripts_missing_on_disk += 1
          continue
        }
        try {
          await attachLegacyScript({ activityId, pupilId, submissionId, fileName: f.file_name, bytes })
          counts.scripts_attached += 1
        } catch (error) {
          counts.scripts_failed.push(error instanceof Error ? error.message.replace(f.file_name, "<file>") : String(error))
        }
      }
    }

    // The old papers are retired once every pupil is across: set inactive, so
    // they leave Group Progress, but kept (re-activate to undo). Re-runs still
    // read them, as nothing above filters on active.
    const { rows: stillActive } = await query(
      "select 1 from assessments where assessment_id = any($1::uuid[]) and active",
      [group.assessmentIds],
    )
    let oldPapersStatus = stillActive.length > 0 ? "to set inactive" : "already inactive"
    if (args.apply && activityId) {
      if (counts.scripts_failed.length > 0) {
        oldPapersStatus = "left active: a script failed to attach"
      } else {
        const { rowCount } = await query(
          "update assessments set active = false, updated_at = now() where assessment_id = any($1::uuid[]) and active",
          [group.assessmentIds],
        )
        oldPapersStatus = rowCount ? "set inactive" : "already inactive"
      }
    }

    // Visibility: the old switch per paper, and the host lesson's per class.
    const { rows: visibility } = await query<{ group_id: string; feedback_visible: boolean | null; start_date: Date | null }>(
      "select group_id, feedback_visible, start_date from lesson_assignments where lesson_id = $1 order by group_id",
      [group.hostLessonId],
    )

    let totals: unknown = null
    if (activityId) {
      const { rows: t } = await query<{ max_marks: number; submissions: string; marked: string }>(
        `select a.max_marks,
                (select count(*) from submissions s where s.activity_id = a.activity_id)::text as submissions,
                (select count(*) from submissions s where s.activity_id = a.activity_id and s.body::jsonb ? 'marks')::text as marked
           from activities a where a.activity_id = $1`,
        [activityId],
      )
      totals = t[0]
    }

    papersReport.push({
      title: group.title,
      folded_from: oldPapers.map((p) => ({ assessment_id: p.assessment_id, assessed_on: ddmmyyyy(p.assessed_on), groups: p.group_ids, old_feedback_visible: p.feedback_visible })),
      old_papers: oldPapersStatus,
      host_lesson: { lesson_id: group.hostLessonId, title: lessonRows[0].title },
      activity_id: activityId,
      activity_status: activityStatus,
      questions: questions.length,
      total_marks: totalMarks,
      instructions,
      files: filesReport,
      pupils: counts,
      host_lesson_feedback_visible: visibility.map((v) => ({ group_id: v.group_id, feedback_visible: v.feedback_visible === true, start_date: v.start_date ? ddmmyyyy(v.start_date) : null })),
      activity_now: totals,
    })
  }

  report.papers = papersReport
  report.dropped_criteria = droppedCriteria

  const text = JSON.stringify(report, null, 2)
  if (args.out) await writeFile(args.out, text)
  console.log(text)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exit(1)
  })
