"use server"

import { requireTeacherProfile } from "@/lib/auth"
import { query } from "@/lib/db"
import { readAllLearningObjectivesAction } from "@/lib/server-actions/learning-objectives"
import { createLessonActivityAction } from "@/lib/server-actions/lesson-activities"
import {
  GroupItemsActivityBodySchema,
  MatcherActivityBodySchema,
  McqActivityBodySchema,
  SequenceActivityBodySchema,
  ShortTextActivityBodySchema,
  UploadSpreadsheetActivityBodySchema,
  UploadUrlActivityBodySchema,
  UploadWorksheetActivityBodySchema,
} from "@/types"
import { createLocalStorageClient } from "@/lib/storage/local-storage"
import { convertToPdfViaGotenberg } from "@/lib/pdf/gotenberg"
import { rasterizePdfToJpegs } from "@/lib/pdf/rasterize-pdf"
import {
  generateLessonChatReply,
  type ChatAttachment,
  type ChatTurn,
  type ProposedActivity,
} from "@/lib/ai/lesson-chat-gemini"

const MAX_SLIDES = 20

/** Short text summary of an activity's content, so the model can reference it. */
function summariseActivityBody(type: string, bodyData: unknown): string {
  const b = (bodyData ?? {}) as Record<string, unknown>
  const s = (v: unknown, n = 160) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "")
  switch (type) {
    case "multiple-choice-question":
    case "short-text-question":
      return s(b.question)
    case "text":
      return s(b.text)
    case "display-section":
      return s(b.description)
    case "upload-worksheet":
    case "upload-spreadsheet":
      return s(b.task)
    case "matcher":
      return Array.isArray(b.pairs) ? (b.pairs as Array<{ term?: string }>).map((p) => p.term).filter(Boolean).join(", ") : ""
    case "group-items":
      return Array.isArray(b.groups) ? "groups: " + (b.groups as Array<{ name?: string }>).map((g) => g.name).filter(Boolean).join(", ") : ""
    case "sequence":
      return Array.isArray(b.terms) ? (b.terms as Array<{ text?: string }>).map((t) => t.text).filter(Boolean).join(" → ") : ""
    case "display-image":
      return "[image]"
    case "show-video":
      return "[video]"
    default:
      return ""
  }
}

const HISTORY_WINDOW = 20
const LESSON_FILES_BUCKET = "lessons"

function inferChatFileKind(fileName: string, contentType: string): "image" | "html" | "file" {
  const n = fileName.toLowerCase()
  if (contentType.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(n)) return "image"
  if (contentType === "text/html" || /\.html?$/.test(n)) return "html"
  return "file"
}

function inferChatFileMime(fileName: string): string {
  const n = fileName.toLowerCase()
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".gif")) return "image/gif"
  if (n.endsWith(".webp")) return "image/webp"
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg"
  if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html"
  return "application/octet-stream"
}

/**
 * Upload a chat attachment to a per-lesson temp path. Returns a `tempRef` the
 * client passes back on send; on confirm the file is copied into the created
 * activity's folder.
 */
export async function uploadLessonChatAttachmentAction(
  formData: FormData,
): Promise<{ success: boolean; tempRef: string; fileName: string; kind: "image" | "html" | "file"; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, tempRef: "", fileName: "", kind: "file", error: "Unauthorized" }

  const lessonId = formData.get("lessonId")
  const file = formData.get("file")
  if (typeof lessonId !== "string" || !lessonId.trim()) {
    return { success: false, tempRef: "", fileName: "", kind: "file", error: "Missing lesson." }
  }
  if (!(file instanceof File)) {
    return { success: false, tempRef: "", fileName: "", kind: "file", error: "No file provided." }
  }
  if (file.size > 25 * 1024 * 1024) {
    return { success: false, tempRef: "", fileName: "", kind: "file", error: "File exceeds 25MB." }
  }

  const cleanName = file.name.replace(/\s+/g, "_")
  const kind = inferChatFileKind(cleanName, file.type)
  const storedName = `${crypto.randomUUID().slice(0, 8)}-${cleanName}`
  const tempRef = `${LESSON_FILES_BUCKET}/${lessonId}/activities/_chat/${storedName}`

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
    const { error } = await storage.upload(tempRef, buffer, {
      contentType: file.type || inferChatFileMime(cleanName),
      uploadedBy: profile.userId,
      originalPath: tempRef,
    })
    if (error) return { success: false, tempRef: "", fileName: "", kind, error: error.message }
    return { success: true, tempRef, fileName: cleanName, kind, error: null }
  } catch (err) {
    console.error("[lesson-chat] attachment upload failed", err)
    return { success: false, tempRef: "", fileName: "", kind, error: "Upload failed." }
  }
}

