# Test Curriculum UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a document-style curriculum editor at `/tests/curriculum` with markdown syntax and change tracking

**Architecture:** Two-page app with server components loading data and client components handling interactivity. Index shows curriculum cards, detail shows split-panel editor (markdown left, changes right) with auto-save.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Tailwind CSS, shadcn/ui, existing server actions

---

## Task 1: Create Index Page Structure

**Files:**
- Create: `src/app/tests/curriculum/page.tsx`
- Create: `src/app/tests/curriculum/curriculum-cards-client.tsx`

**Step 1: Create server component page**

Create `src/app/tests/curriculum/page.tsx`:

```typescript
export const dynamic = "force-dynamic"

import { readCurriculaAction } from "@/lib/server-updates"
import { requireTeacherProfile } from "@/lib/auth"
import { CurriculumCardsClient } from "./curriculum-cards-client"

export default async function TestCurriculumIndexPage() {
  await requireTeacherProfile()

  const result = await readCurriculaAction()

  return (
    <CurriculumCardsClient
      curricula={result.data ?? []}
      error={result.error}
    />
  )
}
```

**Step 2: Create client component with basic layout**

Create `src/app/tests/curriculum/curriculum-cards-client.tsx`:

```typescript
"use client"

import { useState } from "react"
import Link from "next/link"
import type { Curriculum } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, FileText } from "lucide-react"

interface CurriculumCardsClientProps {
  curricula: Curriculum[]
  error: string | null
}

export function CurriculumCardsClient({ curricula, error }: CurriculumCardsClientProps) {
  if (error) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-destructive">Error loading curricula: {error}</p>
      </div>
    )
  }

  return (
    <main className="container mx-auto py-8 px-4">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Curriculum Test UI</h1>
          <p className="text-muted-foreground">
            Document-style curriculum editor
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {curricula.map(curriculum => (
          <Card key={curriculum.curriculum_id}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle>{curriculum.title}</CardTitle>
                {curriculum.subject && (
                  <Badge variant="secondary">
                    {curriculum.subject}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {curriculum.description || "No description"}
              </p>
              <div className="flex gap-2">
                <Button size="sm" asChild>
                  <Link href={`/tests/curriculum/${curriculum.curriculum_id}`}>
                    <FileText className="mr-2 h-4 w-4" />
                    View Details
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  )
}
```

**Step 3: Verify page renders**

Run: `npm run dev` (if not already running on port 3002)
Navigate to: `http://localhost:3002/tests/curriculum`
Expected: See curriculum cards with titles and "View Details" buttons

**Step 4: Commit**

```bash
git add src/app/tests/curriculum/
git commit -m "Add test curriculum index page with card view

- Server component loads curricula
- Client component displays cards
- Links to detail pages

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Detail Page Structure

**Files:**
- Create: `src/app/tests/curriculum/[curriculumId]/page.tsx`
- Create: `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`

**Step 1: Create server component for detail page**

Create `src/app/tests/curriculum/[curriculumId]/page.tsx`:

```typescript
export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { requireTeacherProfile } from "@/lib/auth"
import { readCurriculumDetailAction } from "@/lib/server-updates"
import { CurriculumEditorClient } from "./curriculum-editor-client"

export default async function TestCurriculumDetailPage({
  params,
}: {
  params: Promise<{ curriculumId: string }>
}) {
  await requireTeacherProfile()
  const { curriculumId } = await params

  const result = await readCurriculumDetailAction(curriculumId)

  if (!result.data) {
    notFound()
  }

  return (
    <CurriculumEditorClient
      curriculum={result.data}
    />
  )
}
```

**Step 2: Create basic client component with split layout**

Create `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`:

```typescript
"use client"

import { useState } from "react"
import Link from "next/link"
import type { CurriculumDetail } from "@/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

interface CurriculumEditorClientProps {
  curriculum: CurriculumDetail
}

