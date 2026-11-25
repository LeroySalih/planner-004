import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { hashPassword } from "@/lib/auth"
import { query, withDbClient } from "@/lib/db"
import { isDefaultPassword } from "@/lib/default-password"
import { emailConfigStatus, sendEmail, type SendEmailOptions } from "@/lib/email/mailer"
import { clearSigninLock } from "@/lib/signin-lock"

// "Forgot password?": a one-time link by email, then a new password.
// Tokens are stored as a sha256 hash only (password_reset_tokens, migration
// 153); the raw token is only in the email. See CLAUDE.md, "Forgot password".

type Env = Record<string, string | undefined>

export const RESET_TOKEN_MINUTES = 30
export const RESET_LIMIT_PER_ACCOUNT = 3
export const RESET_LIMIT_PER_IP = 10

/** The only reply /forgot-password ever gives, so nobody can learn which addresses have accounts. */
export const FORGOT_PASSWORD_MESSAGE =
  "If an account has this email address, we have sent a link to it. The link works for 30 minutes. Look in your junk folder too."

export const RESET_PATH = "/reset-password"

/** The app's public origin for the link: APP_ORIGIN, else NEXT_PUBLIC_APP_URL. Never the request's Host header. */
export function resetLinkOrigin(env: Env = process.env): string | null {
  const configured = env.APP_ORIGIN?.trim() || env.NEXT_PUBLIC_APP_URL?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null
  } catch {
    return null
  }
}

/** Email is set up and the link has an origin. */
export function passwordResetAvailable(env: Env = process.env): boolean {
  return emailConfigStatus(env).configured && resetLinkOrigin(env) !== null
}

export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex")

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function buildPasswordResetEmail(input: { firstName: string | null; link: string }) {
  const name = input.firstName?.trim()
  const greeting = name ? `Hello ${name},` : "Hello,"
  const text = [
    greeting,
    "",
    "Someone asked to reset the password for your DINO account. To choose a new password, open this link:",
    "",
    input.link,
    "",
    `The link works for ${RESET_TOKEN_MINUTES} minutes and only once.`,
    "",
    "If you did not ask for this, ignore this email; your password does not change.",
  ].join("\n")
  const link = escapeHtml(input.link)
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    "<p>Someone asked to reset the password for your DINO account. To choose a new password, open this link:</p>",
    `<p><a href="${link}">Choose a new password</a></p>`,
    `<p style="color:#555;font-size:13px">Or copy this into your browser:<br>${link}</p>`,
    `<p>The link works for ${RESET_TOKEN_MINUTES} minutes and only once.</p>`,
    "<p>If you did not ask for this, ignore this email; your password does not change.</p>",
  ].join("\n")
  return { subject: "Reset your DINO password", text, html }
}

export type ResetRequestOutcome = "sent" | "no-account" | "account-limit" | "ip-limit" | "unavailable"

export type ResetRequestOptions = Pick<SendEmailOptions, "transport" | "log"> & { env?: Env }

/**
 * Handles one /forgot-password request. The caller gives the same reply
 * whatever the outcome. `delivery` is the email send (null when nothing is
 * sent); it never rejects, and the action does not wait for it, so the reply
 * takes the same time whether or not an email goes out.
 */
export async function requestPasswordReset(
  input: { email: string; ip: string | null },
  options: ResetRequestOptions = {},
): Promise<{ outcome: ResetRequestOutcome; delivery: Promise<void> | null }> {
  const env = options.env ?? process.env
  const origin = resetLinkOrigin(env)
  if (!origin || !emailConfigStatus(env).configured) return { outcome: "unavailable", delivery: null }

  const email = input.email.trim().toLowerCase()
  const ip = input.ip?.trim() || null

  // An inactive account, or one without a password, is the same as no account.
  const { rows: profiles } = await query<{ user_id: string; email: string; first_name: string | null }>(
    `select user_id, email, first_name
       from profiles
      where lower(email) = $1 and active
      limit 1`,
    [email],
  )
  const account = profiles[0] ?? null

  // One query for both limits, run whether or not the account exists.
  const { rows: counts } = await query<{ account_count: number; ip_count: number }>(
    `select count(*) filter (where user_id = $1)::int as account_count,
            count(*) filter (where request_ip = $2)::int as ip_count
       from password_reset_tokens
      where created_at > now() - interval '1 hour'
        and (user_id = $1 or request_ip = $2)`,
    [account?.user_id ?? null, ip],
  )
  const userLabel = account?.user_id ?? "no account"
  if ((counts[0]?.ip_count ?? 0) >= RESET_LIMIT_PER_IP) {
    console.warn("[auth] password reset refused: IP limit", { userId: userLabel, ip })
    return { outcome: "ip-limit", delivery: null }
  }
  if ((counts[0]?.account_count ?? 0) >= RESET_LIMIT_PER_ACCOUNT) {
    console.warn("[auth] password reset refused: account limit", { userId: userLabel, ip })
    return { outcome: "account-limit", delivery: null }
  }

  // A row for no account too: it counts towards the IP limit and can never reset anything.
  const token = randomBytes(32).toString("base64url")
  await query(
    `insert into password_reset_tokens (token_hash, user_id, expires_at, request_ip)
     values ($1, $2, now() + ($3::int * interval '1 minute'), $4)`,
    [hashResetToken(token), account?.user_id ?? null, RESET_TOKEN_MINUTES, ip],
  )
  await query("delete from password_reset_tokens where created_at < now() - interval '7 days'")
  console.info("[auth] password reset requested", { userId: userLabel, ip })

  if (!account) return { outcome: "no-account", delivery: null }

  const message = buildPasswordResetEmail({
    firstName: account.first_name,
    link: `${origin}${RESET_PATH}?token=${encodeURIComponent(token)}`,
  })
  const delivery = sendEmail(
    { to: account.email, ...message },
    { purpose: "password-reset", env, transport: options.transport, log: options.log },
  ).then(
    () => undefined,
    // sendEmail has logged the domain and the result; this names the account, never the address.
    (error: unknown) => {
      console.error("[auth] password reset email not sent", {
        userId: account.user_id,
        error: error instanceof Error ? error.name : "unknown",
      })
    },
  )
  return { outcome: "sent", delivery }
}

