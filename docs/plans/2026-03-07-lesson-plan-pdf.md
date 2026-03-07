# Lesson Plan PDF Download — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow teachers to download a lesson plan as a PDF from the unit page lesson list and the lesson detail page header.

**Architecture:** A Next.js Route Handler at `GET /api/lesson-plan/[lessonId]` fetches lesson data server-side (reusing existing server actions), builds the PDF with `@react-pdf/renderer`, and streams it back as `application/pdf`. A reusable `<LessonPlanDownloadButton>` client component renders a plain anchor tag that triggers the download.

**Tech Stack:** `@react-pdf/renderer` (new), `qrcode` (new), existing server actions (`readLessonDetailBootstrapAction`, `readLessonReferenceDataAction`, `readAllLearningObjectivesAction`), `getAuthenticatedProfile` from `src/lib/auth.ts`.

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via pnpm)

**Step 1: Install packages**

```bash
cd /Users/leroysalih/nodejs/planner-004
pnpm add @react-pdf/renderer qrcode
pnpm add -D @types/qrcode
```

**Step 2: Verify install**

```bash
node -e "require('@react-pdf/renderer'); console.log('ok')"
node -e "require('qrcode'); console.log('ok')"
```

Expected: `ok` printed for both.

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @react-pdf/renderer and qrcode dependencies"
```

---

## Task 2: Create image + QR code fetch helpers

**Files:**
- Create: `src/lib/pdf-helpers.ts`

**Step 1: Create the file**

```typescript
// src/lib/pdf-helpers.ts
import QRCode from "qrcode"

/**
 * Fetch a URL (relative or absolute) and return it as a base64 data URI.
 * Returns null on any failure so the PDF can degrade gracefully.
 */
