'use server'

import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { EmailNotConfiguredError, EmailSendError, InvalidRecipientError, sendEmail } from '@/lib/email/mailer'
import { buildTestEmail, takeTestEmailSlot } from '@/lib/email/test-email'
import { withTelemetry } from '@/lib/telemetry'

// "Send test email" on /admin/email. Admin only, at most 5 per admin per 10
// minutes (in memory, per app process).

type Result<T> = { data: T | null; error: string | null }

const ROUTE_TAG = '/admin/email'

const SendTestEmailInput = z.object({ to: z.string().trim().min(1).max(254) })

export async function sendTestEmailAction(input: { to: string }): Promise<Result<{ messageId: string }>> {
  return withTelemetry({ routeTag: ROUTE_TAG, functionName: 'sendTestEmailAction' }, async () => {
    try {
      const profile = await requireRole('admin')
      const parsed = SendTestEmailInput.safeParse(input)
      if (!parsed.success) return { data: null, error: 'Give one email address.' }
      if (!takeTestEmailSlot(profile.userId)) {
        return { data: null, error: 'You sent 5 test emails in the last 10 minutes. Wait, then try again.' }
      }
      const email = buildTestEmail({ senderFirstName: profile.firstName ?? null, sentAt: new Date() })
      const result = await sendEmail({ to: parsed.data.to, ...email }, { purpose: 'test' })
      return { data: result, error: null }
    } catch (error) {
      unstable_rethrow(error)
      if (
        error instanceof EmailNotConfiguredError ||
        error instanceof InvalidRecipientError ||
        error instanceof EmailSendError
      ) {
        return { data: null, error: error.message }
      }
      console.error('[email] test send failed', error instanceof Error ? error.name : 'unknown')
      return { data: null, error: 'Could not send the test email.' }
    }
  })
}