/** Copy a chat temp file into the created activity's folder. */
async function copyChatFileToActivity(
  tempRef: string,
  lessonId: string,
  activityId: string,
  fileName: string,
  uploadedBy: string,
): Promise<void> {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { stream, error } = await storage.getFileStream(tempRef)
  if (error || !stream) throw new Error(`Could not read attachment at ${tempRef}`)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const dest = `${LESSON_FILES_BUCKET}/${lessonId}/activities/${activityId}/${fileName}`
  const { error: upErr } = await storage.upload(dest, Buffer.concat(chunks), {
    contentType: inferChatFileMime(fileName),
    uploadedBy,
    originalPath: dest,
  })
  if (upErr) throw new Error(upErr.message)
}

/**
 * Convert an attached PowerPoint (already at `tempRef`) into one Display Image
 * proposal per slide, reusing the slides-import pipeline (Gotenberg pptx -> PDF,
 * poppler PDF -> JPEGs). Slide images are stored in the lesson chat temp folder;
 * the teacher confirms which slides to add.
 */
async function convertPptxToSlideProposals(
  tempRef: string,
  fileName: string,
  lessonId: string,
  uploadedBy: string,
): Promise<ProposedActivity[]> {
  const storage = createLocalStorageClient(LESSON_FILES_BUCKET)
  const { stream, error } = await storage.getFileStream(tempRef)
  if (error || !stream) throw new Error(`Could not read PowerPoint at ${tempRef}`)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))

  const { pdf, error: convertError } = await convertToPdfViaGotenberg(Buffer.concat(chunks), fileName)
  if (convertError || !pdf) throw new Error(convertError ?? "PowerPoint conversion failed.")
  const { pages, error: rasterError } = await rasterizePdfToJpegs(pdf, { maxPages: MAX_SLIDES })
  if (rasterError) throw new Error(rasterError)

  const base = fileName.replace(/\.pptx?$/i, "").replace(/[^a-z0-9-]/gi, "_") || "slides"
  const proposals: ProposedActivity[] = []
  for (let i = 0; i < pages.length; i += 1) {
    const slideName = `${base}-slide-${i + 1}.jpg`
    const ref = `${LESSON_FILES_BUCKET}/${lessonId}/activities/_chat/${crypto.randomUUID().slice(0, 8)}-${slideName}`
    const { error: upErr } = await storage.upload(ref, pages[i], {
      contentType: "image/jpeg",
      uploadedBy,
      originalPath: ref,
    })
    if (upErr) throw new Error(upErr.message)
    proposals.push({
      type: "display-image",
      title: `${base} — Slide ${i + 1}`,
      imageAlt: "",
      fileRef: ref,
      fileName: slideName,
      fileKind: "image",
    })
  }
  return proposals
}

interface LessonChatContext {
  unitId: string | null
  lessonTitle: string
  systemText: string
  validScIds: Set<string>
}

