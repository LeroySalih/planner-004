"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { AtSign, Check, Copy, FileText, Loader2, Paperclip, Pencil, Plus, Send, Sparkles, Square, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  confirmProposedActivityAction,
  readLessonChatAction,
  sendLessonChatMessageAction,
  updateProposalInChatAction,
  uploadLessonChatAttachmentAction,
  clearLessonChatAction,
} from "@/lib/server-actions/lesson-chat"
import type { ProposedActivity } from "@/lib/ai/lesson-chat-gemini"

function buildFileUrl(filePath: string): string {
  return `/api/files/${filePath.split("/").map(encodeURIComponent).join("/")}`
}

/** Downscale an image blob to a JPEG data URI (~max px) for cheap vision input. */
async function downscaleBlob(blob: Blob, max = 768): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL("image/jpeg", 0.8)
}

const downscaleImage = (file: File, max = 768) => downscaleBlob(file, max)

async function downscaleImageFromUrl(url: string, max = 768): Promise<string> {
  const res = await fetch(url)
  return downscaleBlob(await res.blob(), max)
}

function attachmentKind(file: File): "image" | "html" | "file" {
  if (file.type.startsWith("image/")) return "image"
  if (file.type === "text/html" || /\.html?$/i.test(file.name)) return "html"
  return "file"
}

interface ComposerAttachment {
  id: string
  file: File
  kind: "image" | "html" | "file"
  previewUrl?: string
}

type ProposalStatus = "pending" | "adding" | "added" | "discarded"
type CardProposal = ProposedActivity & { _status: ProposalStatus }

interface ChatMessage {
  messageId?: string
  role: "user" | "assistant"
  content: string
  proposals: CardProposal[]
}

interface ReferenceableActivity {
  activityId: string
  title: string
  type: string
  imageUrl?: string
  text?: string
}

interface LessonAiChatPanelProps {
  lessonId: string
  successCriteria: Array<{ id: string; label: string }>
  referenceableActivities: ReferenceableActivity[]
  onClose: () => void
  onActivityCreated: (activity: unknown) => void
}

function stripStatus(p: CardProposal): ProposedActivity {
  const { _status: _drop, ...rest } = p
  return rest
}

