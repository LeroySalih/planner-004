import { createHash, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'

import { query } from '@/lib/db'
import { DEFAULT_PUPIL_PASSWORD } from '@/lib/default-password'
import type { EmailMessage, MailTransport } from '@/lib/email/mailer'
import {
  FORGOT_PASSWORD_MESSAGE,
  RESET_LIMIT_PER_ACCOUNT,
  RESET_LIMIT_PER_IP,
  buildPasswordResetEmail,
  findUsableResetToken,
  forgotPasswordReply,
  passwordResetAvailable,
  resetLinkOrigin,
  resetPasswordWithToken,
} from '@/lib/password-reset'

// "Forgot password?" (src/lib/password-reset.ts) against the dev database,
// with a fake mail transport: no network, no real email. Own test profiles,
// deleted at the end.
// Run: npx tsx tests/auth/password-reset.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const ORIGIN = 'https://dino.example.test'
const env = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_USER: 'sender@example.test',
  SMTP_PASSWORD: 'not-a-real-password',
  APP_ORIGIN: `${ORIGIN}/`,
}

const run = randomBytes(4).toString('hex')
const ids = { active: `pwreset-active-${run}`, inactive: `pwreset-inactive-${run}`, noEmail: `pwreset-noemail-${run}` }
const emails = { active: `pwreset-active-${run}@example.test`, inactive: `pwreset-inactive-${run}@example.test` }
const ipBase = `198.51.${Number.parseInt(run.slice(0, 2), 16)}.${Number.parseInt(run.slice(2, 4), 16)}`
const usedIps: string[] = []
const ip = (label: string) => {
  const value = `${ipBase}-${label}`
  usedIps.push(value)
  return value
}

const sent: (EmailMessage & { from: string })[] = []
const transport: MailTransport = {
  async sendMail(message) {
    sent.push(message)
    return { messageId: `fake-${sent.length}` }
  },
}
const logLines: string[] = []
const log = (line: string, details: Record<string, unknown>) => logLines.push(`${line} ${JSON.stringify(details)}`)
const options = { env, transport, log }

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const tokenFrom = (message: EmailMessage) => /[?&]token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] ?? null

async function addSession(userId: string) {
  await query(
    `insert into auth_sessions (user_id, token_hash, expires_at) values ($1, 'x', now() + interval '1 hour')`,
    [userId],
  )
}

async function cleanup() {
  await query('delete from password_reset_tokens where user_id = any($1::text[]) or request_ip = any($2::text[])', [
    Object.values(ids),
    usedIps,
  ])
  await query('delete from auth_sessions where user_id = any($1::text[])', [Object.values(ids)])
  await query('delete from profiles where user_id = any($1::text[])', [Object.values(ids)])
}

