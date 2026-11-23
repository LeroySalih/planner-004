import { EmailTestPanel } from '@/components/admin/EmailTestPanel'
import { requireRole } from '@/lib/auth'
import { emailConfigStatus } from '@/lib/email/mailer'

// Email set-up status and a test send. The admin layout and the action check
// the admin role; the profile is read here for the admin's own address.
export default async function EmailPage() {
  const profile = await requireRole('admin')
  const status = emailConfigStatus()

  const rows: Array<[string, string]> = [
    ['Set up', status.configured ? 'Yes' : `No (missing or wrong: ${status.problems.join(', ')})`],
    ['Host (SMTP_HOST)', status.host ?? '—'],
    ['Port (SMTP_PORT)', status.port ? String(status.port) : '—'],
    ['User (SMTP_USER)', status.user ?? '—'],
    ['From (MAIL_FROM)', status.from ?? '—'],
    ['Password set (SMTP_PASSWORD)', status.passwordSet ? 'Yes' : 'No'],
  ]

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Email</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          DINO sends email through a Gmail account by SMTP. Send a test email to make sure the settings work.
        </p>
      </div>

      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b last:border-b-0">
              <th className="py-2 pr-4 text-left font-medium text-[var(--color-text-secondary)]">{label}</th>
              <td className="py-2 break-all">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <EmailTestPanel defaultTo={profile.email ?? ''} configured={status.configured} />

      <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">How to set it up</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>In the Gmail account, turn on 2-Step Verification (Google Account &gt; Security).</li>
          <li>
            Create an App Password (Google Account &gt; Security &gt; 2-Step Verification &gt; App passwords). Google
            shows it once, as 16 letters.
          </li>
          <li>
            In the server&apos;s <code>.env</code>, set <code>SMTP_HOST=smtp.gmail.com</code>,{' '}
            <code>SMTP_PORT=587</code>, <code>SMTP_USER</code> (the full Gmail address), <code>SMTP_PASSWORD</code>{' '}
            (the App Password) and, if you want, <code>MAIL_FROM</code> (default <code>DINO &lt;SMTP_USER&gt;</code>).
          </li>
          <li>Restart the app, then send a test email.</li>
        </ol>
      </div>
    </div>
  )
}