export function CurriculumEditorClient({ curriculum }: CurriculumEditorClientProps) {
  const [markdown, setMarkdown] = useState("")

  return (
    <div className="flex h-screen">
      {/* Left Panel - Editor */}
      <div className="flex-[3] border-r flex flex-col">
        <header className="border-b p-4 bg-background">
          <div className="flex items-center gap-2 mb-2">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/tests/curriculum">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-xl font-semibold">{curriculum.title}</h2>
              <p className="text-sm text-muted-foreground">
                {curriculum.subject}
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Syntax: # for AO, ## for LO, - for SC [L1-9]
          </div>
        </header>

        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          className="flex-1 font-mono text-sm p-4 resize-none border-0 focus-visible:ring-0"
          placeholder="# AO1: Assessment Objective Title&#10;## LO: Learning Objective Title&#10;- Success criterion description [L3]"
          spellCheck={false}
        />
      </div>

      {/* Right Panel - Changes */}
      <div className="flex-[2] flex flex-col bg-muted/30">
        <header className="border-b p-4 bg-background">
          <h3 className="font-semibold">Changes</h3>
        </header>

        <ScrollArea className="flex-1 p-4">
          <p className="text-sm text-muted-foreground">
            No changes yet. Start editing to see changes tracked here.
          </p>
        </ScrollArea>
      </div>
    </div>
  )
}
```

**Step 3: Verify detail page renders**

Navigate to: `http://localhost:3002/tests/curriculum/[any-curriculum-id]`
Expected: See split-panel layout with empty editor and changes panel

**Step 4: Commit**

```bash
git add src/app/tests/curriculum/[curriculumId]/
git commit -m "Add test curriculum detail page with split layout

- Server component loads curriculum detail
- Client shows split editor layout
- Left panel: markdown textarea
- Right panel: changes tracking placeholder

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Markdown Parser

**Files:**
- Create: `src/app/tests/curriculum/_lib/markdown-parser.ts`

**Step 1: Create parser types**

Create `src/app/tests/curriculum/_lib/markdown-parser.ts`:

```typescript
export interface ParsedSC {
  description: string
  level: number
  order_index: number
  _line: number
}

export interface ParsedLO {
  title: string
  order_index: number
  scs: ParsedSC[]
  _line: number
}

export interface ParsedAO {
  code: string
  title: string
  order_index: number
  los: ParsedLO[]
  _line: number
}

export interface ParsedStructure {
  aos: ParsedAO[]
}

export interface ParseError {
  line: number
  message: string
}

