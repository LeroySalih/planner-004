import "server-only"

import { query } from "@/lib/db"

// The sign-in lock is derived, never stored: an email is locked while it has
// SIGNIN_EMAIL_FAILURE_LIMIT failed attempts (not counting 'throttled' ones) in
// the last SIGNIN_WINDOW_MINUTES (isSigninThrottled, server-actions/auth.ts).

export const SIGNIN_WINDOW_MINUTES = 15
export const SIGNIN_EMAIL_FAILURE_LIMIT = 5
export const SIGNIN_IP_FAILURE_LIMIT = 25

type Queryable = { query: (text: string, values?: unknown[]) => Promise<unknown> }

/**
 * Unlocks an email: deletes its failed attempts inside the window, the rows that
 * make the lock. Older rows stay as the audit trail. The IP limit is not touched.
 * Pass a client to run it inside a transaction.
 */
export async function clearSigninLock(email: string, db: Queryable = { query }): Promise<void> {
  await db.query(
    `
      delete from sign_in_attempts
      where success = false
        and lower(email) = lower($1)
        and attempted_at >= now() - ($2::int * interval '1 minute')
    `,
    [email.trim(), SIGNIN_WINDOW_MINUTES],
  )
}
