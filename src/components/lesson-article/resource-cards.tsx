import type { LessonResource } from "@/lib/lesson-resources"
import { BookIcon, DocumentIcon, LinkIcon, LockIcon } from "./icons"

/** The lesson's slides, knowledge organiser, revision sheet and links, as link cards. */
export function ResourceCards({ resources, canDownload }: { resources: LessonResource[]; canDownload: boolean }) {
  if (resources.length === 0) return null
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Lesson resources">
      {resources.map((resource) => {
        const blocked = resource.opens === "download" && !canDownload
        const body = (
          <>
            <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-la-green-pale text-la-green">
              {resource.fileType ? (
                <span className="text-[11px] font-bold tracking-wide">{resource.fileType}</span>
              ) : resource.kind === "knowledge-organiser" ? (
                <BookIcon />
              ) : resource.kind === "link" ? (
                <LinkIcon />
              ) : (
                <DocumentIcon />
              )}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-la-ink">{resource.label}</span>
              <span className="block truncate text-sm text-la-muted">
                {blocked ? "Downloads are off while this lesson is locked" : resource.detail}
              </span>
            </span>
            {blocked ? <LockIcon className="ml-auto h-4 w-4 flex-none text-la-muted" /> : null}
          </>
        )
        const cardClass =
          "flex min-h-[72px] items-center gap-3 rounded-xl border border-la-border bg-la-card p-4"
        return (
          <li key={resource.key}>
            {blocked ? (
              <div className={cardClass}>{body}</div>
            ) : (
              <a
                href={resource.href}
                {...(resource.opens === "download"
                  ? { download: resource.detail }
                  : { target: "_blank", rel: "noopener noreferrer" })}
                className={`${cardClass} transition-colors hover:border-la-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-la-green`}
              >
                {body}
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
