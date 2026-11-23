import {
  EmailNotConfiguredError,
  EmailSendError,
  InvalidRecipientError,
  describeSmtpError,
  emailConfigStatus,
  normaliseRecipient,
  sendEmail,
  smtpTransportOptions,
  type MailTransport,
} from '@/lib/email/mailer'
import { buildTestEmail, formatSchoolDateTime, takeTestEmailSlot } from '@/lib/email/test-email'

// The email service (src/lib/email) with a fake transport: no network, and
// nodemailer does not need to be installed.
// Run: npx tsx tests/email/mailer.check.ts

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const PASSWORD = 'abcd efgh ijkl mnop'
const env = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'owner@gmail.com',
  SMTP_PASSWORD: PASSWORD,
}
const server = { host: 'smtp.gmail.com', port: 587 }

async function rejects(promise: Promise<unknown>, type: new (...args: never[]) => Error) {
  try {
    await promise
    return null
  } catch (error) {
    return error instanceof type ? error : null
  }
}

async function main() {
  // Status
  const status = emailConfigStatus(env)
  check('configured with host, user and password', status.configured, JSON.stringify(status))
  check('port defaults to 587', status.port === 587)
  check('from defaults to DINO <user>', status.from === 'DINO <owner@gmail.com>', String(status.from))
  check('passwordSet is true', status.passwordSet)
  check('status never has the password', !JSON.stringify(status).includes('abcd') && !JSON.stringify(status).includes('mnop'))
  check('MAIL_FROM is used', emailConfigStatus({ ...env, MAIL_FROM: 'School <x@gmail.com>' }).from === 'School <x@gmail.com>')

  const empty = emailConfigStatus({})
  check('not configured without env', !empty.configured && !empty.passwordSet && empty.host === null)
  check('names every missing var', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].every((name) => empty.problems.includes(name)))
  const badPort = emailConfigStatus({ ...env, SMTP_PORT: 'abc' })
  check('a bad port is not configured', !badPort.configured && badPort.problems.includes('SMTP_PORT'))

  // Not configured
  let sent = 0
  const fake: MailTransport & { last?: Record<string, unknown> } = {
    async sendMail(message) {
      sent += 1
      fake.last = message
      return { messageId: '<id-1@gmail.com>' }
    },
  }
  const notConfigured = await rejects(
    sendEmail({ to: 'a@b.com', subject: 's', text: 't' }, { env: {}, transport: fake, log: () => {} }),
    EmailNotConfiguredError,
  )
  check('not configured throws EmailNotConfiguredError', Boolean(notConfigured))
  check('that error names the vars', Boolean(notConfigured?.message.includes('SMTP_PASSWORD')))
  check('nothing sent when not configured', sent === 0)

  // Addresses
  check('a plain address is accepted', normaliseRecipient('  Pupil.One+x@school.example.org ') === 'Pupil.One+x@school.example.org')
  for (const bad of ['', 'a@b', 'a b@c.com', 'a@b.com, c@d.com', 'a@b.com;c@d.com', 'Name <a@b.com>', 'a@b.com\nBcc: c@d.com', '@b.com']) {
    check(`refuses ${JSON.stringify(bad)}`, normaliseRecipient(bad) === null)
  }
  const invalid = await rejects(
    sendEmail({ to: 'a@b.com, c@d.com', subject: 's', text: 't' }, { env, transport: fake, log: () => {} }),
    InvalidRecipientError,
  )
  check('sendEmail refuses two addresses', Boolean(invalid) && sent === 0)

  // Transport options
  const config = { host: 'smtp.gmail.com', port: 587, user: 'owner@gmail.com', password: 'p', from: 'DINO <owner@gmail.com>' }
  const on587 = smtpTransportOptions(config)
  check('587: secure false, requireTLS true', on587.secure === false && on587.requireTLS === true)
  check('timeouts set', on587.connectionTimeout === 15_000 && on587.greetingTimeout === 15_000 && on587.socketTimeout === 20_000)
  const on465 = smtpTransportOptions({ ...config, port: 465 })
  check('465: secure true, requireTLS false', on465.secure === true && on465.requireTLS === false)

  // Error mapping
  const authMessage = describeSmtpError(
    { code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' },
    server,
  )
  check('535 5.7.8 says App Password', authMessage.includes('App Password'), authMessage)
  check('blocked port is named', describeSmtpError({ code: 'ETIMEDOUT' }, server).includes('port 587'))
  check('refused connection is named', describeSmtpError({ code: 'ESOCKET', originalCode: 'ECONNREFUSED' }, server).includes('port 587'))
  check('dns failure names the host', describeSmtpError({ code: 'EDNS', originalCode: 'ENOTFOUND' }, server).includes('SMTP_HOST'))
  check('daily limit', describeSmtpError({ code: 'EENVELOPE', responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' }, server).includes('daily'))
  const other = describeSmtpError({ code: 'EMESSAGE', responseCode: 552, response: `secret ${PASSWORD}` }, server)
  check('unknown error gives only the code', other.includes('552') && !other.includes('secret'), other)

  // Send through the fake transport
  const lines: Array<{ line: string; details: Record<string, unknown> }> = []
  const log = (line: string, details: Record<string, unknown>) => lines.push({ line, details })
  const email = buildTestEmail({ senderFirstName: 'Leroy', sentAt: new Date('2026-11-23T05:07:00Z'), timeZone: 'Asia/Riyadh' })
  const result = await sendEmail({ to: ' Teacher@School.example.org ', ...email }, { env, transport: fake, log, purpose: 'test' })
  check('returns the message id', result.messageId === '<id-1@gmail.com>')
  check('to passed', fake.last?.to === 'Teacher@School.example.org', String(fake.last?.to))
  check('from passed', fake.last?.from === 'DINO <owner@gmail.com>')
  check('subject passed', fake.last?.subject === 'DINO test email')
  check('text passed', fake.last?.text === email.text)
  check('html passed', fake.last?.html === email.html)
  const logged = JSON.stringify(lines)
  check('one log line', lines.length === 1 && lines[0].line === '[email] sent')
  check('log has domain, purpose, result', lines[0]?.details.toDomain === 'school.example.org' && lines[0]?.details.purpose === 'test' && lines[0]?.details.result === 'sent')
  check('log has no address or body', !logged.includes('Teacher@') && !logged.toLowerCase().includes('teacher@') && !logged.includes('test email from DINO'))

  // A failed send
  lines.length = 0
  const failing: MailTransport = {
    async sendMail() {
      throw Object.assign(new Error(`Invalid login: 535-5.7.8 for owner@gmail.com ${PASSWORD}`), { code: 'EAUTH', responseCode: 535 })
    },
  }
  const sendError = await rejects(sendEmail({ to: 'x@y.org', subject: 's', text: 't' }, { env, transport: failing, log }), EmailSendError)
  check('failure throws EmailSendError', Boolean(sendError))
  check('failure message has no password', Boolean(sendError) && !sendError!.message.includes('abcd') && !sendError!.message.includes(PASSWORD))
  check('failure logged with domain only', lines[0]?.line === '[email] failed' && lines[0]?.details.toDomain === 'y.org' && !JSON.stringify(lines).includes('x@y.org'))

  // Test email body and rate limit
  check('time is DD-MM-YYYY HH:MM in the school zone', email.text.includes('23-11-2026 08:07'), email.text)
  check('sender first name', email.text.includes('by Leroy.') && email.html.includes('by Leroy.'))
  check('bad timezone falls back', /^\d\d-\d\d-\d{4} \d\d:\d\d$/.test(formatSchoolDateTime(new Date(), 'Not/AZone')))
  check('html is escaped', buildTestEmail({ senderFirstName: '<b>', sentAt: new Date() }).html.includes('&lt;b&gt;'))
  const t0 = 1_000_000
  const slots = [0, 1, 2, 3, 4, 5].map((i) => takeTestEmailSlot('admin-1', t0 + i * 1000))
  check('5 sends allowed, the 6th refused', slots.slice(0, 5).every(Boolean) && slots[5] === false)
  check('another admin is not limited', takeTestEmailSlot('admin-2', t0))
  check('allowed again after 10 minutes', takeTestEmailSlot('admin-1', t0 + 10 * 60 * 1000 + 1))

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
