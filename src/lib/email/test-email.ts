import "server-only"

// The test email sent from /admin/email, and the limit on how often an admin
// can send one.

export const TEST_EMAIL_SUBJECT = "DINO test email"

const LIMIT = 5
const WINDOW_MS = 10 * 60 * 1000
const sends = new Map<string, number[]>()

/** Counts one send for this user, or returns false when they sent 5 in the last 10 minutes. */
export function takeTestEmailSlot(userId: string, now = Date.now()): boolean {
  const recent = (sends.get(userId) ?? []).filter((at) => now - at < WINDOW_MS)
  if (recent.length >= LIMIT) {
    sends.set(userId, recent)
    return false
  }
  sends.set(userId, [...recent, now])
  return true
}

/** DD-MM-YYYY HH:MM in the school's timezone (TIMEZONE in .env), else the server's. */
export function formatSchoolDateTime(date: Date, timeZone = process.env.TIMEZONE): string {
  const format = (zone: string | undefined) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = format(timeZone || undefined)
  } catch {
    parts = format(undefined)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ""
  return `${part("day")}-${part("month")}-${part("year")} ${part("hour")}:${part("minute")}`
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function buildTestEmail(input: { senderFirstName: string | null; sentAt: Date; timeZone?: string }) {
  const sender = input.senderFirstName?.trim() || "an admin"
  const when = formatSchoolDateTime(input.sentAt, input.timeZone)
  const text = [
    "This is a test email from DINO.",
    "",
    `Sent at ${when} by ${sender}.`,
    "",
    "If you can read this, DINO can send email.",
  ].join("\n")
  const html = [
    "<p>This is a test email from DINO.</p>",
    `<p>Sent at ${escapeHtml(when)} by ${escapeHtml(sender)}.</p>`,
    "<p>If you can read this, DINO can send email.</p>",
  ].join("\n")
  return { subject: TEST_EMAIL_SUBJECT, text, html }
}
