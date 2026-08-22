"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Copy, Loader2, Pencil, Plus, Send, Sparkles, Square, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  clearUnitChatAction,
  confirmUnitProposalAction,
  readUnitChatAction,
  sendUnitChatMessageAction,
  updateUnitProposalInChatAction,
} from "@/lib/server-actions/unit-chat"
import type { UnitProposal } from "@/lib/ai/unit-chat"

type ProposalStatus = "pending" | "adding" | "added" | "discarded"
type CardProposal = UnitProposal & { _status: ProposalStatus }

interface ChatMessage {
  messageId?: string
  role: "user" | "assistant"
  content: string
  proposals: CardProposal[]
}

interface UnitAiChatPanelProps {
  unitId: string
  lessons: Array<{ id: string; title: string }>
  learningObjectives: Array<{ id: string; label: string }>
  assessmentObjectives: Array<{ id: string; label: string }>
  onClose: () => void
  onChanged: () => void
}

function stripStatus(p: CardProposal): UnitProposal {
  const { _status: _drop, status: _drop2, ...rest } = p
  return rest
}

export function UnitAiChatPanel({
  unitId,
  lessons,
  learningObjectives,
  assessmentObjectives,
  onClose,
  onChanged,
}: UnitAiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const activeSendRef = useRef(0)

  const lessonTitle = useCallback(
    (id: string) => lessons.find((l) => l.id === id)?.title ?? id,
    [lessons],
  )
  const loLabel = useCallback(
    (id: string) => learningObjectives.find((lo) => lo.id === id)?.label ?? id,
    [learningObjectives],
  )
  const aoLabel = useCallback(
    (id: string) => assessmentObjectives.find((ao) => ao.id === id)?.label ?? id,
    [assessmentObjectives],
  )

  useEffect(() => {
    let cancelled = false
    void readUnitChatAction(unitId).then((res) => {
      if (cancelled || !res.success) return
      setMessages(
        res.data.map((m) => ({
          messageId: m.message_id,
          role: m.role,
          content: m.content,
          proposals: (m.proposals ?? []).map((p) => ({
            ...p,
            _status: (p.status === "added" || p.status === "discarded" ? p.status : "pending") as ProposalStatus,
          })),
        })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [unitId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    const myId = (activeSendRef.current += 1)
    const isCurrent = () => activeSendRef.current === myId
    setInput("")
    setSending(true)
    setMessages((prev) => [...prev, { role: "user", content: text, proposals: [] }])
    try {
      const res = await sendUnitChatMessageAction({ unitId, message: text })
      if (!isCurrent()) return
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
    } catch (err) {
      if (!isCurrent()) return
      const msg = err instanceof Error ? err.message : "The chat request failed. Please try again."
      toast.error("Chat failed", { description: msg })
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${msg}`, proposals: [] }])
    } finally {
      if (isCurrent()) setSending(false)
    }
  }, [input, unitId, sending])

  const stop = useCallback(() => {
    activeSendRef.current += 1
    setSending(false)
  }, [])

  const reuseMessage = useCallback((content: string) => {
    setInput((prev) => (prev.trim() ? `${prev}\n${content}` : content))
    textareaRef.current?.focus()
  }, [])

  const setStatus = (mi: number, pi: number, status: ProposalStatus) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === mi ? { ...m, proposals: m.proposals.map((p, j) => (j === pi ? { ...p, _status: status } : p)) } : m,
      ),
    )
  }

  const editProposal = (mi: number, pi: number, patch: Partial<UnitProposal>) => {
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
      try {
        const res = await confirmUnitProposalAction({ unitId, proposal: clean })
        if (!res.success) {
          toast.error("Couldn't apply", { description: res.error ?? "Please try again." })
          setStatus(mi, pi, "pending")
          return
        }
        setStatus(mi, pi, "added")
        if (messageId) void updateUnitProposalInChatAction({ messageId, proposalIndex: pi, proposal: { ...clean, status: "added" } })
        toast.success("Applied to the unit")
        onChanged()
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't apply. Please try again."
        toast.error("Couldn't apply", { description: msg })
        setStatus(mi, pi, "pending")
      }
    },
    [unitId, onChanged],
  )

  const discardProposal = useCallback((mi: number, pi: number, messageId: string | undefined, proposal: CardProposal) => {
    setStatus(mi, pi, "discarded")
    if (messageId) {
      void updateUnitProposalInChatAction({ messageId, proposalIndex: pi, proposal: { ...stripStatus(proposal), status: "discarded" } })
    }
  }, [])

  const handleClear = useCallback(async () => {
    await clearUnitChatAction(unitId)
    setMessages([])
  }, [unitId])

  return (
    <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-pa-green" /> Develop with AI
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
            Ask me to develop this unit — add lessons, re-sequence the lessons, or add learning
            objectives and success criteria. e.g.{" "}
            <em>&quot;Add three lessons building from the basics, then suggest a sensible order.&quot;</em>
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
              <UnitProposalCard
                key={pi}
                proposal={p}
                lessonTitle={lessonTitle}
                loLabel={loLabel}
                aoLabel={aoLabel}
                onEdit={(patch) => editProposal(mi, pi, patch)}
                onAdd={() => addProposal(mi, pi, m.messageId, p)}
                onDiscard={() => discardProposal(mi, pi, m.messageId, p)}
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

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder="Develop this unit…"
            className="min-h-[40px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pa-green"
          />
          {sending ? (
            <Button size="sm" variant="outline" className="h-10 w-10 shrink-0 p-0" onClick={stop} aria-label="Stop">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" className="h-10 w-10 shrink-0 p-0" onClick={() => void send()} aria-label="Send" disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function UnitProposalCard({
  proposal,
  lessonTitle,
  loLabel,
  aoLabel,
  onEdit,
  onAdd,
  onDiscard,
}: {
  proposal: CardProposal
  lessonTitle: (id: string) => string
  loLabel: (id: string) => string
  aoLabel: (id: string) => string
  onEdit: (patch: Partial<UnitProposal>) => void
  onAdd: () => void
  onDiscard: () => void
}) {
  const [editing, setEditing] = useState(false)
  const isLesson = proposal.type === "lesson"
  const isReorder = proposal.type === "lesson-reorder"
  const isLo = proposal.type === "learning-objective"
  const isSc = proposal.type === "success-criterion"
  const TYPE_LABELS: Record<string, string> = {
    lesson: "Lesson",
    "lesson-reorder": "Re-sequence",
    "learning-objective": "Learning objective",
    "success-criterion": "Success criterion",
  }
  const typeLabel = TYPE_LABELS[proposal.type] ?? "Change"
  const discarded = proposal._status === "discarded"
  const added = proposal._status === "added"
  const linkedLoIds = proposal.learningObjectiveIds ?? []
  const order = proposal.lessonOrder ?? []

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
        {editing && (isLesson || isLo) ? (
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

      {isLesson ? (
        <div className="mt-1 space-y-1">
          {!editing ? <p className="font-medium text-foreground">{proposal.title}</p> : null}
          {linkedLoIds.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {linkedLoIds.map((id) => (
                <span key={id} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title={loLabel(id)}>
                  {loLabel(id)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {isReorder ? (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5">
          {order.map((id, i) => (
            <li key={i} className="text-foreground">{lessonTitle(id)}</li>
          ))}
        </ol>
      ) : null}

      {isLo ? (
        <div className="mt-1 space-y-2">
          {editing ? (
            <input
              value={proposal.specRef ?? ""}
              onChange={(e) => onEdit({ specRef: e.target.value })}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              placeholder="Spec reference (optional)"
            />
          ) : proposal.specRef ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Spec ref:</span> {proposal.specRef}
            </p>
          ) : null}
          <p className="text-[10px] italic text-muted-foreground">
            New learning objective under {aoLabel(proposal.assessmentObjectiveId ?? "")}
          </p>
        </div>
      ) : null}

      {isSc ? (
        <div className="mt-1 space-y-2">
          {editing ? (
            <textarea
              value={proposal.description ?? ""}
              onChange={(e) => onEdit({ description: e.target.value })}
              rows={2}
              className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm"
              placeholder="Success criterion"
            />
          ) : (
            <p className="text-foreground">{proposal.description}</p>
          )}
          {editing ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Level
              <input
                type="number"
                min={1}
                max={9}
                value={proposal.level ?? 1}
                onChange={(e) => onEdit({ level: Number(e.target.value) })}
                className="w-16 rounded border border-border bg-background px-2 py-0.5 text-sm"
              />
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Level:</span> {proposal.level ?? 1}
            </p>
          )}
          <p className="text-[10px] italic text-muted-foreground">
            New success criterion under {loLabel(proposal.learningObjectiveId ?? "")}
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        {added ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-pa-green">
            <Check className="h-3.5 w-3.5" /> Applied
          </span>
        ) : discarded ? (
          <span className="text-xs text-muted-foreground">Discarded</span>
        ) : editing ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(false)}>
            Done
          </Button>
        ) : (
          <>
            {isLesson || isLo || isSc ? (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDiscard}>
              Discard
            </Button>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={onAdd} disabled={proposal._status === "adding"}>
              {proposal._status === "adding" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Apply
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
