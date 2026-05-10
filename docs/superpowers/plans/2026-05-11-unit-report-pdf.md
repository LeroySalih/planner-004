# Unit Report PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a teacher-only "Generate Report" button to the Unit detail page that downloads a Cornell Notes-styled PDF summarising the unit description, learning objectives/success criteria, and lessons.

**Architecture:** Three new files following the identical pattern as the existing `lesson-plan` PDF (API route → React PDF document → client download button), plus a new server action for file-download activities and a small modification to `unit-detail-view.tsx`. The PDF is rendered server-side via `@react-pdf/renderer` and streamed as a download.

**Tech Stack:** Next.js 15 App Router, `@react-pdf/renderer` v4.3.2, TypeScript, PostgreSQL via `pg`, local file storage via `createLocalStorageClient`.

---

## File Map

| Action | Path |
|---|---|
| Create | `src/lib/server-actions/lessons.ts` — add `readFileDownloadActivitiesByUnitAction` |
| Modify | `src/lib/server-updates.ts` — export new action |
| Create | `src/components/pdf/unit-report-download-button.tsx` |
| Modify | `src/components/units/unit-detail-view.tsx` — add button |
| Create | `src/components/pdf/unit-report-document.tsx` |
| Create | `src/app/api/unit-report/[unitId]/route.tsx` |

---

## Task 1: Server action — file-download activities by unit

**Files:**
- Modify: `src/lib/server-actions/lessons.ts` (append at end of file)
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Append the new action to `src/lib/server-actions/lessons.ts`**

Add these imports at the top of the file (after the existing imports — check if `createLocalStorageClient` is already imported; if not, add it):

```typescript
import { createLocalStorageClient } from "@/lib/storage/local-storage"
```

Then append to the bottom of the file:

```typescript
export async function readFileDownloadActivitiesByUnitAction(
  unitId: string,
): Promise<{ lessonId: string; fileName: string }[]> {
  const { rows } = await query(
    `
    SELECT a.activity_id, a.lesson_id
    FROM activities a
    JOIN lessons l ON l.lesson_id = a.lesson_id
    WHERE l.unit_id = $1 AND l.active = true AND a.type = 'file-download'
    `,
    [unitId],
  )

  const storage = createLocalStorageClient("lessons")
  const results: { lessonId: string; fileName: string }[] = []

  await Promise.all(
    rows.map(async (row: { activity_id: string; lesson_id: string }) => {
      const dir = `${row.lesson_id}/${row.activity_id}`
      const { data } = await storage.list(dir, { limit: 100 })
      for (const file of data ?? []) {
        results.push({ lessonId: row.lesson_id, fileName: file.name })
      }
    }),
  )

  return results
}
```

- [ ] **Step 2: Export from `src/lib/server-updates.ts`**

Find the existing lessons export block (search for `readLessonsByUnitAction` in server-updates.ts) and add the new export to the same block:

```typescript
  readFileDownloadActivitiesByUnitAction,
```

- [ ] **Step 3: Verify the build compiles**

```bash
cd /Users/leroysalih/nodejs/planner-004/.claude/worktrees/xenodochial-noyce-05b546
pnpm build 2>&1 | tail -20
```

Expected: build succeeds (or only pre-existing errors, none from the new action).

- [ ] **Step 4: Commit**

```bash
git add src/lib/server-actions/lessons.ts src/lib/server-updates.ts
git commit -m "feat(unit-report): add readFileDownloadActivitiesByUnitAction"
```

---

## Task 2: Download button component

**Files:**
- Create: `src/components/pdf/unit-report-download-button.tsx`

- [ ] **Step 1: Create the file**

```typescript
// src/components/pdf/unit-report-download-button.tsx
"use client"

import { FileDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface UnitReportDownloadButtonProps {
  unitId: string
  variant?: "default" | "secondary" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
}

export function UnitReportDownloadButton({
  unitId,
  variant = "outline",
  size = "sm",
  className,
}: UnitReportDownloadButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={`/api/unit-report/${encodeURIComponent(unitId)}`} download>
        <FileDown className="mr-2 h-4 w-4" />
        Generate Report
      </a>
    </Button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pdf/unit-report-download-button.tsx
git commit -m "feat(unit-report): add UnitReportDownloadButton"
```