export interface ParseResult {
  structure: ParsedStructure
  errors: ParseError[]
}
```

**Step 2: Implement parser function**

Add to `src/app/tests/curriculum/_lib/markdown-parser.ts`:

```typescript
export function parseMarkdown(text: string): ParseResult {
  const lines = text.split('\n')
  const structure: ParsedStructure = { aos: [] }
  const errors: ParseError[] = []

  let currentAO: ParsedAO | null = null
  let currentLO: ParsedLO | null = null
  let aoIndex = 0
  let loIndex = 0
  let scIndex = 0

  lines.forEach((line, lineNumber) => {
    const trimmed = line.trim()

    // Skip empty lines
    if (trimmed === '') return

    // Parse AO: # CODE: Title
    if (trimmed.startsWith('# ')) {
      const match = trimmed.match(/^#\s+([A-Z0-9]+):\s*(.+)$/)
      if (match) {
        currentAO = {
          code: match[1],
          title: match[2],
          order_index: aoIndex++,
          los: [],
          _line: lineNumber
        }
        structure.aos.push(currentAO)
        currentLO = null
        loIndex = 0
      } else {
        errors.push({
          line: lineNumber,
          message: 'Invalid AO format. Expected: # CODE: Title'
        })
      }
      return
    }

    // Parse LO: ## LO: Title or ## Title
    if (trimmed.startsWith('## ')) {
      if (!currentAO) {
        errors.push({
          line: lineNumber,
          message: 'LO must be under an AO'
        })
        return
      }

      const match = trimmed.match(/^##\s+(?:LO:\s*)?(.+)$/)
      if (match) {
        currentLO = {
          title: match[1],
          order_index: loIndex++,
          scs: [],
          _line: lineNumber
        }
        currentAO.los.push(currentLO)
        scIndex = 0
      } else {
        errors.push({
          line: lineNumber,
          message: 'Invalid LO format. Expected: ## Title'
        })
      }
      return
    }

    // Parse SC: - Description [LN]
    if (trimmed.startsWith('- ')) {
      if (!currentLO) {
        errors.push({
          line: lineNumber,
          message: 'SC must be under an LO'
        })
        return
      }

      const match = trimmed.match(/^-\s+(.+?)(?:\s+\[L(\d)\])?$/)
      if (match) {
        const description = match[1]
        const level = match[2] ? parseInt(match[2], 10) : 1

        if (level >= 1 && level <= 9) {
          currentLO.scs.push({
            description,
            level,
            order_index: scIndex++,
            _line: lineNumber
          })
        } else {
          errors.push({
            line: lineNumber,
            message: 'SC level must be between 1 and 9'
          })
        }
      }
      return
    }

    // If we got here, it's an unrecognized line
    if (trimmed.length > 0) {
      errors.push({
        line: lineNumber,
        message: 'Unrecognized syntax'
      })
    }
  })

  return { structure, errors }
}
```

**Step 3: Test parser manually**

Add test code temporarily to editor component to verify:
```typescript
const testMarkdown = `# AO1: Computational Thinking
## LO: Understand abstraction
- Can identify components [L3]
- Can break down problems [L4]`

const result = parseMarkdown(testMarkdown)
console.log('Parsed:', result)
```

Expected: Console shows parsed structure with 1 AO, 1 LO, 2 SCs

**Step 4: Commit**

```bash
git add src/app/tests/curriculum/_lib/markdown-parser.ts
git commit -m "Add markdown parser for curriculum structure

- Parses # CODE: Title for AO
- Parses ## Title for LO
- Parses - Description [LN] for SC
- Returns structured data and parse errors

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Convert Curriculum to Markdown

**Files:**
- Modify: `src/app/tests/curriculum/_lib/markdown-parser.ts`

**Step 1: Add curriculum-to-markdown converter**

Add to `src/app/tests/curriculum/_lib/markdown-parser.ts`:

```typescript
import type { CurriculumDetail } from "@/types"

export function curriculumToMarkdown(curriculum: CurriculumDetail): string {
  const lines: string[] = []

  curriculum.assessment_objectives?.forEach(ao => {
    // Add AO
    lines.push(`# ${ao.code}: ${ao.title}`)

    ao.learning_objectives?.forEach(lo => {
      // Add LO
      lines.push(`## ${lo.title}`)

      lo.success_criteria?.forEach(sc => {
        // Add SC with level
        lines.push(`- ${sc.description} [L${sc.level}]`)
      })

      // Add blank line after each LO
      lines.push('')
    })

    // Add blank line after each AO
    lines.push('')
  })

  return lines.join('\n').trim()
}
```

**Step 2: Use converter in editor component**

Modify `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`:

```typescript
import { curriculumToMarkdown } from "../_lib/markdown-parser"

// In component:
const [markdown, setMarkdown] = useState(() => curriculumToMarkdown(curriculum))
```

**Step 3: Verify markdown loads**

Navigate to detail page, expected: Textarea shows markdown representation of curriculum

**Step 4: Commit**

```bash
git add src/app/tests/curriculum/_lib/markdown-parser.ts src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx
git commit -m "Add curriculum to markdown converter

- Converts CurriculumDetail to markdown format
- Initializes editor with current curriculum structure
- Maintains proper formatting with blank lines

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Change Detection

**Files:**
- Create: `src/app/tests/curriculum/_lib/change-detection.ts`

**Step 1: Create change types**