export async function fetchAsDataUri(url: string, baseUrl: string): Promise<string | null> {
  try {
    const fullUrl = url.startsWith("/") ? `${baseUrl}${url}` : url
    const res = await fetch(fullUrl)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const contentType = res.headers.get("content-type") || "image/jpeg"
    const base64 = Buffer.from(buffer).toString("base64")
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

/**
 * Generate a QR code for a URL as a PNG data URI.
 * Returns null if the URL is invalid or generation fails.
 */
export async function generateQrDataUri(url: string): Promise<string | null> {
  try {
    new URL(url) // validate URL
    return await QRCode.toDataURL(url, { width: 150, margin: 1 })
  } catch {
    return null
  }
}

/**
 * Extract the YouTube video ID from a YouTube URL.
 * Returns null if not a YouTube URL or ID cannot be parsed.
 */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace("www.", "")
    if (host === "youtube.com" || host === "m.youtube.com") {
      return parsed.searchParams.get("v")
    }
    if (host === "youtu.be") {
      return parsed.pathname.slice(1) || null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get base URL from a Request object for resolving relative image paths.
 */
export function getBaseUrl(request: Request): string {
  const host = request.headers.get("host") || "localhost:3000"
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"
  return `${proto}://${host}`
}
```

**Step 2: Commit**

```bash
git add src/lib/pdf-helpers.ts
git commit -m "feat: add PDF helper utilities for image fetch and QR generation"
```

---

## Task 3: Create the PDF document component

**Files:**
- Create: `src/components/pdf/lesson-plan-document.tsx`

This file uses ONLY `@react-pdf/renderer` primitives — no DOM, no Tailwind, no Radix. It receives all data pre-fetched (images as data URIs, QR codes as data URIs).

**Step 1: Define the data types and create the component**

```typescript
// src/components/pdf/lesson-plan-document.tsx
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

// ---- Types ----------------------------------------------------------------

export interface PdfSuccessCriterion {
  id: string
  description: string
}

export interface PdfLearningObjective {
  id: string
  title: string
  criteria: PdfSuccessCriterion[]
}

export interface PdfActivityBase {
  id: string
  title: string
  orderBy: number | null
}

export interface PdfMcqActivity extends PdfActivityBase {
  kind: "mcq"
  question: string
  options: { id: string; text: string }[]
  correctOptionId: string
  imageDataUri: string | null
}

export interface PdfShortTextActivity extends PdfActivityBase {
  kind: "short-text"
  question: string
  modelAnswer: string
}

export interface PdfImageActivity extends PdfActivityBase {
  kind: "image"
  imageDataUri: string | null
}

export interface PdfVideoActivity extends PdfActivityBase {
  kind: "video"
  videoUrl: string
  thumbnailDataUri: string | null
  qrDataUri: string | null
}

export interface PdfTextActivity extends PdfActivityBase {
  kind: "text"
  content: string
}

export interface PdfOtherActivity extends PdfActivityBase {
  kind: "other"
}

export type PdfActivity =
  | PdfMcqActivity
  | PdfShortTextActivity
  | PdfImageActivity
  | PdfVideoActivity
  | PdfTextActivity
  | PdfOtherActivity

export interface LessonPlanDocumentProps {
  unitTitle: string
  lessonTitle: string
  generatedAt: string // formatted date string e.g. "07-03-2026"
  learningObjectives: PdfLearningObjective[]
  activities: PdfActivity[]
}

// ---- Styles ---------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 42,
    paddingRight: 42,
  },
  // Header
  header: {
    backgroundColor: "#1e293b",
    borderRadius: 6,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  unitLabel: {
    fontSize: 8,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  unitTitle: {
    fontSize: 11,
    color: "#cbd5e1",
    fontFamily: "Helvetica",
  },
  lessonTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    marginTop: 8,
  },
  generatedDate: {
    fontSize: 8,
    color: "#64748b",
    textAlign: "right",
    marginTop: 4,
  },
  // Section
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 10,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  section: {
    marginBottom: 24,
  },
  // LO / SC
  loBlock: {
    marginBottom: 12,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#cbd5e1",
  },
  loTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 4,
  },
  scItem: {
    flexDirection: "row",
    marginBottom: 3,
    paddingLeft: 8,
  },
  scBullet: {
    fontSize: 9,
    color: "#64748b",
    marginRight: 4,
  },
  scText: {
    fontSize: 9,
    color: "#475569",
    flex: 1,
  },
  // Activities
  activityBlock: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  activityTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 6,
  },
  activityTypeBadge: {
    fontSize: 7,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  questionText: {
    fontSize: 10,
    color: "#1e293b",
    marginBottom: 8,
    lineHeight: 1.5,
  },
  // MCQ options
  optionRow: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "flex-start",
  },
  optionMarker: {
    fontSize: 9,
    width: 18,
    color: "#64748b",
    flexShrink: 0,
  },
  optionMarkerCorrect: {
    fontSize: 9,
    width: 18,
    color: "#16a34a",
    fontFamily: "Helvetica-Bold",
    flexShrink: 0,
  },
  optionText: {
    fontSize: 9,
    color: "#374151",
    flex: 1,
  },
  optionTextCorrect: {
    fontSize: 9,
    color: "#16a34a",
    fontFamily: "Helvetica-Bold",
    flex: 1,
  },
  // Model answer box
  modelAnswerLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
  },
  modelAnswerBox: {
    backgroundColor: "#f1f5f9",
    borderRadius: 3,
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#94a3b8",
  },
  modelAnswerText: {
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.5,
  },
  // Images
  activityImage: {
    maxWidth: 300,
    maxHeight: 200,
    objectFit: "contain",
    marginTop: 6,
    borderRadius: 3,
  },
  // Video row
  videoRow: {
    flexDirection: "row",
    gap: 16,
    alignItems: "flex-start",
    marginTop: 4,
  },
  videoThumbnail: {
    width: 160,
    height: 90,
    objectFit: "cover",
    borderRadius: 4,
  },
  qrBlock: {
    alignItems: "center",
  },
  qrImage: {
    width: 80,
    height: 80,
  },
  qrLabel: {
    fontSize: 7,
    color: "#94a3b8",
    marginTop: 3,
    textAlign: "center",
  },
  plainText: {
    fontSize: 9,
    color: "#374151",
    lineHeight: 1.6,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 42,
    right: 42,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: "#94a3b8",
  },
})