---

## Task 3: Add button to unit detail view

**Files:**
- Modify: `src/components/units/unit-detail-view.tsx`

- [ ] **Step 1: Read the top of `unit-detail-view.tsx` to find the import section and the component's return JSX header area**

Look for where the component renders its title/header. The component's outer `div` or first visible element is where the button should be added alongside any existing header content.

- [ ] **Step 2: Add the import at the top of `unit-detail-view.tsx`**

After the existing component imports, add:

```typescript
import { UnitReportDownloadButton } from "@/components/pdf/unit-report-download-button"
```

- [ ] **Step 3: Add the button in the unit header area**

Find the section of the JSX that renders the unit title or top-level header area. Add the button adjacent to it. For example, if there is a header row:

```tsx
<div className="flex items-center justify-between gap-4">
  {/* existing unit title / header content */}
  <UnitReportDownloadButton unitId={currentUnit.unit_id} />
</div>
```

Use `currentUnit.unit_id` (the local state value) not the `unit` prop directly, since `currentUnit` tracks SSE updates.

- [ ] **Step 4: Verify the page renders without error**

```bash
pnpm build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no new TypeScript or build errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/units/unit-detail-view.tsx
git commit -m "feat(unit-report): add Generate Report button to unit detail view"
```

---

## Task 4: PDF document component

**Files:**
- Create: `src/components/pdf/unit-report-document.tsx`

This is the largest task. The component uses `@react-pdf/renderer` to produce a Cornell Notes-styled PDF.

- [ ] **Step 1: Create `src/components/pdf/unit-report-document.tsx`**