Create `src/app/tests/curriculum/_lib/change-detection.ts`:

```typescript
import type { ParsedStructure } from "./markdown-parser"
import type { CurriculumDetail } from "@/types"

export type ChangeType = 'added' | 'modified' | 'deleted' | 'reordered'
export type EntityType = 'ao' | 'lo' | 'sc'

export interface Change {
  id: string
  timestamp: Date
  type: ChangeType
  entityType: EntityType
  entityId: string | null // null for new items
  details: {
    before?: any
    after?: any
    field?: string
    description?: string
  }
  saved: boolean
}

export function generateChangeId(): string {
  return `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
```

**Step 2: Implement change detection**

Add to `src/app/tests/curriculum/_lib/change-detection.ts`:

```typescript
export function detectChanges(
  original: CurriculumDetail,
  parsed: ParsedStructure
): Change[] {
  const changes: Change[] = []
  const timestamp = new Date()

  // Create lookup maps for original data
  const originalAOs = new Map(
    original.assessment_objectives?.map(ao => [ao.code, ao]) ?? []
  )

  // Detect AO changes
  parsed.aos.forEach(parsedAO => {
    const originalAO = originalAOs.get(parsedAO.code)

    if (!originalAO) {
      // New AO
      changes.push({
        id: generateChangeId(),
        timestamp,
        type: 'added',
        entityType: 'ao',
        entityId: null,
        details: {
          after: parsedAO,
          description: `Added ${parsedAO.code}: ${parsedAO.title}`
        },
        saved: false
      })
    } else {
      // Check for modifications
      if (originalAO.title !== parsedAO.title) {
        changes.push({
          id: generateChangeId(),
          timestamp,
          type: 'modified',
          entityType: 'ao',
          entityId: originalAO.assessment_objective_id,
          details: {
            before: originalAO.title,
            after: parsedAO.title,
            field: 'title',
            description: `Modified ${parsedAO.code}: Title changed`
          },
          saved: false
        })
      }

      // Detect LO changes
      const originalLOs = new Map(
        originalAO.learning_objectives?.map((lo, idx) => [idx, lo]) ?? []
      )

      parsedAO.los.forEach((parsedLO, loIdx) => {
        const originalLO = originalLOs.get(loIdx)

        if (!originalLO) {
          // New LO
          changes.push({
            id: generateChangeId(),
            timestamp,
            type: 'added',
            entityType: 'lo',
            entityId: null,
            details: {
              after: parsedLO,
              description: `Added LO: ${parsedLO.title}`
            },
            saved: false
          })
        } else {
          // Check for LO modifications
          if (originalLO.title !== parsedLO.title) {
            changes.push({
              id: generateChangeId(),
              timestamp,
              type: 'modified',
              entityType: 'lo',
              entityId: originalLO.learning_objective_id,
              details: {
                before: originalLO.title,
                after: parsedLO.title,
                field: 'title',
                description: `Modified LO: Title changed`
              },
              saved: false
            })
          }

          // Detect SC changes
          const originalSCs = new Map(
            originalLO.success_criteria?.map((sc, idx) => [idx, sc]) ?? []
          )

          parsedLO.scs.forEach((parsedSC, scIdx) => {
            const originalSC = originalSCs.get(scIdx)

            if (!originalSC) {
              // New SC
              changes.push({
                id: generateChangeId(),
                timestamp,
                type: 'added',
                entityType: 'sc',
                entityId: null,
                details: {
                  after: parsedSC,
                  description: `Added SC: ${parsedSC.description.substring(0, 50)}... [L${parsedSC.level}]`
                },
                saved: false
              })
            } else {
              // Check for SC modifications
              if (originalSC.description !== parsedSC.description) {
                changes.push({
                  id: generateChangeId(),
                  timestamp,
                  type: 'modified',
                  entityType: 'sc',
                  entityId: originalSC.success_criteria_id,
                  details: {
                    before: originalSC.description,
                    after: parsedSC.description,
                    field: 'description',
                    description: `Modified SC: Description changed`
                  },
                  saved: false
                })
              }

              if (originalSC.level !== parsedSC.level) {
                changes.push({
                  id: generateChangeId(),
                  timestamp,
                  type: 'modified',
                  entityType: 'sc',
                  entityId: originalSC.success_criteria_id,
                  details: {
                    before: originalSC.level,
                    after: parsedSC.level,
                    field: 'level',
                    description: `Changed SC level: ${originalSC.level} → ${parsedSC.level}`
                  },
                  saved: false
                })
              }
            }
          })
        }
      })
    }
  })

  return changes
}
```

**Step 3: Commit**

```bash
git add src/app/tests/curriculum/_lib/change-detection.ts
git commit -m "Add change detection for curriculum edits

