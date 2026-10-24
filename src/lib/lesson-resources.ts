// Picks a lesson's resources out of its activities and links, so the pupil
// lesson page can show them as cards at the top instead of further down: the
// three headline ones (slides, knowledge organiser, revision sheet), then the
// lesson's other links.
// Every matching rule lives here; adjust them here.

export type LessonResourceKind = "slides" | "knowledge-organiser" | "revision-sheet" | "link"

export type LessonResource = {
  /** Unique per card: the kind for the headline three, the URL for a link. */
  key: string
  kind: LessonResourceKind
  label: string
  /** File name, or "Opens in a new tab" for a web page. */
  detail: string
  href: string
  /** Download a file, or open a web page in a new tab. */
  opens: "download" | "new-tab"
  /** Badge for a file ("PPTX", "PDF"); null for a web page. */
  fileType: string | null
  /** The activity this card replaces, so the page does not repeat it. */
  activityId: string | null
}

const LABELS: Record<Exclude<LessonResourceKind, "link">, string> = {
  slides: "Lesson slides",
  "knowledge-organiser": "Knowledge organiser",
  "revision-sheet": "Revision sheet",
}

type HeadlineKind = keyof typeof LABELS

// Titles, case-insensitive. Checked in this order, so "Revision slides" is a
// revision sheet rather than the lesson's slides.
const TITLE_RULES: Array<{ kind: HeadlineKind; pattern: RegExp }> = [
  { kind: "revision-sheet", pattern: /\brevision\b/i },
  { kind: "knowledge-organiser", pattern: /\bknowledge\s*org|\bk\.?o\.?\b/i },
  { kind: "slides", pattern: /\bslides?\b|\bpresentation\b|\bdeck\b/i },
]

const SLIDE_FILE = /\.(pptx?|key|pdf)$/i
const GOOGLE_SLIDES = /docs\.google\.com\/presentation\//i

// Lesson files are the teacher's private store: the pupil page has only ever
// listed their names. Set true to offer a slides file found there as a card.
const LINK_PRIVATE_LESSON_FILES = false

// Activity types that can be a resource card. Anything else stays an activity.
const RESOURCE_ACTIVITY_TYPES = new Set(["file-download", "display-webpage"])

export type ResourceActivityInput = {
  activityId: string
  type: string
  title: string
  /** For a file-download: its files with download URLs. */
  files: Array<{ name: string; url: string | null | undefined }>
  /** A link the activity holds (file-download url, webpage url). */
  linkUrl: string | null
  /** A display-webpage's own HTML page, if it has one. */
  webpageHref: string | null
}

function kindForTitle(title: string): HeadlineKind | null {
  return TITLE_RULES.find((rule) => rule.pattern.test(title))?.kind ?? null
}

function fileType(name: string): string | null {
  const extension = name.split(".").pop()?.toLowerCase()
  if (!extension || extension === name.toLowerCase()) return null
  return extension === "ppt" || extension === "pptx" || extension === "key" ? "PPTX" : extension.toUpperCase()
}

function fromActivity(activity: ResourceActivityInput): LessonResource | null {
  if (!RESOURCE_ACTIVITY_TYPES.has(activity.type)) return null
  let kind = kindForTitle(activity.title)

  if (activity.type === "file-download") {
    // One file only: a card is one link, and several files read better as the activity.
    const linked = activity.files.filter((file) => file.url)
    const file = linked.length === 1 ? linked[0] : null
    // An untitled-looking download of a deck is still the slides.
    if (!kind && file && /\.(pptx?|key)$/i.test(file.name)) kind = "slides"
    if (!kind) return null
    if (file?.url) {
      return {
        key: kind,
        kind,
        label: LABELS[kind],
        detail: file.name,
        href: file.url,
        opens: "download",
        fileType: fileType(file.name),
        activityId: activity.activityId,
      }
    }
    if (activity.files.length === 0 && activity.linkUrl) {
      return {
        key: kind,
        kind,
        label: LABELS[kind],
        detail: "Opens in a new tab",
        href: activity.linkUrl,
        opens: "new-tab",
        fileType: null,
        activityId: activity.activityId,
      }
    }
    return null
  }

  // display-webpage
  if (!kind && activity.linkUrl && GOOGLE_SLIDES.test(activity.linkUrl)) kind = "slides"
  const href = activity.webpageHref ?? activity.linkUrl
  if (!kind || !href) return null
  return {
    key: kind,
    kind,
    label: LABELS[kind],
    detail: "Opens in a new tab",
    href,
    opens: "new-tab",
    fileType: null,
    activityId: activity.activityId,
  }
}

/**
 * The lesson's resources, at most one of each kind, in the order slides,
 * knowledge organiser, revision sheet. The first match of a kind wins, in
 * activity order, then lesson links, then (if enabled) lesson files.
 */
export function findLessonResources(input: {
  lessonId: string
  activities: ResourceActivityInput[]
  links: Array<{ url: string; description: string | null }>
  lessonFiles: Array<{ name: string }>
}): LessonResource[] {
  const found = new Map<HeadlineKind, LessonResource>()
  const add = (resource: LessonResource | null) => {
    if (resource && resource.kind !== "link" && !found.has(resource.kind)) found.set(resource.kind, resource)
  }

  input.activities.forEach((activity) => add(fromActivity(activity)))

  // A link titled like slides, a KO or a revision sheet is that card; every
  // other lesson link is a link card of its own.
  const otherLinks: LessonResource[] = []
  for (const link of input.links) {
    const kind = kindForTitle(link.description ?? "") ?? (GOOGLE_SLIDES.test(link.url) ? "slides" : null)
    if (kind && !found.has(kind)) {
      add({
        key: kind,
        kind,
        label: LABELS[kind],
        detail: "Opens in a new tab",
        href: link.url,
        opens: "new-tab",
        fileType: null,
        activityId: null,
      })
      continue
    }
    otherLinks.push({
      key: `link:${link.url}`,
      kind: "link",
      label: link.description?.trim() || hostname(link.url),
      detail: link.description?.trim() ? hostname(link.url) : "Opens in a new tab",
      href: link.url,
      opens: "new-tab",
      fileType: null,
      activityId: null,
    })
  }

  if (LINK_PRIVATE_LESSON_FILES) {
    for (const file of input.lessonFiles) {
      const kind = kindForTitle(file.name) ?? (/\.(pptx?|key)$/i.test(file.name) ? "slides" : null)
      if (!kind || !SLIDE_FILE.test(file.name)) continue
      add({
        key: kind,
        kind,
        label: LABELS[kind],
        detail: file.name,
        href: `/api/files/${["lessons", input.lessonId, file.name].map(encodeURIComponent).join("/")}`,
        opens: "download",
        fileType: fileType(file.name),
        activityId: null,
      })
    }
  }

  const order: HeadlineKind[] = ["slides", "knowledge-organiser", "revision-sheet"]
  return [...order.flatMap((kind) => (found.has(kind) ? [found.get(kind)!] : [])), ...otherLinks]
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