```typescript
// src/components/pdf/unit-report-document.tsx
import { Document, Page, StyleSheet, Text, View, Link } from "@react-pdf/renderer"

// ---- Types ----------------------------------------------------------------

export interface UnitReportSc {
  success_criteria_id: string
  description: string
  level: number | null
  order_index: number | null
}

export interface UnitReportLo {
  learning_objective_id: string
  title: string
  order_index: number | null
  spec_ref: string | null
  assessment_objective_id: string | null
  assessment_objective_code: string | null
  assessment_objective_title: string | null
  assessment_objective_order_index: number | null
  success_criteria: UnitReportSc[]
}

export interface UnitReportLesson {
  lesson_id: string
  title: string
  order_by: number | null
  lesson_objectives: {
    learning_objective_id: string
    title: string
    order_by: number | null
    spec_ref?: string | null
  }[]
  lesson_success_criteria: UnitReportSc[]
  lesson_links: { url: string; description: string | null }[]
  file_names: string[]
}

export interface UnitReportDocumentProps {
  unitTitle: string
  subject: string
  year: number | null
  description: string | null
  learningObjectives: UnitReportLo[]
  lessons: UnitReportLesson[]
}

// ---- Styles ---------------------------------------------------------------

const NAVY = "#1a2744"
const LESSON_NAVY = "#2d3f6b"
const BORDER = "#cccccc"

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#222222",
    backgroundColor: "#ffffff",
    paddingTop: 0,
    paddingBottom: 36,
    paddingLeft: 0,
    paddingRight: 0,
  },
  header: {
    backgroundColor: NAVY,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  headerTitleBlock: {
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#c0c8d8",
    textAlign: "center",
    marginTop: 2,
  },
  subtitle: {
    textAlign: "center",
    fontSize: 10,
    color: "#888888",
    paddingVertical: 6,
  },
  infoBar: {
    backgroundColor: NAVY,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginHorizontal: 12,
  },
  infoBarText: {
    fontSize: 9,
    color: "#ffffff",
  },
  sectionHeader: {
    backgroundColor: NAVY,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 10,
    marginHorizontal: 12,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  descBox: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 10,
    lineHeight: 1.5,
    color: "#444444",
  },
  table: {
    marginHorizontal: 12,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER,
  },
  tableRowFirst: {
    borderTopWidth: 1,
  },
  colLeft: {
    width: "30%",
    padding: 6,
    borderRightWidth: 2,
    borderRightColor: NAVY,
  },
  colRight: {
    width: "70%",
    padding: 6,
  },
  colFull: {
    width: "100%",
    padding: 6,
    backgroundColor: "#f5f7fa",
  },
  aoHeader: {
    backgroundColor: "#eef1f8",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  aoCode: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
  },
  aoTitle: {
    fontSize: 9,
    color: "#555555",
  },
  loRef: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginBottom: 2,
  },
  loTitle: {
    fontSize: 9,
    color: "#555555",
  },
  scRow: {
    flexDirection: "row",
    marginBottom: 2,
    alignItems: "flex-start",
  },
  levelBadge: {
    backgroundColor: NAVY,
    color: "#ffffff",
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    marginRight: 4,
    marginTop: 1,
  },
  scText: {
    fontSize: 9,
    color: "#333333",
    flex: 1,
    lineHeight: 1.4,
  },
  lessonBar: {
    backgroundColor: LESSON_NAVY,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginTop: 8,
    marginHorizontal: 12,
  },
  lessonBarTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  lessonBarNum: {
    fontSize: 9,
    color: "#c0c8d8",
  },
  filesLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#666666",
    marginBottom: 3,
  },
  fileRow: {
    fontSize: 9,
    color: "#224488",
    marginBottom: 2,
  },
  footer: {
    position: "absolute",
    bottom: 14,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 9,
    color: "#888888",
  },
  noContent: {
    fontSize: 9,
    color: "#999999",
    fontStyle: "italic",
    padding: 6,
  },
})

// ---- Sub-components -------------------------------------------------------

function ScList({ criteria }: { criteria: UnitReportSc[] }) {
  if (criteria.length === 0) return <Text style={s.noContent}>No success criteria</Text>
  const sorted = [...criteria].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
  return (
    <>
      {sorted.map((sc) => (
        <View key={sc.success_criteria_id} style={s.scRow}>
          {sc.level != null && (
            <Text style={s.levelBadge}>L{sc.level}</Text>
          )}
          <Text style={s.scText}>{sc.description}</Text>
        </View>
      ))}
    </>
  )
}

function FilesSection({
  fileNames,
  links,
}: {
  fileNames: string[]
  links: { url: string; description: string | null }[]
}) {
  if (fileNames.length === 0 && links.length === 0) return null
  return (
    <View style={[s.tableRow, { borderTopWidth: 0 }]}>
      <View style={s.colFull}>
        <Text style={s.filesLabel}>DOWNLOADABLE FILES</Text>
        {fileNames.map((name, i) => (
          <Text key={`f-${i}`} style={s.fileRow}>{name}</Text>
        ))}
        {links.map((link, i) => (
          <Link key={`l-${i}`} src={link.url} style={s.fileRow}>
            {link.description ?? link.url}
          </Link>
        ))}
      </View>
    </View>
  )
}

// ---- Main document --------------------------------------------------------

export function UnitReportDocument({
  unitTitle,
  subject,
  year,
  description,
  learningObjectives,
  lessons,
}: UnitReportDocumentProps) {
  // Group LOs by assessment objective
  const aoMap = new Map<
    string,
    {
      code: string | null
      title: string | null
      order: number | null
      los: UnitReportLo[]
    }
  >()

  for (const lo of learningObjectives) {
    const aoId = lo.assessment_objective_id ?? "__none__"
    if (!aoMap.has(aoId)) {
      aoMap.set(aoId, {
        code: lo.assessment_objective_code,
        title: lo.assessment_objective_title,
        order: lo.assessment_objective_order_index,
        los: [],
      })
    }
    aoMap.get(aoId)!.los.push(lo)
  }

  const aoGroups = [...aoMap.entries()].sort(
    ([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0),
  )

  const infoText = [subject, year != null ? `Year ${year}` : null]
    .filter(Boolean)
    .join(" · ")

  const sortedLessons = [...lessons].sort(
    (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
  )

  return (
    <Document>
      {/* ---- Page 1: Overview ----------------------------------------- */}
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerTitleBlock}>
            <Text style={s.headerTitle}>{unitTitle}</Text>
            <Text style={s.headerSubtitle}>Unit Report</Text>
          </View>
        </View>

        <Text style={s.subtitle}>Unit Overview</Text>

        <View style={s.infoBar}>
          <Text style={s.infoBarText}>{infoText}</Text>
          <Text style={s.infoBarText}>mr-salih.org</Text>
        </View>

        {/* Section: Description */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionHeaderText}>Unit Description</Text>
        </View>
        <View style={s.descBox}>
          <Text>{description?.trim() || "No description provided."}</Text>
        </View>

        {/* Section: LOs & SCs */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionHeaderText}>Learning Objectives & Success Criteria</Text>
        </View>

        <View style={s.table}>
          {aoGroups.map(([aoId, ao], aoIdx) => {
            const sortedLos = [...ao.los].sort(
              (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
            )
            return (
              <View key={aoId}>
                {/* AO group header */}
                <View
                  style={[
                    s.aoHeader,
                    aoIdx === 0 ? { borderTopWidth: 1 } : {},
                  ]}
                >
                  <Text style={s.aoCode}>{ao.code ?? "AO"}</Text>
                  {ao.title && <Text style={s.aoTitle}>{ao.title}</Text>}
                </View>

                {/* LO rows within AO */}
                {sortedLos.map((lo, loIdx) => (
                  <View
                    key={lo.learning_objective_id}
                    style={[
                      s.tableRow,
                      loIdx === 0 ? {} : {},
                    ]}
                  >
                    <View style={s.colLeft}>
                      <Text style={s.loRef}>
                        {lo.spec_ref ?? `LO ${(lo.order_index ?? 0) + 1}`}
                      </Text>
                      <Text style={s.loTitle}>{lo.title}</Text>
                    </View>
                    <View style={s.colRight}>
                      <ScList criteria={lo.success_criteria} />
                    </View>
                  </View>
                ))}
              </View>
            )
          })}

          {learningObjectives.length === 0 && (
            <View style={[s.tableRow, s.tableRowFirst]}>
              <View style={s.colFull}>
                <Text style={s.noContent}>No learning objectives defined for this unit.</Text>
              </View>
            </View>
          )}
        </View>

        <Text
          style={s.footer}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} | mr-salih.org`
          }
          fixed
        />
      </Page>

      {/* ---- Page 2+: Lessons ----------------------------------------- */}
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.headerTitleBlock}>
            <Text style={s.headerTitle}>{unitTitle}</Text>
            <Text style={s.headerSubtitle}>Unit Report</Text>
          </View>
        </View>

        <Text style={s.subtitle}>Lessons</Text>

        <View style={s.infoBar}>
          <Text style={s.infoBarText}>{infoText}</Text>
          <Text style={s.infoBarText}>mr-salih.org</Text>
        </View>

        {sortedLessons.length === 0 && (
          <View style={{ marginHorizontal: 12, marginTop: 10 }}>
            <Text style={s.noContent}>No lessons in this unit.</Text>
          </View>
        )}

        {sortedLessons.map((lesson, idx) => {
          const sortedObjectives = [...lesson.lesson_objectives].sort(
            (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
          )
          const hasFiles =
            lesson.file_names.length > 0 || lesson.lesson_links.length > 0

          return (
            <View key={lesson.lesson_id}>
              {/* Lesson title bar */}
              <View style={s.lessonBar}>
                <Text style={s.lessonBarTitle}>{lesson.title}</Text>
                <Text style={s.lessonBarNum}>
                  Lesson {idx + 1} of {sortedLessons.length}
                </Text>
              </View>

              {/* LO / SC table */}
              <View style={s.table}>
                {sortedObjectives.length === 0 && (
                  <View style={[s.tableRow, s.tableRowFirst]}>
                    <View style={s.colFull}>
                      <Text style={s.noContent}>No objectives assigned to this lesson.</Text>
                    </View>
                  </View>
                )}
                {sortedObjectives.map((lo, loIdx) => {
                  const matchingScs = lesson.lesson_success_criteria.filter(
                    (sc) => sc.learning_objective_id === lo.learning_objective_id,
                  )
                  const displayScs =
                    matchingScs.length > 0 ? matchingScs : lesson.lesson_success_criteria

                  return (
                    <View
                      key={lo.learning_objective_id}
                      style={[
                        s.tableRow,
                        loIdx === 0 ? s.tableRowFirst : {},
                      ]}
                    >
                      <View style={s.colLeft}>
                        <Text style={s.loRef}>
                          {lo.spec_ref ?? lo.learning_objective_id.slice(0, 8)}
                        </Text>
                        <Text style={s.loTitle}>{lo.title}</Text>
                      </View>
                      <View style={s.colRight}>
                        <ScList criteria={displayScs} />
                      </View>
                    </View>
                  )
                })}

                {hasFiles && (
                  <FilesSection
                    fileNames={lesson.file_names}
                    links={lesson.lesson_links}
                  />
                )}
              </View>
            </View>
          )
        })}

        <Text
          style={s.footer}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} | mr-salih.org`
          }
          fixed
        />
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | grep -E "unit-report-document|error TS" | head -20
```

Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/pdf/unit-report-document.tsx
git commit -m "feat(unit-report): add UnitReportDocument PDF component"
```

---

## Task 5: API route

**Files:**
- Create: `src/app/api/unit-report/[unitId]/route.tsx`

- [ ] **Step 1: Create the route file**

```typescript
import { createElement } from "react"
import type { ReactElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import type { DocumentProps } from "@react-pdf/renderer"

import { getAuthenticatedProfile, hasRole } from "@/lib/auth"
import {
  readUnitAction,
  readLearningObjectivesByUnitAction,
  readLessonsByUnitAction,
  readFileDownloadActivitiesByUnitAction,
} from "@/lib/server-updates"
import { UnitReportDocument } from "@/components/pdf/unit-report-document"
import type {
  UnitReportDocumentProps,
  UnitReportLo,
  UnitReportLesson,
} from "@/components/pdf/unit-report-document"

const ROUTE_TAG = "/api/unit-report/[unitId]"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ unitId: string }> },
) {
  const profile = await getAuthenticatedProfile()
  if (!profile || !hasRole(profile, "teacher")) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { unitId } = await params

  const [unitResult, losResult, lessonsResult, fileActivities] =
    await Promise.all([
      readUnitAction(unitId, { routeTag: ROUTE_TAG, authEndTime: null }),
      readLearningObjectivesByUnitAction(unitId, {
        routeTag: ROUTE_TAG,
        authEndTime: null,
      }),
      readLessonsByUnitAction(unitId, {
        routeTag: ROUTE_TAG,
        authEndTime: null,
      }),
      readFileDownloadActivitiesByUnitAction(unitId),
    ])

  if (!unitResult.data) {
    return new Response("Unit not found", { status: 404 })
  }

  const unit = unitResult.data
  const rawLos = losResult.data ?? []
  const rawLessons = lessonsResult.data ?? []

  // Build file-name map keyed by lessonId
  const filesByLesson = new Map<string, string[]>()
  for (const { lessonId, fileName } of fileActivities) {
    if (!filesByLesson.has(lessonId)) filesByLesson.set(lessonId, [])
    filesByLesson.get(lessonId)!.push(fileName)
  }

  const learningObjectives: UnitReportLo[] = rawLos.map((lo) => ({
    learning_objective_id: lo.learning_objective_id,
    title: lo.title,
    order_index: lo.order_index ?? null,
    spec_ref: lo.spec_ref ?? null,
    assessment_objective_id: lo.assessment_objective_id ?? null,
    assessment_objective_code: lo.assessment_objective_code ?? null,
    assessment_objective_title: lo.assessment_objective_title ?? null,
    assessment_objective_order_index: lo.assessment_objective_order_index ?? null,
    success_criteria: (lo.success_criteria ?? []).map((sc) => ({
      success_criteria_id: sc.success_criteria_id,
      description: sc.description,
      level: typeof sc.level === "number" ? sc.level : null,
      order_index: sc.order_index ?? null,
    })),
  }))

  const lessons: UnitReportLesson[] = rawLessons.map((lesson) => ({
    lesson_id: lesson.lesson_id,
    title: lesson.title,
    order_by: lesson.order_by ?? null,
    lesson_objectives: (lesson.lesson_objectives ?? []).map((lo) => ({
      learning_objective_id: lo.learning_objective_id,
      title: lo.title,
      order_by: lo.order_by ?? null,
      spec_ref: null,
    })),
    lesson_success_criteria: (lesson.lesson_success_criteria ?? []).map((sc) => ({
      success_criteria_id: sc.success_criteria_id,
      description: sc.description,
      level: typeof sc.level === "number" ? sc.level : null,
      order_index: sc.order_index ?? null,
      learning_objective_id: (sc as { learning_objective_id?: string }).learning_objective_id ?? "",
    })),
    lesson_links: (lesson.lesson_links ?? []).map((link) => ({
      url: link.url,
      description: link.description ?? null,
    })),
    file_names: filesByLesson.get(lesson.lesson_id) ?? [],
  }))

  const props: UnitReportDocumentProps = {
    unitTitle: unit.title,
    subject: unit.subject,
    year: unit.year ?? null,
    description: unit.description ?? null,
    learningObjectives,
    lessons,
  }

  const docElement = createElement(UnitReportDocument, props) as unknown as ReactElement<DocumentProps>
  const buffer = await renderToBuffer(docElement)

  const safeTitle = unit.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeTitle}-report.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
