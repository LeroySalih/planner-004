'use client'

import { useState, useTransition } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sendTestEmailAction } from '@/lib/server-updates'

type Outcome = { ok: true; messageId: string } | { ok: false; error: string }

export function EmailTestPanel({ defaultTo, configured }: { defaultTo: string; configured: boolean }) {
  const [to, setTo] = useState(defaultTo)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [pending, startTransition] = useTransition()

  const send = () =>
    startTransition(async () => {
      const result = await sendTestEmailAction({ to })
      if (result.error || !result.data) {
        const error = result.error ?? 'Could not send the test email.'
        setOutcome({ ok: false, error })
        toast.error(error)
        return
      }
      setOutcome({ ok: true, messageId: result.data.messageId })
      toast.success(`Test email sent to ${to.trim()}`)
    })

  return (
    <form
      className="space-y-3 rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="test-email-to">To</Label>
        <Input
          id="test-email-to"
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          required
        />
      </div>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Subject: <span className="font-medium">DINO test email</span>
      </p>
      <Button type="submit" disabled={pending || !to.trim()}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />}
        Send test email
      </Button>
      {!configured && (
        <p className="text-sm text-[var(--color-text-secondary)]">Email is not set up yet: the send will fail until it is.</p>
      )}
      {outcome?.ok && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 break-all">
          Sent. Message id: <code>{outcome.messageId || '(none given)'}</code>
        </p>
      )}
      {outcome && !outcome.ok && <p className="text-sm text-destructive">{outcome.error}</p>}
    </form>
  )
}