async function main() {
  await query(
    `insert into profiles (user_id, first_name, last_name, email, active, must_change_password)
     values ($1, 'Testa', 'Reset', $2, true, true),
            ($3, 'Testb', 'Reset', $4, false, false),
            ($5, 'Testc', 'Reset', null, true, false)`,
    [ids.active, emails.active, ids.inactive, emails.inactive, ids.noEmail],
  )

  // Settings
  check('available with email and origin', passwordResetAvailable(env))
  check('not available without SMTP', !passwordResetAvailable({ APP_ORIGIN: ORIGIN }))
  check('not available without an origin', !passwordResetAvailable({ ...env, APP_ORIGIN: undefined }))
  check('origin drops the trailing slash', resetLinkOrigin(env) === ORIGIN)

  // Same message for every address
  const known = await forgotPasswordReply({ email: emails.active, ip: ip('a') }, options)
  const unknown = await forgotPasswordReply({ email: `nobody-${run}@example.test`, ip: ip('a') }, options)
  const inactive = await forgotPasswordReply({ email: emails.inactive, ip: ip('a') }, options)
  const noEmail = await forgotPasswordReply({ email: '', ip: ip('a') }, options)
  const replies = [known, unknown, inactive, noEmail]
  check('same message for known, unknown, inactive and empty', replies.every((r) => r.message === FORGOT_PASSWORD_MESSAGE))
  check('outcomes', known.outcome === 'sent' && unknown.outcome === 'no-account' && inactive.outcome === 'no-account',
    replies.map((r) => r.outcome).join(','))
  check('no delivery for unknown or inactive', unknown.delivery === null && inactive.delivery === null)
  await known.delivery
  check('one email, to the active account only', sent.length === 1 && sent[0].to === emails.active, String(sent.length))

  const email = sent[0]
  check('subject', email?.subject === 'Reset your DINO password')
  check('first name only', email?.text.includes('Hello Testa,') && !email.text.includes('Reset,'))
  check('link to the configured origin', email?.text.includes(`${ORIGIN}/reset-password?token=`))
  check('html has the link', Boolean(email?.html?.includes(`${ORIGIN}/reset-password?token=`)))
  check('says 30 minutes and once', Boolean(email?.text.includes('30 minutes and only once')))
  check('says ignore it', Boolean(email?.text.includes('If you did not ask for this, ignore this email; your password does not change.')))
  const token1 = email ? tokenFrom(email) : null
  const { rows: stored } = await query<{ token_hash: string; user_id: string | null }>(
    'select token_hash, user_id from password_reset_tokens where user_id = $1',
    [ids.active],
  )
  check('stored hash is sha256 of the token', Boolean(token1) && stored.length === 1 && stored[0].token_hash === sha256(token1!))
  check('raw token not stored', !stored.some((row) => row.token_hash === token1))
  check('mailer log line has domain, purpose, no address',
    logLines.some((line) => line.includes('"purpose":"password-reset"') && line.includes('"toDomain":"example.test"')) &&
      !logLines.some((line) => line.includes(emails.active)), logLines.join(' | '))
  const escaped = buildPasswordResetEmail({ firstName: '<b>', link: `${ORIGIN}/x` })
  check('html escapes the name', Boolean(escaped.html.includes('&lt;b&gt;')) && !escaped.html.includes('<b>'))

  // The reply does not wait for the send
  const hanging: MailTransport = { sendMail: () => new Promise(() => {}) }
  const started = Date.now()
  const quick = await Promise.race([
    forgotPasswordReply({ email: emails.active.toUpperCase(), ip: ip('b') }, { env, transport: hanging, log }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ])
  check('reply does not wait for SMTP', quick !== null && Date.now() - started < 5000)
  check('case-insensitive lookup', quick?.outcome === 'sent', String(quick?.outcome))

  // Per-account limit: 2 requests so far in this hour
  const third = await forgotPasswordReply({ email: emails.active, ip: ip('c') }, options)
  await third.delivery
  const fourth = await forgotPasswordReply({ email: emails.active, ip: ip('d') }, options)
  check(`account limit is ${RESET_LIMIT_PER_ACCOUNT} per hour`, third.outcome === 'sent' && fourth.outcome === 'account-limit',
    `${third.outcome}, ${fourth.outcome}`)
  check('over the limit: same message, no email', fourth.message === FORGOT_PASSWORD_MESSAGE && fourth.delivery === null && sent.length === 2)

  // Per-IP limit
  const ipLimited = ip('e')
  const outcomes: string[] = []
  for (let i = 0; i <= RESET_LIMIT_PER_IP; i += 1) {
    outcomes.push((await forgotPasswordReply({ email: `nobody-${run}-${i}@example.test`, ip: ipLimited }, options)).outcome)
  }
  check(`IP limit is ${RESET_LIMIT_PER_IP} per hour`,
    outcomes.slice(0, RESET_LIMIT_PER_IP).every((o) => o === 'no-account') && outcomes[RESET_LIMIT_PER_IP] === 'ip-limit',
    outcomes.join(','))
  const ipBlockedKnown = await forgotPasswordReply({ email: emails.active, ip: ipLimited }, options)
  check('IP limit also blocks a known address', ipBlockedKnown.outcome === 'ip-limit')

  // Earlier links stay usable
  const token3 = tokenFrom(sent[1])
  check('earlier link still usable', Boolean(token1 && (await findUsableResetToken(token1))))

  // Refusals
  const good = 'a-new-password-1'
  const unknownToken = randomBytes(32).toString('base64url')
  const r1 = await resetPasswordWithToken({ token: unknownToken, password: good, confirmPassword: good })
  check('unknown token refused', !r1.ok && r1.reason === 'invalid-token')
  check('malformed token refused', !(await findUsableResetToken('abc')))

  const expiredToken = randomBytes(32).toString('base64url')
  await query(
    `insert into password_reset_tokens (token_hash, user_id, created_at, expires_at) values ($1, $2, now() - interval '2 hours', now() - interval '90 minutes')`,
    [sha256(expiredToken), ids.active],
  )
  const r2 = await resetPasswordWithToken({ token: expiredToken, password: good, confirmPassword: good })
  check('expired token refused', !r2.ok && r2.reason === 'invalid-token')

  const r3 = await resetPasswordWithToken({ token: token1!, password: DEFAULT_PUPIL_PASSWORD, confirmPassword: DEFAULT_PUPIL_PASSWORD })
  check('default password refused', !r3.ok && r3.reason === 'invalid-password')
  const r4 = await resetPasswordWithToken({ token: token1!, password: good, confirmPassword: `${good}x` })
  check('mismatched confirm refused', !r4.ok && r4.reason === 'invalid-password')
  const r5 = await resetPasswordWithToken({ token: token1!, password: '12345', confirmPassword: '12345' })
  check('short password refused', !r5.ok && r5.reason === 'invalid-password')
  check('refusals leave the token usable', Boolean(await findUsableResetToken(token1!)))

  // Success
  await addSession(ids.active)
  await addSession(ids.active)
  const ok = await resetPasswordWithToken({ token: token1!, password: good, confirmPassword: good })
  check('reset succeeds', ok.ok && ok.userId === ids.active)
  const { rows: profile } = await query<{ password_hash: string; must_change_password: boolean }>(
    'select password_hash, must_change_password from profiles where user_id = $1',
    [ids.active],
  )
  check('hash set (bcrypt compare)', await bcrypt.compare(good, profile[0].password_hash))
  check('bcrypt cost 10', profile[0].password_hash.startsWith('$2a$10$') || profile[0].password_hash.startsWith('$2b$10$'))
  check('must_change_password cleared', profile[0].must_change_password === false)
  const { rows: tokens } = await query<{ token_hash: string; used_at: Date | null }>(
    'select token_hash, used_at from password_reset_tokens where user_id = $1',
    [ids.active],
  )
  check('token marked used, other tokens deleted', tokens.length === 1 && tokens[0].token_hash === sha256(token1!) && tokens[0].used_at !== null,
    String(tokens.length))
  check('later link deleted too', Boolean(token3) && !(await findUsableResetToken(token3!)))
  const { rows: sessions } = await query<{ n: number }>('select count(*)::int as n from auth_sessions where user_id = $1', [ids.active])
  check('all sessions ended', sessions[0].n === 0, String(sessions[0].n))

  const again = await resetPasswordWithToken({ token: token1!, password: 'another-pass', confirmPassword: 'another-pass' })
  check('token cannot be used twice', !again.ok && again.reason === 'invalid-token')
  const { rows: after } = await query<{ password_hash: string }>('select password_hash from profiles where user_id = $1', [ids.active])
  check('second use changes nothing', after[0].password_hash === profile[0].password_hash)

  // An inactive account's token never works
  const inactiveToken = randomBytes(32).toString('base64url')
  await query(
    `insert into password_reset_tokens (token_hash, user_id, expires_at) values ($1, $2, now() + interval '30 minutes')`,
    [sha256(inactiveToken), ids.inactive],
  )
  check('inactive account token refused', !(await findUsableResetToken(inactiveToken)))
}

main()
  .catch((error) => {
    failed += 1
    console.error('FAIL unexpected error', error)
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error('cleanup failed', error))
    console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
    process.exit(failed === 0 ? 0 : 1)
  })
