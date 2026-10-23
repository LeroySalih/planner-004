import Link from "next/link"
import { ClipboardCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { UnitAudit } from "@/lib/unit-audits/store"

/** DD-MM-YYYY, the app's date format. */
function formatDate(iso: string | null): string {
  if (!iso) return ""
  const [year, month, day] = iso.slice(0, 10).split("-")
  return `${day}-${month}-${year}`
}

const BADGE_CLASS: Record<UnitAudit["status"], string> = {
  audited: "border-emerald-600 text-emerald-700 dark:text-emerald-400",
  failed: "border-red-600 text-red-700 dark:text-red-400",
  not_audited: "text-muted-foreground",
}

export function UnitAuditBadge({ audit }: { audit: UnitAudit | null }) {
  const status = audit?.status ?? "not_audited"
  const label =
    status === "audited"
      ? `Audited ${formatDate(audit?.auditedAt ?? null)}`
      : status === "failed"
        ? `Audit failed ${formatDate(audit?.auditedAt ?? null)}`
        : "Not audited"
  return (
    <Badge variant="outline" className={`gap-1 ${BADGE_CLASS[status]}`}>
      <ClipboardCheck className="h-3 w-3" />
      {label}
    </Badge>
  )
}

/** The last audit's actions, shown while there are any, even after a change. */
export function UnitAuditActions({ audit }: { audit: UnitAudit | null }) {
  if (!audit || audit.actions.length === 0) return null
  const changedSince = audit.status === "not_audited"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-semibold">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          Audit actions
        </CardTitle>
        <CardDescription>
          {`Why the audit of ${formatDate(audit.auditedAt)} failed${audit.auditedBy ? ` (recorded by ${audit.auditedBy})` : ""}.`}
          {changedSince ? " The unit has changed since, so it needs auditing again." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {audit.actions.map((item, index) => (
            <li key={index} className="flex gap-3 rounded-md border border-border px-3 py-2">
              <span className="w-5 shrink-0 text-right text-muted-foreground">{index + 1}.</span>
              <div className="space-y-0.5">
                {item.lessonId ? (
                  <Link href={`/lessons/${encodeURIComponent(item.lessonId)}`} className="text-xs font-medium text-primary hover:underline">
                    {item.lessonTitle ?? item.lessonId}
                  </Link>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">Whole unit</span>
                )}
                <p className="whitespace-pre-line text-foreground">{item.action}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