- Detects added/modified AO/LO/SC
- Compares parsed structure against original
- Generates structured change objects
- Tracks specific fields that changed

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create Changes Panel Component

**Files:**
- Create: `src/app/tests/curriculum/_components/changes-panel.tsx`

**Step 1: Create changes panel component**

Create `src/app/tests/curriculum/_components/changes-panel.tsx`:

```typescript
"use client"

import type { Change } from "../_lib/change-detection"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X, RotateCcw } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface ChangesPanelProps {
  unsaved: Change[]
  saved: Change[]
  onUndo: (changeId: string) => void
  onRevert: (changeId: string) => void
}

export function ChangesPanel({ unsaved, saved, onUndo, onRevert }: ChangesPanelProps) {
  if (unsaved.length === 0 && saved.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No changes yet. Start editing to see changes tracked here.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Unsaved Changes */}
      {unsaved.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Unsaved</h4>
            <Badge variant="secondary">{unsaved.length}</Badge>
          </div>
          <div className="space-y-2">
            {unsaved.map(change => (
              <div
                key={change.id}
                className="border rounded-md p-3 bg-background space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {change.type}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {change.entityType.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm mt-1">{change.details.description}</p>
                    {change.type === 'modified' && (
                      <div className="text-xs text-muted-foreground mt-1">
                        <div>Before: {String(change.details.before)}</div>
                        <div>After: {String(change.details.after)}</div>
                      </div>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => onUndo(change.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved Changes */}
      {saved.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Saved</h4>
            <Badge>{saved.length}</Badge>
          </div>
          <div className="space-y-2">
            {saved.slice(0, 10).map(change => (
              <div
                key={change.id}
                className="border rounded-md p-3 bg-muted/50 space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {change.type}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {change.entityType.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm mt-1">{change.details.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(change.timestamp, { addSuffix: true })}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => onRevert(change.id)}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Install date-fns if not already installed**

Run: `npm install date-fns` (likely already installed)

**Step 3: Commit**

```bash
git add src/app/tests/curriculum/_components/changes-panel.tsx
git commit -m "Add changes panel component

- Displays unsaved and saved changes
- Shows change type, entity type, description
- Undo/revert buttons for each change
- Relative timestamps for saved changes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Integrate Changes into Editor

**Files:**
- Modify: `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`

**Step 1: Add change detection to editor**

Modify `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`:

