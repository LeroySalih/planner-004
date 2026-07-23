"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Loader2, Plus, Send, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  confirmProposedActivityAction,
  readLessonChatAction,
  sendLessonChatMessageAction,
  clearLessonChatAction,
} from "@/lib/server-actions/lesson-chat"
import type { ProposedActivity } from "@/lib/ai/lesson-chat-gemini"

type ProposalStatus = "pending" | "adding" | "added" | "discarded"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  proposals: Array<ProposedActivity & { _status: ProposalStatus }>
}

interface LessonAiChatPanelProps {
  lessonId: string
  /** Success criteria for chip labels: id → short description. */
  successCriteria: Array<{ id: string; label: string }>
  onClose: () => void
  onActivityCreated: (activity: unknown) => void
}

export function LessonAiChatPanel({
  lessonId,
  successCriteria,
  onClose,
  onActivityCreated,
}: LessonAiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

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
    if (!text || sending) return
    setInput("")
    setSending(true)
    setMessages((prev) => [...prev, { role: "user", content: text, proposals: [] }])
    try {
      const res = await sendLessonChatMessageAction({ lessonId, message: text })
      if (!res.success) {
        toast.error("Chat failed", { description: res.error ?? "Please try again." })
        setMessages((prev) => [...prev, { role: "assistant", content: res.error ?? "Something went wrong.", proposals: [] }])
        return
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.message,
          proposals: res.proposals.map((p) => ({ ...p, _status: "pending" as ProposalStatus })),
        },
      ])
    } finally {
      setSending(false)
    }
  }, [input, lessonId, sending])

  const updateProposal = (mi: number, pi: number, status: ProposalStatus) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === mi ? { ...m, proposals: m.proposals.map((p, j) => (j === pi ? { ...p, _status: status } : p)) } : m,
      ),
    )
  }

  const addProposal = useCallback(
    async (mi: number, pi: number, proposal: ProposedActivity) => {
      updateProposal(mi, pi, "adding")
      const res = await confirmProposedActivityAction({ lessonId, proposal })
      if (!res.success) {
        toast.error("Couldn't add activity", { description: res.error ?? "Please try again." })
        updateProposal(mi, pi, "pending")
        return
      }
      updateProposal(mi, pi, "added")
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
            Ask me to generate multiple‑choice or short‑answer questions from this lesson&apos;s
            objectives and existing activities. e.g. <em>&quot;Make 3 MCQs on the key vocabulary.&quot;</em>
          </p>
        ) : null}

        {messages.map((m, mi) => (
          <div key={mi} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
            {m.content ? (
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-pa-green px-3 py-2 text-sm text-white"
                    : "max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground"
                }
              >
                {m.content}
              </div>
            ) : null}

            {m.proposals.map((p, pi) => (
              <ProposalCard
                key={pi}
                proposal={p}
                scLabel={scLabel}
                onAdd={() => addProposal(mi, pi, p)}
                onDiscard={() => updateProposal(mi, pi, "discarded")}
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder="Ask the AI to create MCQ / short‑answer activities…"
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-pa-green"
            disabled={sending}
          />
          <Button onClick={() => void send()} disabled={sending || !input.trim()} className="h-9 w-9 shrink-0 p-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProposalCard({
  proposal,
  scLabel,
  onAdd,
  onDiscard,
}: {
  proposal: ProposedActivity & { _status: ProposalStatus }
  scLabel: (id: string) => string
  onAdd: () => void
  onDiscard: () => void
}) {
  const isMcq = proposal.type === "multiple-choice-question"
  const discarded = proposal._status === "discarded"
  const added = proposal._status === "added"

  return (
    <div
      className={[
        "rounded-lg border bg-background p-3 text-sm transition",
        discarded ? "border-border/60 opacity-50" : "border-pa-green/40",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="rounded-full bg-pa-green-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pa-green">
          {isMcq ? "MCQ" : "Short answer"}
        </span>
        <span className="truncate text-xs font-medium text-muted-foreground">{proposal.title}</span>
      </div>

      <p className="font-medium text-foreground">{proposal.question}</p>

      {isMcq ? (
        <ul className="mt-2 space-y-1">
          {(proposal.options ?? []).map((opt, i) => (
            <li
              key={i}
              className={
                opt.correct
                  ? "flex items-center gap-1.5 font-semibold text-pa-green"
                  : "flex items-center gap-1.5 text-muted-foreground"
              }
            >
              {opt.correct ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
              {opt.text}
            </li>
          ))}
        </ul>
      ) : proposal.modelAnswer ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold">Model answer:</span> {proposal.modelAnswer}
        </p>
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
        ) : (
          <>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDiscard}>
              Discard
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={onAdd}
              disabled={proposal._status === "adding"}
            >
              {proposal._status === "adding" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