```

- [ ] **Step 2: Run the build to check for type errors**

```bash
pnpm build 2>&1 | grep -E "unit-report|error TS" | head -30
```

Expected: clean compilation. Fix any type mismatches reported (field names on `lesson_success_criteria` may need adjusting based on actual schema shape).

- [ ] **Step 3: Start dev server and test the route manually**

```bash
pnpm dev &
sleep 5
# Visit /units in browser, open a unit, click Generate Report
# Or test directly:
curl -I http://localhost:3000/api/unit-report/<a-real-unit-id> -H "Cookie: <session-cookie>"
```

Expected: `Content-Type: application/pdf` and a downloaded file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/unit-report/
git commit -m "feat(unit-report): add /api/unit-report/[unitId] PDF route"
```

---

## Task 6: Verify end-to-end in browser

- [ ] **Step 1: Open the dev server and navigate to a unit with LOs and lessons**

Visit `http://localhost:3000/units` → click a unit → confirm the "Generate Report" button is visible.

- [ ] **Step 2: Click "Generate Report" and open the downloaded PDF**

Check:
- Header shows unit title and "Unit Report" subtitle
- Info bar shows subject and year
- Unit Description section renders the description text (or the "No description provided" placeholder)
- Learning Objectives & Success Criteria section shows LOs grouped by AO with level badges on each SC
- Lessons section shows each lesson with its title bar, LOs/SCs table, and any files/links
- Footer shows `Page 1 | mr-salih.org`

- [ ] **Step 3: Test with a unit that has no description, no LOs, or no lessons**

Confirm placeholder text renders rather than a blank/crashed PDF.

- [ ] **Step 4: Final commit if any fixup changes were made**

```bash
git add -A
git commit -m "fix(unit-report): fixups from end-to-end testing"
```

---

## Self-Review Notes

- **Spec coverage:** Unit description ✓, LOs & SCs grouped by AO ✓, lessons with LOs/SCs ✓, file-download activities ✓, lesson links ✓, teacher-only ✓, Cornell Notes style ✓
- **No placeholders:** All code blocks are complete
- **Type consistency:** `UnitReportSc`, `UnitReportLo`, `UnitReportLesson`, `UnitReportDocumentProps` defined once in the document component and imported in the route
- **Known edge case:** `lesson_success_criteria` shape from `enrichLessonsWithSuccessCriteria` may include a `learning_objective_id` field — the route casts via `(sc as { learning_objective_id?: string })`. If the field name differs, adjust to match what the action actually returns.