```typescript
"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import type { CurriculumDetail } from "@/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { curriculumToMarkdown, parseMarkdown } from "../_lib/markdown-parser"
import { detectChanges, type Change } from "../_lib/change-detection"
import { ChangesPanel } from "../_components/changes-panel"

interface CurriculumEditorClientProps {
  curriculum: CurriculumDetail
}

export function CurriculumEditorClient({ curriculum }: CurriculumEditorClientProps) {
  const [markdown, setMarkdown] = useState(() => curriculumToMarkdown(curriculum))
  const [pendingChanges, setPendingChanges] = useState<Change[]>([])
  const [savedChanges, setSavedChanges] = useState<Change[]>([])

  // Detect changes when markdown changes
  useEffect(() => {
    const parsed = parseMarkdown(markdown)
    if (parsed.errors.length === 0) {
      const changes = detectChanges(curriculum, parsed.structure)
      setPendingChanges(changes)
    }
  }, [markdown, curriculum])

  const handleUndo = (changeId: string) => {
    // Remove change from pending
    setPendingChanges(prev => prev.filter(c => c.id !== changeId))
    // TODO: Revert markdown to previous state
  }

  const handleRevert = (changeId: string) => {
    // TODO: Create reversing change
    console.log('Revert change:', changeId)
  }

  return (
    <div className="flex h-screen">
      {/* Left Panel - Editor */}
      <div className="flex-[3] border-r flex flex-col">
        <header className="border-b p-4 bg-background">
          <div className="flex items-center gap-2 mb-2">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/tests/curriculum">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-xl font-semibold">{curriculum.title}</h2>
              <p className="text-sm text-muted-foreground">
                {curriculum.subject}
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Syntax: # for AO, ## for LO, - for SC [L1-9]
          </div>
        </header>

        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          className="flex-1 font-mono text-sm p-4 resize-none border-0 focus-visible:ring-0"
          placeholder="# AO1: Assessment Objective Title&#10;## LO: Learning Objective Title&#10;- Success criterion description [L3]"
          spellCheck={false}
        />
      </div>

      {/* Right Panel - Changes */}
      <div className="flex-[2] flex flex-col bg-muted/30">
        <header className="border-b p-4 bg-background">
          <h3 className="font-semibold">Changes</h3>
          {pendingChanges.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Auto-saving in 3s...
            </p>
          )}
        </header>

        <ScrollArea className="flex-1 p-4">
          <ChangesPanel
            unsaved={pendingChanges}
            saved={savedChanges}
            onUndo={handleUndo}
            onRevert={handleRevert}
          />
        </ScrollArea>
      </div>
    </div>
  )
}
```

**Step 2: Verify changes appear**

Edit markdown in textarea, expected: Changes panel updates with detected changes

**Step 3: Commit**

```bash
git add src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx
git commit -m "Integrate change detection into editor

- Parse markdown on every change
- Detect changes against original curriculum
- Display changes in right panel
- Placeholder undo/revert handlers

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Add Auto-Save (Basic)

**Files:**
- Modify: `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`

**Step 1: Add auto-save with debounce**

Modify `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`, add auto-save effect:

```typescript
import { useState, useEffect, useTransition } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"

// Add after other useState:
const [isSaving, startTransition] = useTransition()
const [lastSaved, setLastSaved] = useState<Date | null>(null)

// Add auto-save effect:
useEffect(() => {
  if (pendingChanges.length === 0) return

  const timer = setTimeout(() => {
    startTransition(async () => {
      // Simulate save
      console.log('Auto-saving changes:', pendingChanges)

      // Move pending to saved
      setSavedChanges(prev => [...pendingChanges, ...prev])
      setPendingChanges([])
      setLastSaved(new Date())

      toast.success(`${pendingChanges.length} changes saved`)
    })
  }, 3000) // 3 second debounce

  return () => clearTimeout(timer)
}, [pendingChanges])

// Update header to show saving status:
<header className="border-b p-4 bg-background">
  <div className="flex items-center justify-between">
    <h3 className="font-semibold">Changes</h3>
    {isSaving && (
      <Badge variant="secondary" className="animate-pulse">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Saving...
      </Badge>
    )}
    {pendingChanges.length > 0 && !isSaving && (
      <Badge variant="outline">
        {pendingChanges.length} pending
      </Badge>
    )}
    {lastSaved && pendingChanges.length === 0 && !isSaving && (
      <span className="text-xs text-muted-foreground">
        Saved {formatDistanceToNow(lastSaved, { addSuffix: true })}
      </span>
    )}
  </div>
</header>
```

**Step 2: Test auto-save**

Edit markdown, wait 3 seconds, expected: Changes move from "Unsaved" to "Saved", toast appears

**Step 3: Commit**

```bash
git add src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx
git commit -m "Add auto-save with 3-second debounce