export function LessonAiChatPanel({
  lessonId,
  successCriteria,
  referenceableActivities,
  onClose,
  onActivityCreated,
}: LessonAiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const attachSeq = useRef(0)
  const activeSendRef = useRef(0)

  const addFiles = useCallback((files: File[]) => {
    const next = files
      .filter((f) => f.size > 0)
      .map((file) => {
        attachSeq.current += 1
        const kind = attachmentKind(file)
        return {
          id: `att${attachSeq.current}`,
          file,
          kind,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        }
      })
    if (next.length) setAttachments((prev) => [...prev, ...next])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  // References to existing lesson activities (sent as context: image → vision, text → note).
  const [references, setReferences] = useState<
    Array<{ activityId: string; label: string; kind: "image" | "text"; dataUrl?: string; text?: string }>
  >([])
  const [refPickerOpen, setRefPickerOpen] = useState(false)

  const addReference = useCallback(
    async (activity: ReferenceableActivity) => {
      setRefPickerOpen(false)
      if (references.some((r) => r.activityId === activity.activityId)) return
      if (activity.imageUrl) {
        const dataUrl = await downscaleImageFromUrl(activity.imageUrl).catch(() => undefined)
        if (!dataUrl) {
          toast.error(`Couldn't load "${activity.title}"`)
          return
        }
        setReferences((prev) => [...prev, { activityId: activity.activityId, label: activity.title, kind: "image", dataUrl }])
      } else if (activity.text) {
        setReferences((prev) => [...prev, { activityId: activity.activityId, label: activity.title, kind: "text", text: activity.text }])
      }
    },
    [references],
  )

  const removeReference = useCallback((activityId: string) => {
    setReferences((prev) => prev.filter((r) => r.activityId !== activityId))
  }, [])

  const scLabel = useCallback(
    (id: string) => successCriteria.find((sc) => sc.id === id)?.label ?? id,
    [successCriteria],
  )

  useEffect(() => {
    let cancelled = false
    void readLessonChatAction(lessonId).then((res) => {
      if (cancelled || !res.success) return
      setMessages(
        res.data.map((m) => ({
          messageId: m.message_id,
          role: m.role,
          content: m.content,
          proposals: (m.proposals ?? []).map((p) => ({ ...p, _status: "pending" as ProposalStatus })),
        })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [lessonId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    const atts = attachments
    const refs = references
    if ((!text && atts.length === 0 && refs.length === 0) || sending) return
    const myId = (activeSendRef.current += 1)
    const isCurrent = () => activeSendRef.current === myId
    setInput("")
    setAttachments([])
    setReferences([])
    setSending(true)
    const noteBits = [
      ...(atts.length ? [atts.map((a) => a.file.name).join(", ")] : []),
      ...(refs.length ? [`ref: ${refs.map((r) => r.label).join(", ")}`] : []),
    ]
    const note = noteBits.length ? ` [${noteBits.join("; ")}]` : ""
    setMessages((prev) => [...prev, { role: "user", content: text + note, proposals: [] }])
    try {
      const uploaded: Array<{ attachmentId: string; tempRef: string; fileName: string; kind: "image" | "html" | "file"; dataUrl?: string }> = []
      for (const a of atts) {
        const fd = new FormData()
        fd.append("lessonId", lessonId)
        fd.append("file", a.file)
        const up = await uploadLessonChatAttachmentAction(fd)
        if (!isCurrent()) return
        if (!up.success) {
          toast.error(`Couldn't attach ${a.file.name}`, { description: up.error ?? "Please try again." })
          continue
        }
        const dataUrl = a.kind === "image" ? await downscaleImage(a.file).catch(() => undefined) : undefined
        uploaded.push({ attachmentId: a.id, tempRef: up.tempRef, fileName: up.fileName, kind: up.kind, dataUrl })
      }
      const res = await sendLessonChatMessageAction({
        lessonId,
        message: text,
        attachments: uploaded,
        references: refs.map((r) => ({ label: r.label, kind: r.kind, dataUrl: r.dataUrl, text: r.text })),
      })
      if (!isCurrent()) return // cancelled by the user; ignore the result
      if (!res.success) {
        toast.error("Chat failed", { description: res.error ?? "Please try again." })
        setMessages((prev) => [...prev, { role: "assistant", content: res.error ?? "Something went wrong.", proposals: [] }])
        return
      }
      setMessages((prev) => [
        ...prev,
        {
          messageId: res.messageId ?? undefined,
          role: "assistant",
          content: res.message,
          proposals: res.proposals.map((p) => ({ ...p, _status: "pending" as ProposalStatus })),
        },
      ])
    } finally {
      if (isCurrent()) setSending(false)
    }
  }, [input, attachments, references, lessonId, sending])

  // Cancel an in-flight submit: invalidate the turn so its result is ignored,
  // and reset the composer to ready.
  const stop = useCallback(() => {
    activeSendRef.current += 1
    setSending(false)
  }, [])

  // Copy a previous message into the composer to edit and resend (no tokens).
  const reuseMessage = useCallback((content: string) => {
    const clean = content.replace(/\s*\[attached:[^\]]*\]\s*$/, "")
    setInput((prev) => (prev.trim() ? `${prev}\n${clean}` : clean))
    textareaRef.current?.focus()
  }, [])

  const setStatus = (mi: number, pi: number, status: ProposalStatus) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === mi ? { ...m, proposals: m.proposals.map((p, j) => (j === pi ? { ...p, _status: status } : p)) } : m,
      ),
    )
  }

  const editProposal = (mi: number, pi: number, patch: Partial<ProposedActivity>) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === mi ? { ...m, proposals: m.proposals.map((p, j) => (j === pi ? { ...p, ...patch } : p)) } : m,
      ),
    )
  }

  const addProposal = useCallback(
    async (mi: number, pi: number, messageId: string | undefined, proposal: CardProposal) => {
      const clean = stripStatus(proposal)
      setStatus(mi, pi, "adding")
      const res = await confirmProposedActivityAction({ lessonId, proposal: clean })
      if (!res.success) {
        toast.error("Couldn't add activity", { description: res.error ?? "Please try again." })
        setStatus(mi, pi, "pending")
        return
      }
      setStatus(mi, pi, "added")
      // Persist the (possibly edited) proposal back into the chat so it stays correct.
      if (messageId) void updateProposalInChatAction({ messageId, proposalIndex: pi, proposal: clean })
      toast.success("Activity added to the lesson")
      if (res.activity) onActivityCreated(res.activity)
    },
    [lessonId, onActivityCreated],
  )

  const handleClear = useCallback(async () => {
    await clearLessonChatAction(lessonId)
    setMessages([])
  }, [lessonId])

  return (
    <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-pa-green" /> Create with AI
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs text-muted-foreground">
            Clear
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask me to add activities — questions (MCQ / short answer), display text, sections,
            video, uploads, voice, matcher, grouping and sequencing — from this lesson&apos;s
            objectives and existing activities. e.g.{" "}
            <em>&quot;Add a &lsquo;Warm up&rsquo; section, then 3 MCQs and a matcher on the key vocabulary.&quot;</em>
          </p>
        ) : null}

        {messages.map((m, mi) => (
          <div key={mi} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
            {m.content ? (
              <div className={m.role === "user" ? "flex flex-col items-end gap-0.5" : "flex flex-col items-start gap-0.5"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-pa-green px-3 py-2 text-sm text-white"
                      : "max-w-[95%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground"
                  }
                >
                  {m.content}
                </div>
                <button
                  type="button"
                  onClick={() => reuseMessage(m.content)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground transition hover:text-foreground"
                  title="Copy into the message box to edit and resend"
                >
                  <Copy className="h-3 w-3" /> Reuse
                </button>
              </div>
            ) : null}

            {m.proposals.map((p, pi) => (
              <ProposalCard
                key={pi}
                proposal={p}
                scLabel={scLabel}
                onEdit={(patch) => editProposal(mi, pi, patch)}
                onAdd={() => addProposal(mi, pi, m.messageId, p)}
                onDiscard={() => setStatus(mi, pi, "discarded")}
              />
            ))}
          </div>
        ))}

        {sending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        ) : null}
      </div>

      <div
        className="relative border-t border-border p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files))
        }}
      >
        {refPickerOpen ? (
          <div className="absolute bottom-full left-3 z-10 mb-1 max-h-60 w-72 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
            {referenceableActivities.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No activities to reference yet.</p>
            ) : (
              referenceableActivities.map((a) => (
                <button
                  key={a.activityId}
                  type="button"
                  onClick={() => void addReference(a)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  {a.imageUrl ? (
                    <img src={a.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{a.type}</span>
                </button>
              ))
            )}
          </div>
        ) : null}

        {references.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {references.map((r) => (
              <span
                key={r.activityId}
                className="inline-flex items-center gap-1 rounded-full bg-pa-green-tint px-2 py-0.5 text-[11px] text-pa-green"
              >
                <AtSign className="h-3 w-3" /> {r.label}
                <button
                  type="button"
                  onClick={() => removeReference(r.activityId)}
                  className="ml-0.5 text-pa-green/70 hover:text-pa-green"
                  aria-label={`Remove reference ${r.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="relative">
                {a.kind === "image" && a.previewUrl ? (
                  <img src={a.previewUrl} alt={a.file.name} className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="flex h-14 w-24 items-center gap-1 rounded border border-border bg-muted px-2 text-[10px] text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{a.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-red-600 text-white ring-2 ring-card"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.html,.htm,.pptx,.ppt,application/pdf,application/*,text/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(Array.from(e.target.files))
              e.target.value = ""
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 p-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            aria-label="Attach a file"
            title="Attach an image, .html, PowerPoint or file"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 p-0"
            onClick={() => setRefPickerOpen((v) => !v)}
            disabled={sending}
            aria-label="Reference an existing activity"
            title="Reference an existing activity"
          >
            <AtSign className="h-4 w-4" />
          </Button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files: File[] = []
              for (const item of e.clipboardData?.items ?? []) {
                if (item.kind === "file") {
                  const f = item.getAsFile()
                  if (f) files.push(f)
                }
              }
              if (files.length) {
                e.preventDefault()
                addFiles(files)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder="Ask the AI, or paste/attach an image or file…"
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-pa-green"
            disabled={sending}
          />
          {sending ? (
            <Button
              onClick={stop}
              className="h-9 w-9 shrink-0 bg-red-600 p-0 text-white hover:bg-red-700"
              aria-label="Stop"
              title="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={() => void send()}
              disabled={!input.trim() && attachments.length === 0 && references.length === 0}
              className="h-9 w-9 shrink-0 p-0"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProposalCard({
  proposal,
  scLabel,
  onEdit,
  onAdd,
  onDiscard,
}: {
  proposal: CardProposal
  scLabel: (id: string) => string
  onEdit: (patch: Partial<ProposedActivity>) => void
  onAdd: () => void
  onDiscard: () => void
}) {
  const [editing, setEditing] = useState(false)
  const radioName = useId()
  const isMcq = proposal.type === "multiple-choice-question"
  const isStq = proposal.type === "short-text-question"
  const isText = proposal.type === "text"
  const isSection = proposal.type === "display-section"
  const isVideo = proposal.type === "show-video"
  const isUploadFile = proposal.type === "upload-file"
  const isUploadUrl = proposal.type === "upload-url"
  const isVoice = proposal.type === "voice"
  const isPromptType = isUploadFile || isUploadUrl || isVoice
  const isMatcher = proposal.type === "matcher"
  const isGroup = proposal.type === "group-items"
  const isSequence = proposal.type === "sequence"
  const isDisplayImage = proposal.type === "display-image"
  const isFileDownload = proposal.type === "file-download"
  const isWebpage = proposal.type === "display-webpage"
  const isTaskMarked = proposal.type === "upload-worksheet" || proposal.type === "upload-spreadsheet"
  const hasQuestion = isMcq || isStq
  const TYPE_LABELS: Record<string, string> = {
    "multiple-choice-question": "MCQ",
    "short-text-question": "Short answer",
    text: "Text",
    "display-section": "Section",
    "show-video": "Video",
    "upload-file": "Upload file",
    "upload-url": "Upload URL",
    voice: "Voice",
    matcher: "Matcher",
    "group-items": "Group items",
    sequence: "Sequence",
    "display-image": "Image",
    "file-download": "File",
    "display-webpage": "Webpage",
    "upload-worksheet": "Upload Exam",
    "upload-spreadsheet": "Upload Spreadsheet",
  }
  const typeLabel = TYPE_LABELS[proposal.type] ?? "Activity"
  const discarded = proposal._status === "discarded"
  const added = proposal._status === "added"
  const options = proposal.options ?? []
  const pairs = proposal.pairs ?? []
  const groups = proposal.groups ?? []
  const groupItems = proposal.items ?? []
  const sequence = proposal.sequence ?? []

  const setOptionText = (i: number, text: string) =>
    onEdit({ options: options.map((o, j) => (j === i ? { ...o, text } : o)) })
  const setCorrect = (i: number) =>
    onEdit({ options: options.map((o, j) => ({ ...o, correct: j === i })) })
  const setPair = (i: number, patch: Partial<{ term: string; definition: string }>) =>
    onEdit({ pairs: pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const setGroupName = (i: number, name: string) =>
    onEdit({ groups: groups.map((g, j) => (j === i ? name : g)) })
  const setItem = (i: number, patch: Partial<{ text: string; group: string }>) =>
    onEdit({ items: groupItems.map((it, j) => (j === i ? { ...it, ...patch } : it)) })
  const setTerm = (i: number, text: string) =>
    onEdit({ sequence: sequence.map((t, j) => (j === i ? text : t)) })

  return (
    <div
      className={[
        "rounded-lg border bg-background p-3 text-sm transition",
        discarded ? "border-border/60 opacity-50" : "border-pa-green/40",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="rounded-full bg-pa-green-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pa-green">
          {typeLabel}
        </span>
        {editing ? (
          <input
            value={proposal.title}
            onChange={(e) => onEdit({ title: e.target.value })}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs"
            placeholder="Title"
          />
        ) : (
          <span className="truncate text-xs font-medium text-muted-foreground">{proposal.title}</span>
        )}
      </div>

      {hasQuestion ? (
        editing ? (
          <textarea
            value={proposal.question ?? ""}
            onChange={(e) => onEdit({ question: e.target.value })}
            rows={2}
            className="mt-1 w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Question"
          />
        ) : (
          <p className="font-medium text-foreground">{proposal.question}</p>
        )
      ) : null}

      {isMcq ? (
        <ul className="mt-2 space-y-1">
          {options.map((opt, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {editing ? (
                <>
                  <input
                    type="radio"
                    name={radioName}
                    checked={opt.correct}
                    onChange={() => setCorrect(i)}
                    className="accent-pa-green"
                    title="Mark correct"
                  />
                  <input
                    value={opt.text}
                    onChange={(e) => setOptionText(i, e.target.value)}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-sm"
                  />
                </>
              ) : (
                <span className={opt.correct ? "flex items-center gap-1.5 font-semibold text-pa-green" : "flex items-center gap-1.5 text-muted-foreground"}>
                  {opt.correct ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                  {opt.text}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : isStq ? (
        editing ? (
          <textarea
            value={proposal.modelAnswer ?? ""}
            onChange={(e) => onEdit({ modelAnswer: e.target.value })}
            rows={2}
            className="mt-2 w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs"
            placeholder="Model answer (used for AI marking)"
          />
        ) : proposal.modelAnswer ? (
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-semibold">Model answer:</span> {proposal.modelAnswer}
          </p>
        ) : null
      ) : isText ? (
        editing ? (
          <textarea
            value={proposal.text ?? ""}
            onChange={(e) => onEdit({ text: e.target.value })}
            rows={4}
            className="mt-1 w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Text to display to pupils"
          />
        ) : (
          <p className="whitespace-pre-wrap text-foreground">{proposal.text}</p>
        )
      ) : isSection ? (
        editing ? (
          <input
            value={proposal.text ?? ""}
            onChange={(e) => onEdit({ text: e.target.value })}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm font-semibold"
            placeholder="Section heading"
          />
        ) : (
          <p className="text-base font-semibold text-foreground">{proposal.text}</p>
        )
      ) : isVideo ? (
        editing ? (
          <input
            value={proposal.videoUrl ?? ""}
            onChange={(e) => onEdit({ videoUrl: e.target.value })}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Video URL (e.g. YouTube link)"
          />
        ) : proposal.videoUrl ? (
          <a href={proposal.videoUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-pa-green underline">
            {proposal.videoUrl}
          </a>
        ) : (
          <p className="mt-1 text-xs italic text-muted-foreground">No video URL yet — click Edit to add one.</p>
        )
      ) : null}

      {isPromptType ? (
        editing ? (
          <textarea
            value={proposal.text ?? ""}
            onChange={(e) => onEdit({ text: e.target.value })}
            rows={2}
            className="mt-1 w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Instructions for pupils"
          />
        ) : (
          <p className="text-foreground">{proposal.text}</p>
        )
      ) : null}

      {isMatcher ? (
        <ul className="mt-2 space-y-1">
          {pairs.map((p, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {editing ? (
                <>
                  <input
                    value={p.term}
                    onChange={(e) => setPair(i, { term: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-sm"
                    placeholder="Term"
                  />
                  <span className="text-muted-foreground">→</span>
                  <input
                    value={p.definition}
                    onChange={(e) => setPair(i, { definition: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-sm"
                    placeholder="Definition"
                  />
                </>
              ) : (
                <span className="text-foreground">
                  <span className="font-semibold">{p.term}</span>
                  <span className="text-muted-foreground"> → {p.definition}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {isGroup ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1">
            {groups.map((g, i) =>
              editing ? (
                <input
                  key={i}
                  value={g}
                  onChange={(e) => setGroupName(i, e.target.value)}
                  className="w-24 rounded border border-border bg-background px-2 py-0.5 text-xs font-semibold"
                  placeholder="Group"
                />
              ) : (
                <span key={i} className="rounded-full bg-pa-green-tint px-2 py-0.5 text-[10px] font-bold text-pa-green">
                  {g}
                </span>
              ),
            )}
          </div>
          <ul className="space-y-1">
            {groupItems.map((it, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {editing ? (
                  <>
                    <input
                      value={it.text}
                      onChange={(e) => setItem(i, { text: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-sm"
                      placeholder="Item"
                    />
                    <select
                      value={it.group}
                      onChange={(e) => setItem(i, { group: e.target.value })}
                      className="rounded border border-border bg-background px-1 py-0.5 text-xs"
                    >
                      {groups.map((g, j) => (
                        <option key={j} value={g}>{g}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="text-foreground">
                    {it.text} <span className="text-muted-foreground">→ {it.group}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isSequence ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {sequence.map((t, i) => (
            <li key={i} className="text-foreground">
              {editing ? (
                <input
                  value={t}
                  onChange={(e) => setTerm(i, e.target.value)}
                  className="w-full rounded border border-border bg-background px-2 py-0.5 text-sm"
                />
              ) : (
                t
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {isDisplayImage ? (
        <div className="mt-2 space-y-2">
          {proposal.fileRef ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={buildFileUrl(proposal.fileRef)}
              alt={proposal.imageAlt ?? ""}
              className="max-h-40 w-full rounded object-contain"
            />
          ) : null}
          {editing ? (
            <input
              value={proposal.imageAlt ?? ""}
              onChange={(e) => onEdit({ imageAlt: e.target.value })}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              placeholder="Alt text"
            />
          ) : proposal.imageAlt ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Alt:</span> {proposal.imageAlt}
            </p>
          ) : null}
        </div>
      ) : null}

      {isFileDownload || isWebpage ? (
        <div className="mt-2 flex items-center gap-1.5 text-sm text-foreground">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{proposal.fileName ?? "file"}</span>
        </div>
      ) : null}

      {isTaskMarked ? (
        <div className="mt-1 space-y-2">
          {editing ? (
            <textarea
              value={proposal.task ?? ""}
              onChange={(e) => onEdit({ task: e.target.value })}
              rows={2}
              className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm"
              placeholder="Task (instructions for pupils)"
            />
          ) : (
            <p className="font-medium text-foreground">{proposal.task}</p>
          )}
          {editing ? (
            <textarea
              value={proposal.markingGuidance ?? ""}
              onChange={(e) => onEdit({ markingGuidance: e.target.value })}
              rows={2}
              className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs"
              placeholder="Marking guidance (how the AI should mark it)"
            />
          ) : proposal.markingGuidance ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Marking:</span> {proposal.markingGuidance}
            </p>
          ) : null}
        </div>
      ) : null}

      {proposal.successCriteriaIds && proposal.successCriteriaIds.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {proposal.successCriteriaIds.map((id) => (
            <span key={id} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title={scLabel(id)}>
              {scLabel(id)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        {added ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-pa-green">
            <Check className="h-3.5 w-3.5" /> Added
          </span>
        ) : discarded ? (
          <span className="text-xs text-muted-foreground">Discarded</span>
        ) : editing ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDiscard}>
              Discard
            </Button>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={onAdd} disabled={proposal._status === "adding"}>
              {proposal._status === "adding" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