// ---- Sub-components -------------------------------------------------------

function McqActivity({ activity }: { activity: PdfMcqActivity }) {
  return (
    <View style={styles.activityBlock}>
      <Text style={styles.activityTypeBadge}>Multiple Choice</Text>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Text style={styles.questionText}>{activity.question}</Text>
      {activity.imageDataUri ? (
        <Image src={activity.imageDataUri} style={styles.activityImage} />
      ) : null}
      <View>
        {activity.options.map((opt) => {
          const isCorrect = opt.id === activity.correctOptionId
          return (
            <View key={opt.id} style={styles.optionRow}>
              <Text style={isCorrect ? styles.optionMarkerCorrect : styles.optionMarker}>
                {isCorrect ? "✓" : "○"}
              </Text>
              <Text style={isCorrect ? styles.optionTextCorrect : styles.optionText}>
                {opt.text}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function ShortTextActivity({ activity }: { activity: PdfShortTextActivity }) {
  return (
    <View style={styles.activityBlock}>
      <Text style={styles.activityTypeBadge}>Short Answer</Text>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Text style={styles.questionText}>{activity.question}</Text>
      <Text style={styles.modelAnswerLabel}>Model Answer</Text>
      <View style={styles.modelAnswerBox}>
        <Text style={styles.modelAnswerText}>{activity.modelAnswer}</Text>
      </View>
    </View>
  )
}

function ImageActivity({ activity }: { activity: PdfImageActivity }) {
  if (!activity.imageDataUri) return null
  return (
    <View style={styles.activityBlock}>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Image src={activity.imageDataUri} style={styles.activityImage} />
    </View>
  )
}

function VideoActivity({ activity }: { activity: PdfVideoActivity }) {
  return (
    <View style={styles.activityBlock}>
      <Text style={styles.activityTypeBadge}>Video</Text>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <View style={styles.videoRow}>
        {activity.thumbnailDataUri ? (
          <Image src={activity.thumbnailDataUri} style={styles.videoThumbnail} />
        ) : null}
        {activity.qrDataUri ? (
          <View style={styles.qrBlock}>
            <Image src={activity.qrDataUri} style={styles.qrImage} />
            <Text style={styles.qrLabel}>Scan to watch</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

function TextActivity({ activity }: { activity: PdfTextActivity }) {
  return (
    <View style={styles.activityBlock}>
      <Text style={styles.activityTitle}>{activity.title}</Text>
      <Text style={styles.plainText}>{activity.content}</Text>
    </View>
  )
}

function OtherActivity({ activity }: { activity: PdfOtherActivity }) {
  return (
    <View style={styles.activityBlock}>
      <Text style={styles.activityTitle}>{activity.title}</Text>
    </View>
  )
}

// ---- Document -------------------------------------------------------------

export function LessonPlanDocument({
  unitTitle,
  lessonTitle,
  generatedAt,
  learningObjectives,
  activities,
}: LessonPlanDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.unitLabel}>Unit</Text>
              <Text style={styles.unitTitle}>{unitTitle}</Text>
            </View>
            <Text style={styles.generatedDate}>{generatedAt}</Text>
          </View>
          <Text style={styles.lessonTitle}>{lessonTitle}</Text>
        </View>

        {/* Learning Objectives */}
        {learningObjectives.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Learning Objectives</Text>
            {learningObjectives.map((lo, index) => (
              <View key={lo.id} style={styles.loBlock}>
                <Text style={styles.loTitle}>
                  {index + 1}. {lo.title}
                </Text>
                {lo.criteria.map((sc) => (
                  <View key={sc.id} style={styles.scItem}>
                    <Text style={styles.scBullet}>•</Text>
                    <Text style={styles.scText}>{sc.description}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {/* Activities */}
        {activities.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Activities</Text>
            {activities.map((activity) => {
              switch (activity.kind) {
                case "mcq":
                  return <McqActivity key={activity.id} activity={activity} />
                case "short-text":
                  return <ShortTextActivity key={activity.id} activity={activity} />
                case "image":
                  return <ImageActivity key={activity.id} activity={activity} />
                case "video":
                  return <VideoActivity key={activity.id} activity={activity} />
                case "text":
                  return <TextActivity key={activity.id} activity={activity} />
                case "other":
                  return <OtherActivity key={activity.id} activity={activity} />
              }
            })}
          </View>
        ) : null}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{lessonTitle}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/pdf/lesson-plan-document.tsx
git commit -m "feat: add LessonPlanDocument react-pdf component"
```

---

## Task 4: Create the Route Handler

**Files:**
- Create: `src/app/api/lesson-plan/[lessonId]/route.ts`

This handler fetches all data, resolves images/QR codes, then streams the PDF.

**Step 1: Create the handler**

```typescript
// src/app/api/lesson-plan/[lessonId]/route.ts
import { renderToBuffer } from "@react-pdf/renderer"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import {
  readAllLearningObjectivesAction,
  readLessonDetailBootstrapAction,
  readLessonReferenceDataAction,
} from "@/lib/server-updates"
import {
  extractYouTubeVideoId,
  fetchAsDataUri,
  generateQrDataUri,
  getBaseUrl,
} from "@/lib/pdf-helpers"
import { LessonPlanDocument } from "@/components/pdf/lesson-plan-document"
import type {
  PdfActivity,
  PdfLearningObjective,
} from "@/components/pdf/lesson-plan-document"
import {
  McqActivityBodySchema,
  ShortTextActivityBodySchema,
} from "@/types"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  // Auth
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { lessonId } = await params
  const baseUrl = getBaseUrl(request)

  // Fetch lesson data
  const lessonResult = await readLessonDetailBootstrapAction(lessonId, {
    routeTag: "/api/lesson-plan/[lessonId]",
    authEndTime: null,
  })
  if (lessonResult.error || !lessonResult.data?.lesson) {
    return new Response("Lesson not found", { status: 404 })
  }

  const { lesson, unit, lessonActivities = [] } = lessonResult.data

  // Fetch curricula to filter LOs
  const referenceResult = await readLessonReferenceDataAction(lessonId, {
    routeTag: "/api/lesson-plan/[lessonId]",
    authEndTime: null,
  })
  const curricula = referenceResult.data?.curricula ?? []
  const curriculumIds = curricula
    .map((c) => c.curriculum_id)
    .filter((id): id is string => Boolean(id))

  // Fetch learning objectives
  const loResult = await readAllLearningObjectivesAction({
    routeTag: "/api/lesson-plan/[lessonId]",
    authEndTime: null,
    curriculumIds,
    unitId: lesson.unit_id,
  })
  const allLos = loResult.data ?? []

  // Filter LOs to those referenced by lesson_success_criteria
  const lessonScIds = new Set(
    (lesson.lesson_success_criteria ?? []).map((sc) => sc.success_criteria_id),
  )

  // Build PDF LO data — include only LOs that have at least one linked SC
  const pdfLos: PdfLearningObjective[] = []
  for (const lo of allLos) {
    const linkedCriteria = (lo.success_criteria ?? []).filter((sc) =>
      lessonScIds.has(sc.success_criteria_id),
    )
    if (linkedCriteria.length === 0) continue
    pdfLos.push({
      id: lo.learning_objective_id,
      title: lo.title ?? "Untitled objective",
      criteria: linkedCriteria.map((sc) => ({
        id: sc.success_criteria_id,
        description: sc.description?.trim() || sc.title || "Success criterion",
      })),
    })
  }

  // Build PDF activity data — fetch images concurrently
  const activeActivities = lessonActivities
    .filter((a) => a.active !== false)
    .sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0))

  const pdfActivities: PdfActivity[] = await Promise.all(
    activeActivities.map(async (activity): Promise<PdfActivity> => {
      const base: { id: string; title: string; orderBy: number | null } = {
        id: activity.activity_id,
        title: activity.title || "Untitled activity",
        orderBy: activity.order_by ?? null,
      }
      const body = activity.body_data as Record<string, unknown> | null

      switch (activity.type) {
        case "multiple-choice-question": {
          const parsed = McqActivityBodySchema.safeParse(body)
          if (!parsed.success) return { ...base, kind: "other" }
          const { question, options, correctOptionId, imageFile, imageUrl } = parsed.data
          const rawImgUrl = imageFile ?? imageUrl ?? null
          const imageDataUri = rawImgUrl
            ? await fetchAsDataUri(rawImgUrl, baseUrl).catch(() => null)
            : null
          return {
            ...base,
            kind: "mcq",
            question,
            options: options.map((o) => ({ id: o.id, text: o.text })),
            correctOptionId,
            imageDataUri,
          }
        }

        case "short-text-question": {
          const parsed = ShortTextActivityBodySchema.safeParse(body)
          if (!parsed.success) return { ...base, kind: "other" }
          return {
            ...base,
            kind: "short-text",
            question: parsed.data.question,
            modelAnswer: parsed.data.modelAnswer,
          }
        }

        case "display-image": {
          const rawUrl = (body?.imageFile as string | undefined) ?? (body?.imageUrl as string | undefined) ?? null
          const imageDataUri = rawUrl
            ? await fetchAsDataUri(rawUrl, baseUrl).catch(() => null)
            : null
          return { ...base, kind: "image", imageDataUri }
        }

        case "show-video": {
          const videoUrl = (body?.url as string | undefined) ?? ""
          if (!videoUrl) return { ...base, kind: "other" }

          const videoId = extractYouTubeVideoId(videoUrl)
          const thumbnailUrl = videoId
            ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
            : null

          const [thumbnailDataUri, qrDataUri] = await Promise.all([
            thumbnailUrl ? fetchAsDataUri(thumbnailUrl, baseUrl).catch(() => null) : Promise.resolve(null),
            generateQrDataUri(videoUrl).catch(() => null),
          ])

          return { ...base, kind: "video", videoUrl, thumbnailDataUri, qrDataUri }
        }

        case "text": {
          const content = (body?.content as string | undefined) ?? ""
          return { ...base, kind: "text", content }
        }

        default:
          return { ...base, kind: "other" }
      }
    }),
  )

  // Format date as DD-MM-YYYY
  const now = new Date()
  const generatedAt = [
    String(now.getDate()).padStart(2, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    now.getFullYear(),
  ].join("-")

  // Render PDF
  const buffer = await renderToBuffer(
    LessonPlanDocument({
      unitTitle: unit?.title ?? "Unknown Unit",
      lessonTitle: lesson.title ?? "Untitled Lesson",
      generatedAt,
      learningObjectives: pdfLos,
      activities: pdfActivities,
    }),
  )

  const safeTitle = (lesson.title ?? "lesson-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeTitle}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
```

**Step 2: Smoke test manually**

Start the dev server (`pnpm dev`) and visit `/api/lesson-plan/<a-real-lessonId>` while signed in as a teacher. Browser should download a PDF. If signed out it should return 401.

**Step 3: Commit**

```bash
git add src/app/api/lesson-plan/
git commit -m "feat: add lesson plan PDF route handler"
```

---

## Task 5: Create the download button component

**Files:**
- Create: `src/components/pdf/lesson-plan-download-button.tsx`

**Step 1: Create the component**

```typescript
// src/components/pdf/lesson-plan-download-button.tsx
"use client"

import { FileDown } from "lucide-react"

import { Button } from "@/components/ui/button"

interface LessonPlanDownloadButtonProps {
  lessonId: string
  variant?: "default" | "secondary" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
}

export function LessonPlanDownloadButton({
  lessonId,
  variant = "outline",
  size = "sm",
  className,
}: LessonPlanDownloadButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={`/api/lesson-plan/${encodeURIComponent(lessonId)}`} download>
        <FileDown className="mr-2 h-4 w-4" />
        Download Plan
      </a>
    </Button>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/pdf/lesson-plan-download-button.tsx
git commit -m "feat: add LessonPlanDownloadButton component"
```

---

## Task 6: Add download button to unit lesson list

**Files:**
- Modify: `src/components/units/lessons-panel.tsx`

**Step 1: Add the import at the top of the file**

After the existing imports add:

```typescript
import { LessonPlanDownloadButton } from "@/components/pdf/lesson-plan-download-button"
```

**Step 2: Add the button alongside the existing "Show activities" button**

Find this block (around line 330):

```tsx
<>
  <Button asChild size="sm" variant="secondary" className="whitespace-nowrap">
    <Link
      href={`/lessons/${encodeURIComponent(lesson.lesson_id)}/activities`}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      Show activities
    </Link>
  </Button>
</>
```

Replace with:

```tsx
<>
  <Button asChild size="sm" variant="secondary" className="whitespace-nowrap">
    <Link
      href={`/lessons/${encodeURIComponent(lesson.lesson_id)}/activities`}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      Show activities
    </Link>
  </Button>
  <div onClick={(e) => e.stopPropagation()}>
    <LessonPlanDownloadButton lessonId={lesson.lesson_id} />
  </div>
</>
```

**Step 3: Commit**

```bash
git add src/components/units/lessons-panel.tsx
git commit -m "feat: add lesson plan download button to unit lesson list"
```

---

## Task 7: Add download button to lesson detail header

**Files:**
- Modify: `src/components/lessons/lesson-detail-client.tsx`

**Step 1: Add the import**

After the existing imports add:

```typescript
import { LessonPlanDownloadButton } from "@/components/pdf/lesson-plan-download-button"
```

**Step 2: Add the button in the header action area**

Find this block (around line 414):

```tsx
<div className="flex items-center gap-2">
  <LessonShareButton
    lessonId={currentLesson.lesson_id}
    lessonTitle={currentLesson.title}
  />
  <Button
    size="sm"
    variant="secondary"
    className="bg-white/10 text-white hover:bg-white/20"
    onClick={() => setIsHeaderSidebarOpen(true)}
  >
    Edit lesson details
  </Button>
</div>
```

Replace with:

```tsx
<div className="flex items-center gap-2">
  <LessonShareButton
    lessonId={currentLesson.lesson_id}
    lessonTitle={currentLesson.title}
  />
  <LessonPlanDownloadButton
    lessonId={currentLesson.lesson_id}
    variant="secondary"
    className="bg-white/10 text-white hover:bg-white/20"
  />
  <Button
    size="sm"
    variant="secondary"
    className="bg-white/10 text-white hover:bg-white/20"
    onClick={() => setIsHeaderSidebarOpen(true)}
  >
    Edit lesson details
  </Button>
</div>
```

**Step 3: Commit**

```bash
git add src/components/lessons/lesson-detail-client.tsx
git commit -m "feat: add lesson plan download button to lesson detail header"
```

---

## Task 8: Run lint and verify build

**Step 1: Run lint**

```bash
pnpm lint
```

Expected: no errors.

**Step 2: Run build**

```bash
pnpm build
```

Expected: build completes without type errors or compilation failures.

**Step 3: Manual smoke test**

1. Sign in as a teacher
2. Navigate to a unit page — each lesson row should show a "Download Plan" button
3. Click it — browser downloads a PDF
4. Open the PDF and verify: unit title, lesson title, LOs + SCs, activities with correct content by type, YouTube thumbnail + QR code for video activities
5. Navigate to a lesson detail page — "Download Plan" button appears in the header
6. Click it — browser downloads a PDF

**Step 4: Final commit if any lint fixes were needed**

```bash
git add -p
git commit -m "fix: resolve lint issues from lesson plan PDF feature"
```