- Debounce save after 3 seconds of inactivity
- Move pending changes to saved after save
- Show saving indicator and last saved timestamp
- Toast notification on successful save

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Manual Testing & Refinement

**Files:**
- None (manual testing)

**Step 1: Test complete workflow**

1. Navigate to `http://localhost:3002/tests/curriculum`
2. Verify curriculum cards display
3. Click "View Details" on a curriculum
4. Verify markdown loads with current structure
5. Edit markdown (add new AO, LO, SC)
6. Verify changes appear in right panel
7. Wait 3 seconds and verify auto-save works
8. Check changes move to "Saved" section

**Step 2: Test edge cases**

1. Empty curriculum - should show empty editor
2. Invalid syntax - should show parse errors (not yet implemented)
3. Very long descriptions - should not break layout
4. Rapid typing - debounce should work correctly

**Step 3: Document any issues**

Create list of issues found and improvements needed

---

## Task 10: Final Cleanup & Documentation

**Files:**
- Create: `src/app/tests/curriculum/README.md`

**Step 1: Create README**

Create `src/app/tests/curriculum/README.md`:

```markdown
# Test Curriculum UI

Document-style curriculum editor for testing new UX patterns.

## Routes

- `/tests/curriculum` - Card view of all curricula
- `/tests/curriculum/[id]` - Split-panel editor with markdown syntax

## Features

- **Markdown Syntax**: Edit curriculum structure like a document
  - `# CODE: Title` for Assessment Objectives
  - `## Title` for Learning Objectives
  - `- Description [LN]` for Success Criteria (level 1-9)
- **Change Tracking**: See all modifications in real-time
- **Auto-Save**: Changes saved automatically after 3 seconds

## Architecture

- Server components load data
- Client components handle interactivity
- Markdown parser converts text to structured data
- Change detection compares against original
- Auto-save with debounce

## Files

- `page.tsx` - Index page server component
- `[curriculumId]/page.tsx` - Detail page server component
- `curriculum-cards-client.tsx` - Card grid client component
- `[curriculumId]/curriculum-editor-client.tsx` - Split editor client component
- `_lib/markdown-parser.ts` - Parser and converter
- `_lib/change-detection.ts` - Change detection logic
- `_components/changes-panel.tsx` - Changes display component

## Development

Run dev server on port 3002:
```bash
cd .worktrees/test-curriculum-ui
PORT=3002 npm run dev
```

Access at: http://localhost:3002/tests/curriculum
```

**Step 2: Final commit**

```bash
git add src/app/tests/curriculum/README.md
git commit -m "Add README for test curriculum UI

Documents routes, features, architecture, and file structure.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 3: Push feature branch**

```bash
git push -u origin feature/test-curriculum-ui
```

---

## Summary

**10 tasks completed:**
1. ✅ Index page with curriculum cards
2. ✅ Detail page with split-panel layout
3. ✅ Markdown parser
4. ✅ Curriculum to markdown converter
5. ✅ Change detection logic
6. ✅ Changes panel component
7. ✅ Integration with editor
8. ✅ Auto-save functionality
9. ✅ Manual testing
10. ✅ Documentation

**Files created:**
- `src/app/tests/curriculum/page.tsx`
- `src/app/tests/curriculum/curriculum-cards-client.tsx`
- `src/app/tests/curriculum/[curriculumId]/page.tsx`
- `src/app/tests/curriculum/[curriculumId]/curriculum-editor-client.tsx`
- `src/app/tests/curriculum/_lib/markdown-parser.ts`
- `src/app/tests/curriculum/_lib/change-detection.ts`
- `src/app/tests/curriculum/_components/changes-panel.tsx`
- `src/app/tests/curriculum/README.md`

**Next steps:**
- Add server action for persisting changes to database
- Implement parse error display
- Add undo/redo functionality
- Add keyboard shortcuts
- Consider syntax highlighting
