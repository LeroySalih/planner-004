import "server-only"

// Sends email by SMTP (the owner's Gmail account: smtp.gmail.com, port 587,
// STARTTLS, a Gmail App Password). All settings come from .env and are
// optional: without them the app runs and sendEmail throws
// EmailNotConfiguredError. The password never leaves this module: not in the
// status, not in an error message, not in a log line.

type Env = Record<string, string | undefined>

type EmailConfig = {
  host: string
  port: number
  user: string
  password: string
  from: string
}

export type EmailConfigStatus = {
  configured: boolean
  host: string | null
  port: number | null
  user: string | null
  from: string | null
  passwordSet: boolean
  /** Env var names that are missing or wrong. */
  problems: string[]
}

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

/** The part of a nodemailer transport sendEmail uses, so a check can pass a fake. */
export type MailTransport = {
  sendMail(message: EmailMessage & { from: string }): Promise<{ messageId?: string }>
}

export type SendEmailOptions = {
  /** What the email is for, for the log line (e.g. "test", "password-reset"). */
  purpose?: string
  transport?: MailTransport
  env?: Env
  log?: (line: string, details: Record<string, unknown>) => void
}

export class EmailNotConfiguredError extends Error {
  constructor(problems: string[]) {
    super(`Email is not set up. Set ${problems.join(", ")} in .env and restart the app.`)
    this.name = "EmailNotConfiguredError"
  }
}

export class InvalidRecipientError extends Error {
  constructor() {
    super("Give one email address, such as name@example.com.")
    this.name = "InvalidRecipientError"
  }
}

/** A send that failed, with a message safe to show an admin. */
export class EmailSendError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = "EmailSendError"
  }
}

const DEFAULT_PORT = 587
const TIMEOUT_MS = 15_000

const clean = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function readConfig(env: Env): { config: EmailConfig | null; status: EmailConfigStatus } {
  const host = clean(env.SMTP_HOST)
  const user = clean(env.SMTP_USER)
  // Google shows an App Password in groups of four; the spaces are not part of it.
  const password = env.SMTP_PASSWORD?.replace(/\s+/g, "") || null
  const portText = clean(env.SMTP_PORT)
  const port = portText === null ? DEFAULT_PORT : Number(portText)
  const portValid = Number.isInteger(port) && port > 0 && port < 65536
  const from = clean(env.MAIL_FROM) ?? (user ? `DINO <${user}>` : null)

  const problems: string[] = []
  if (!host) problems.push("SMTP_HOST")
  if (!portValid) problems.push("SMTP_PORT")
  if (!user) problems.push("SMTP_USER")
  if (!password) problems.push("SMTP_PASSWORD")

  const status: EmailConfigStatus = {
    configured: problems.length === 0,
    host,
    port: portValid ? port : null,
    user,
    from,
    passwordSet: Boolean(password),
    problems,
  }
  const config =
    status.configured && host && user && password && from ? { host, port, user, password, from } : null
  return { config, status }
}

export function emailConfigStatus(env: Env = process.env): EmailConfigStatus {
  return readConfig(env).status
}

/** nodemailer SMTP options: implicit TLS on 465, otherwise STARTTLS is required. */
export function smtpTransportOptions(config: EmailConfig) {
  const secure = config.port === 465
  return {
    host: config.host,
    port: config.port,
    secure,
    requireTLS: !secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 20_000,
  }
}

const ADDRESS = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]+$/

/** One plain address (no name, no list), or null. */
export function normaliseRecipient(to: string): string | null {
  const address = to.trim()
  return address.length <= 254 && ADDRESS.test(address) ? address : null
}

export const recipientDomain = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase()

type SmtpError = { code?: string; originalCode?: string; responseCode?: number; response?: string }

/** A plain message for a failed send. Built from codes only, never from the server's text or the config's password. */
export function describeSmtpError(error: unknown, server: { host: string; port: number }): string {
  const e = (error ?? {}) as SmtpError
  const where = `${server.host}:${server.port}`
  const code = e.code ?? ""
  const responseCode = e.responseCode
  const response = e.response ?? ""
  // nodemailer replaces a socket error's code (ECONNREFUSED …) with its own and keeps it as originalCode.
  const errno = e.originalCode ?? ""

  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) {
    return "The mail server refused the user name or password. For Gmail, SMTP_PASSWORD must be an App Password (Google Account > Security > 2-Step Verification > App passwords), not the account password, and SMTP_USER must be the full Gmail address."
  }
  if (code === "ENOAUTH") return "No user name or password was sent. Set SMTP_USER and SMTP_PASSWORD."
  if (code === "EDNS" || errno === "ENOTFOUND" || errno === "EAI_AGAIN") {
    return `Could not find the mail server ${server.host}. Check SMTP_HOST.`
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    errno === "ECONNREFUSED" ||
    errno === "ETIMEDOUT" ||
    errno === "EHOSTUNREACH" ||
    errno === "ENETUNREACH" ||
    code === "ESOCKET"
  ) {
    return `Could not connect to ${where}. The server may block outbound port ${server.port}, or the mail server is down.`
  }
  if (code === "ETLS" || code === "EREQUIRETLS") {
    return `The secure connection to ${where} failed. Use port 587 (STARTTLS) or 465 (SSL).`
  }
  if (responseCode === 550 && /5\.4\.5/.test(response)) {
    return "Gmail's daily sending limit is reached. Try again tomorrow."
  }
  if (code === "EENVELOPE") return "The mail server refused the recipient or sender address."
  return `The mail server did not accept the email${responseCode ? ` (SMTP ${responseCode})` : code ? ` (${code})` : ""}.`
}

async function createSmtpTransport(config: EmailConfig): Promise<MailTransport> {
  const nodemailer = await import("nodemailer")
  return nodemailer.createTransport(smtpTransportOptions(config))
}

const defaultLog = (line: string, details: Record<string, unknown>) => console.info(line, details)

/**
 * Sends one email to one address. Returns the server's message id. Throws
 * EmailNotConfiguredError, InvalidRecipientError or EmailSendError.
 * The log line names only the recipient's domain, the purpose and the result.
 */
export async function sendEmail(message: EmailMessage, options: SendEmailOptions = {}): Promise<{ messageId: string }> {
  const { config, status } = readConfig(options.env ?? process.env)
  if (!config) throw new EmailNotConfiguredError(status.problems)

  const to = normaliseRecipient(message.to)
  if (!to) throw new InvalidRecipientError()

  const log = options.log ?? defaultLog
  const details = { purpose: options.purpose ?? "general", toDomain: recipientDomain(to) }
  try {
    const transport = options.transport ?? (await createSmtpTransport(config))
    const info = await transport.sendMail({
      from: config.from,
      to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    })
    log("[email] sent", { ...details, result: "sent" })
    return { messageId: info.messageId ?? "" }
  } catch (error) {
    const code = (error as SmtpError | null)?.code ?? null
    log("[email] failed", { ...details, result: "failed", code })
    throw new EmailSendError(describeSmtpError(error, config), code)
  }
}