/** Gather the lesson's LOs, success criteria (with IDs) and existing activities. */
async function getLessonChatContext(lessonId: string): Promise<LessonChatContext> {
  const { rows: lessonRows } = await query<{ title: string | null; unit_id: string | null }>(
    `select title, unit_id from lessons where lesson_id = $1 limit 1`,
    [lessonId],
  )
  const lessonTitle = lessonRows[0]?.title ?? "this lesson"
  const unitId = lessonRows[0]?.unit_id ?? null

  const loResult = unitId ? await readAllLearningObjectivesAction({ unitId }) : { data: [], error: null }
  const los = loResult.data ?? []

  const validScIds = new Set<string>()
  const loLines = los.map((lo) => {
    const scLines = (lo.success_criteria ?? []).map((sc) => {
      if (sc.success_criteria_id) validScIds.add(sc.success_criteria_id)
      return `    - [${sc.success_criteria_id}] ${sc.description ?? ""}`
    })
    return `  • ${lo.title ?? "Untitled objective"}\n${scLines.join("\n")}`
  })

  const { rows: activityRows } = await query<{ title: string | null; type: string | null; body_data: unknown }>(
    `select title, type, body_data from activities where lesson_id = $1 and active is not false order by order_by asc nulls last`,
    [lessonId],
  )
  const activityLines = activityRows.map((a) => {
    const summary = summariseActivityBody(a.type ?? "", a.body_data)
    return `  • ${a.title ?? "Untitled"} (${a.type ?? "unknown"})${summary ? ` — ${summary}` : ""}`
  })

  const systemText = [
    "You are an assistant that helps a teacher author lesson activities for the lesson below.",
    "You can propose these activity types:",
    "- multiple-choice-question (MCQ)",
    "- short-text-question (STQ)",
    "- text (Display Text: informational content shown to pupils)",
    "- display-section (Display Section: a heading that groups the activities that follow it)",
    "- show-video (Display Video: embeds a video)",
    "- upload-file (pupils upload a file)",
    "- upload-url (pupils submit a link)",
    "- voice (pupils record a voice response)",
    "- matcher (pupils match terms to definitions)",
    "- group-items (pupils sort items into named groups)",
    "- sequence (pupils arrange items into the correct order)",
    "- display-image (show an image; only when the teacher attaches an image)",
    "- file-download (offer a file to download; only when the teacher attaches a file)",
    "- display-webpage (embed an .html page; only when the teacher attaches an .html file)",
    "- upload-worksheet (Upload Exam: pupils photograph a completed exam question; AI marks it)",
    "- upload-spreadsheet (pupils upload a spreadsheet; AI marks it)",
    "You never create activities yourself — you return proposals as structured data; the teacher confirms them.",
    "",
    "Each proposal always includes every field; fill the ones relevant to its type and leave the rest empty (\"\" or []):",
    "- MCQ: set `question`; set `options` to 2–4 items, each with `text` and a `correct` boolean, EXACTLY ONE correct: true.",
    "- STQ: set `question` and a concise `modelAnswer` (used for AI marking).",
    "- text: set `text` to the content to display (a few clear sentences).",
    "- display-section: set `text` to the section heading.",
    "- show-video: set `videoUrl` ONLY if the teacher gave you a URL — never invent a video URL; otherwise leave it empty for the teacher to fill.",
    "- upload-file / upload-url / voice: set `text` to the pupil-facing instructions/prompt.",
    "- matcher: set `pairs` to 2–8 items, each with a `term` and its `definition`.",
    "- group-items: set `groups` to 2–4 group names, and `items` to 2–12 items, each with `text` and a `group` that EXACTLY matches one of the group names.",
    "- sequence: set `sequence` to 2–12 short items in the CORRECT order (first to last).",
    "- display-image / file-download / display-webpage: ONLY propose when a matching file is attached this turn; set `attachmentId` to that attachment's id. For display-image, also set a concise `imageAlt` describing the image. Never propose these without an attachment.",
    "- upload-worksheet (Upload Exam) and upload-spreadsheet: set `task` (clear instructions for pupils) and `markingGuidance` (how the AI should mark it). Both are required.",
    "- Align scorable activities to the lesson's success criteria where sensible, using successCriteriaIds — you may ONLY use the SC IDs listed below; never invent IDs. Display types (text, section, video, image, file, webpage) have no success criteria.",
    "- Keep content clear and grade-appropriate; base it on the lesson's objectives and existing activities unless the teacher says otherwise.",
    "- Put a short conversational reply in `message` and the activities in `proposals` (empty array if none this turn).",
    "",
    `Lesson: ${lessonTitle}`,
    "",
    "Learning objectives and success criteria (IDs in brackets):",
    loLines.length ? loLines.join("\n") : "  (none defined)",
    "",
    "Existing activities in this lesson:",
    activityLines.length ? activityLines.join("\n") : "  (none yet)",
  ].join("\n")

  return { unitId, lessonTitle, systemText, validScIds }
}

/** Load a bounded window of prior chat turns for the model. */
async function loadHistory(lessonId: string): Promise<ChatTurn[]> {
  const { rows } = await query<{ role: "user" | "assistant"; content: string }>(
    `select role, content from lesson_chat_messages where lesson_id = $1 order by created_at asc`,
    [lessonId],
  )
  const turns = rows.map((r) => ({ role: r.role, content: r.content }))
  return turns.slice(-HISTORY_WINDOW)
}