/**
 * What /forgot-password answers: always FORGOT_PASSWORD_MESSAGE, whatever
 * happened, errors included. `delivery` is for checks; the action ignores it.
 */
export async function forgotPasswordReply(
  input: { email: string; ip: string | null },
  options: ResetRequestOptions = {},
): Promise<{ message: string; outcome: ResetRequestOutcome | "error"; delivery: Promise<void> | null }> {
  try {
    const { outcome, delivery } = await requestPasswordReset(input, options)
    return { message: FORGOT_PASSWORD_MESSAGE, outcome, delivery }
  } catch (error) {
    console.error("[auth] password reset request failed", { error: error instanceof Error ? error.name : "unknown" })
    return { message: FORGOT_PASSWORD_MESSAGE, outcome: "error", delivery: null }
  }
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/** The account an unused, unexpired token belongs to, or null. */
export async function findUsableResetToken(token: string | null | undefined): Promise<{ userId: string } | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null
  const { rows } = await query<{ user_id: string }>(
    `select t.user_id
       from password_reset_tokens t
       join profiles p on p.user_id = t.user_id
      where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and p.active`,
    [hashResetToken(token)],
  )
  return rows[0] ? { userId: rows[0].user_id } : null
}

export type ResetPasswordResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid-token" | "invalid-password"; message: string }

export const INVALID_RESET_LINK_MESSAGE = "This link does not work. It is used, or more than 30 minutes old."

/**
 * Sets a new password from a reset link. The same rules as /change-password
 * (trimmed, at least 6 characters, not the default). In one transaction: the
 * new hash, must_change_password cleared, this token used, the account's other
 * tokens deleted, all its sessions ended, its sign-in lock cleared. It does not
 * sign the user in.
 */
export async function resetPasswordWithToken(input: {
  token: string
  password: string
  confirmPassword: string
}): Promise<ResetPasswordResult> {
  const invalidToken = { ok: false, reason: "invalid-token", message: INVALID_RESET_LINK_MESSAGE } as const
  if (!(await findUsableResetToken(input.token))) return invalidToken

  const password = input.password.trim()
  const refuse = (message: string) => ({ ok: false, reason: "invalid-password", message }) as const
  if (password.length < 6) return refuse("Password must be at least 6 characters long.")
  if (input.password !== input.confirmPassword) return refuse("Passwords must match.")
  if (isDefaultPassword(password)) return refuse("Choose a password of your own, not the default one.")

  const passwordHash = await hashPassword(password)
  const tokenHash = hashResetToken(input.token)

  const userId = await withDbClient(async (client) => {
    await client.query("begin")
    try {
      // Checked again under the row lock, so two submits of one link cannot both win.
      const { rows } = await client.query<{ user_id: string; email: string | null }>(
        `select t.user_id, p.email
           from password_reset_tokens t
           join profiles p on p.user_id = t.user_id
          where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and p.active
          for update of t`,
        [tokenHash],
      )
      const found = rows[0]?.user_id ?? null
      if (!found) {
        await client.query("rollback")
        return null
      }
      await client.query(
        "update profiles set password_hash = $1, must_change_password = false where user_id = $2",
        [passwordHash, found],
      )
      await client.query("update password_reset_tokens set used_at = now() where token_hash = $1", [tokenHash])
      await client.query("delete from password_reset_tokens where user_id = $1 and token_hash <> $2", [
        found,
        tokenHash,
      ])
      await client.query("delete from auth_sessions where user_id = $1", [found])
      if (rows[0].email) await clearSigninLock(rows[0].email, client)
      await client.query("commit")
      return found
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  })

  if (!userId) return invalidToken
  console.info("[auth] password reset completed", { userId })
  return { ok: true, userId }
}