export type LessonChatMessageRecord = {
  message_id: string
  role: "user" | "assistant"
  content: string
  proposals: ProposedActivity[] | null
  created_at: string
}

/** Full chat history for display when the panel opens. */
export async function readLessonChatAction(lessonId: string): Promise<{
  success: boolean
  data: LessonChatMessageRecord[]
  error: string | null
}> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, data: [], error: "Unauthorized" }
  try {
    const { rows } = await query<LessonChatMessageRecord>(
      `select message_id, role, content, proposals, created_at::text as created_at
       from lesson_chat_messages where lesson_id = $1 order by created_at asc`,
      [lessonId],
    )
    return { success: true, data: rows, error: null }
  } catch (err) {
    console.error("[lesson-chat] read failed", err)
    return { success: false, data: [], error: "Failed to load chat." }
  }
}

/** Send a teacher message; returns the assistant reply + proposed activities. */
export async function sendLessonChatMessageAction(input: {
  lessonId: string
  message: string
  attachments?: Array<{ attachmentId: string; tempRef: string; fileName: string; kind: "image" | "html" | "file"; dataUrl?: string }>
  references?: Array<{ label: string; kind: "image" | "text"; dataUrl?: string; text?: string }>
}): Promise<{ success: boolean; messageId: string | null; message: string; proposals: ProposedActivity[]; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, messageId: null, message: "", proposals: [], error: "Unauthorized" }

  const lessonId = input.lessonId?.trim()
  const userMessage = input.message?.trim() ?? ""
  const attachments = input.attachments ?? []
  const references = input.references ?? []
  if (!lessonId || (!userMessage && attachments.length === 0 && references.length === 0)) {
    return { success: false, messageId: null, message: "", proposals: [], error: "Missing lesson or message." }
  }

  try {
    const refNoteParts = references.length ? [`referenced: ${references.map((r) => r.label).join(", ")}`] : []
    const attachParts = attachments.length ? [`attached: ${attachments.map((a) => a.fileName).join(", ")}`] : []
    const noteBits = [...attachParts, ...refNoteParts]
    const attachNote = noteBits.length ? ` [${noteBits.join("; ")}]` : ""

    // PowerPoint → slides path: deterministic conversion, no model call. Each
    // slide becomes a Display Image proposal the teacher can pick or discard.
    const slideSources = attachments.filter((a) => /\.pptx?$/i.test(a.fileName))
    if (slideSources.length > 0) {
      await query(
        `insert into lesson_chat_messages (lesson_id, teacher_id, role, content) values ($1, $2, 'user', $3)`,
        [lessonId, profile.userId, userMessage + attachNote],
      )
      const slideProposals: ProposedActivity[] = []
      for (const source of slideSources) {
        slideProposals.push(...(await convertPptxToSlideProposals(source.tempRef, source.fileName, lessonId, profile.userId)))
      }
      const message = slideProposals.length
        ? `Converted your PowerPoint into ${slideProposals.length} slide${slideProposals.length > 1 ? "s" : ""}. Choose which to add as Display Images.`
        : "I couldn't extract any slides from that PowerPoint."
      const { rows: inserted } = await query<{ message_id: string }>(
        `insert into lesson_chat_messages (lesson_id, teacher_id, role, content, proposals) values ($1, $2, 'assistant', $3, $4::jsonb) returning message_id`,
        [lessonId, profile.userId, message, JSON.stringify(slideProposals)],
      )
      return { success: true, messageId: inserted[0]?.message_id ?? null, message, proposals: slideProposals, error: null }
    }

    const context = await getLessonChatContext(lessonId)
    const history = await loadHistory(lessonId)

    await query(
      `insert into lesson_chat_messages (lesson_id, teacher_id, role, content) values ($1, $2, 'user', $3)`,
      [lessonId, profile.userId, userMessage + attachNote],
    )

    const reply = await generateLessonChatReply({
      systemText: context.systemText,
      history,
      userMessage: userMessage || "(see attached / referenced items)",
      attachments: attachments.map((a) => ({ attachmentId: a.attachmentId, fileName: a.fileName, kind: a.kind, dataUrl: a.dataUrl })),
      references,
    })

    const byAttachmentId = new Map(attachments.map((a) => [a.attachmentId, a]))

    // Filter hallucinated SC IDs and resolve any attachmentId into a stored file ref.
    const proposals = reply.proposals.map((p) => {
      const att = p.attachmentId ? byAttachmentId.get(p.attachmentId) : undefined
      return {
        ...p,
        successCriteriaIds: (p.successCriteriaIds ?? []).filter((id) => context.validScIds.has(id)),
        ...(att ? { fileRef: att.tempRef, fileName: att.fileName, fileKind: att.kind } : {}),
      }
    })

    const { rows: inserted } = await query<{ message_id: string }>(
      `insert into lesson_chat_messages (lesson_id, teacher_id, role, content, proposals) values ($1, $2, 'assistant', $3, $4::jsonb) returning message_id`,
      [lessonId, profile.userId, reply.message, JSON.stringify(proposals)],
    )

    return { success: true, messageId: inserted[0]?.message_id ?? null, message: reply.message, proposals, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed."
    console.error("[lesson-chat] send failed", err)
    return { success: false, messageId: null, message: "", proposals: [], error: message }
  }
}

/** Persist an edited proposal back into a stored assistant message (keeps the
 * chat consistent with what the teacher added/changed). */
export async function updateProposalInChatAction(input: {
  messageId: string
  proposalIndex: number
  proposal: ProposedActivity
}): Promise<{ success: boolean; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized" }
  const { messageId, proposalIndex, proposal } = input
  if (!messageId || proposalIndex < 0 || !proposal) return { success: false, error: "Missing parameters." }
  try {
    await query(
      `update lesson_chat_messages
         set proposals = jsonb_set(coalesce(proposals, '[]'::jsonb), array[$2::text], $3::jsonb, false)
       where message_id = $1`,
      [messageId, String(proposalIndex), JSON.stringify(proposal)],
    )
    return { success: true, error: null }
  } catch (err) {
    console.error("[lesson-chat] update proposal failed", err)
    return { success: false, error: "Failed to update chat." }
  }
}

/** Create one confirmed proposal as a real activity (reuses the create action). */
export async function confirmProposedActivityAction(input: {
  lessonId: string
  proposal: ProposedActivity
}): Promise<{ success: boolean; error: string | null; activity: unknown }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized", activity: null }

  const { lessonId, proposal } = input
  if (!lessonId || !proposal) return { success: false, error: "Missing parameters.", activity: null }

  const { rows } = await query<{ unit_id: string | null }>(
    `select unit_id from lessons where lesson_id = $1 limit 1`,
    [lessonId],
  )
  const unitId = rows[0]?.unit_id
  if (!unitId) return { success: false, error: "Lesson has no unit.", activity: null }

  const context = await getLessonChatContext(lessonId)
  const successCriteriaIds = (proposal.successCriteriaIds ?? []).filter((id) => context.validScIds.has(id))

  let bodyData: unknown
  let linkSuccessCriteria = false
  if (proposal.type === "multiple-choice-question") {
    const rawOptions = proposal.options ?? []
    const options = rawOptions.map((o, i) => ({ id: `opt-${i + 1}`, text: o.text }))
    const correctIdx = rawOptions.findIndex((o) => o.correct)
    const built = { question: proposal.question, options, correctOptionId: `opt-${(correctIdx >= 0 ? correctIdx : 0) + 1}` }
    const parsed = McqActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid MCQ proposal.", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "short-text-question") {
    const built = { question: proposal.question, modelAnswer: proposal.modelAnswer ?? "" }
    const parsed = ShortTextActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid STQ proposal.", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "text") {
    bodyData = { text: proposal.text ?? "" }
  } else if (proposal.type === "display-section") {
    bodyData = { description: proposal.text ?? "" }
  } else if (proposal.type === "show-video") {
    bodyData = { fileUrl: proposal.videoUrl ?? "" }
  } else if (proposal.type === "upload-file") {
    bodyData = { instructions: proposal.text ?? "" }
    linkSuccessCriteria = true
  } else if (proposal.type === "upload-url") {
    const built = { question: proposal.text ?? "" }
    const parsed = UploadUrlActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid Upload URL proposal.", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "voice") {
    bodyData = { audioFile: null, instructions: proposal.text ?? "" }
    linkSuccessCriteria = true
  } else if (proposal.type === "matcher") {
    const pairs = (proposal.pairs ?? []).map((p, i) => ({ id: `pair-${i + 1}`, term: p.term, definition: p.definition }))
    const parsed = MatcherActivityBodySchema.safeParse({ pairs })
    if (!parsed.success) return { success: false, error: "Invalid Matcher proposal (need 2–8 term/definition pairs).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "group-items") {
    const groups = (proposal.groups ?? []).map((name, i) => ({ id: `grp-${i + 1}`, name }))
    const byName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]))
    const items = (proposal.items ?? []).map((it, i) => ({
      id: `item-${i + 1}`,
      text: it.text,
      groupId: byName.get((it.group ?? "").trim().toLowerCase()) ?? groups[0]?.id ?? "",
    }))
    const parsed = GroupItemsActivityBodySchema.safeParse({ groups, items })
    if (!parsed.success) return { success: false, error: "Invalid Group Items proposal (2–4 groups, 2–12 items).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "sequence") {
    const terms = (proposal.sequence ?? []).map((text, i) => ({ id: `term-${i + 1}`, text }))
    const parsed = SequenceActivityBodySchema.safeParse({ terms })
    if (!parsed.success) return { success: false, error: "Invalid Sequence proposal (need 2–12 items).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "upload-worksheet") {
    const built = { task: proposal.task ?? "", markingGuidance: proposal.markingGuidance ?? "" }
    const parsed = UploadWorksheetActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid Upload Exam proposal (need a task and marking guidance).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (proposal.type === "upload-spreadsheet") {
    const built = { task: proposal.task ?? "", markingGuidance: proposal.markingGuidance ?? "" }
    const parsed = UploadSpreadsheetActivityBodySchema.safeParse(built)
    if (!parsed.success) return { success: false, error: "Invalid Upload Spreadsheet proposal (need a task and marking guidance).", activity: null }
    bodyData = parsed.data
    linkSuccessCriteria = true
  } else if (
    proposal.type === "display-image" ||
    proposal.type === "file-download" ||
    proposal.type === "display-webpage"
  ) {
    // File-backed types: create the activity (body references the filename),
    // then copy the attached chat file into the activity's folder.
    const fileRef = proposal.fileRef
    const fileName = (proposal.fileName ?? "").replace(/\s+/g, "_")
    if (!fileRef || !fileName) {
      return { success: false, error: "This proposal has no attached file.", activity: null }
    }
    if (proposal.type === "display-webpage" && !/\.html?$/i.test(fileName)) {
      return { success: false, error: "Display Webpage needs an .html file.", activity: null }
    }
    let fileBody: unknown
    if (proposal.type === "display-image") fileBody = { imageFile: fileName, imageAlt: proposal.imageAlt ?? "" }
    else if (proposal.type === "file-download") fileBody = { fileUrl: fileName, fileName }
    else fileBody = { htmlFile: fileName }

    const created = await createLessonActivityAction(unitId, lessonId, {
      title: proposal.title,
      type: proposal.type,
      bodyData: fileBody,
    })
    if (!created.success || !created.data) {
      return { success: false, error: created.error ?? "Could not create activity.", activity: null }
    }
    const activityId = (created.data as { activity_id: string }).activity_id
    try {
      await copyChatFileToActivity(fileRef, lessonId, activityId, fileName, profile.userId)
    } catch (err) {
      console.error("[lesson-chat] copy attachment failed", err)
      return { success: false, error: "Activity created but the file could not be attached.", activity: created.data }
    }
    return { success: true, error: null, activity: created.data }
  } else {
    return { success: false, error: "Unsupported activity type.", activity: null }
  }

  const result = await createLessonActivityAction(unitId, lessonId, {
    title: proposal.title,
    type: proposal.type,
    bodyData,
    successCriteriaIds: linkSuccessCriteria ? successCriteriaIds : undefined,
    maxMarks: linkSuccessCriteria ? proposal.maxMarks : undefined,
  })

  return { success: result.success, error: result.error ?? null, activity: result.data ?? null }
}

/** Clear a lesson's chat history. */
export async function clearLessonChatAction(lessonId: string): Promise<{ success: boolean; error: string | null }> {
  const profile = await requireTeacherProfile()
  if (!profile) return { success: false, error: "Unauthorized" }
  try {
    await query(`delete from lesson_chat_messages where lesson_id = $1`, [lessonId])
    return { success: true, error: null }
  } catch (err) {
    console.error("[lesson-chat] clear failed", err)
    return { success: false, error: "Failed to clear chat." }
  }
}
