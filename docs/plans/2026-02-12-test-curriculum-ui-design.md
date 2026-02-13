# Test Curriculum UI - Document-Style Editor Design

**Date**: 2026-02-12
**Status**: Approved
**Path**: `/tests/curriculum`

## Overview

Create a test UI for curriculum management that treats curriculum structure like an editable document. Users can edit Assessment Objectives (AO), Learning Objectives (LO), and Success Criteria (SC) using markdown-like syntax with real-time conversion to the data model and structural change tracking.

## Goals

1. **Simpler, cleaner design** - Stripped-down interface for faster iteration
2. **Experiment with document-style UX** - Alternative to form-based editing
3. **Change auditability** - Track all modifications with rollback capability
4. **Fast editing workflow** - Keyboard-driven with auto-save

## User Requirements

### Primary Use Cases

1. View all curricula as cards
2. Edit curriculum properties (title, subject, description)
3. View hierarchical curriculum structure (AO → LO → SC)
4. Edit structure using markdown-like syntax
5. See structural diff of changes
6. Rollback individual changes
7. Auto-save edits

## Architecture

### Route Structure

```
/tests/curriculum
├── page.tsx              # Index: Card grid of all curricula
└── [curriculumId]
    └── page.tsx          # Detail: Split-panel editor
```

### Page Components

#### Index Page (`/tests/curriculum/page.tsx`)
- **Server Component**: Fetches all curricula via `readCurriculaAction()`
- **Client Component**: Renders card grid with edit capability
- **Features**:
  - Curriculum cards with title, subject, description
  - "Edit" button → Opens Sheet to edit properties
  - "View Details" button → Navigate to detail page
  - "Create New" button → Create curriculum

#### Detail Page (`/tests/curriculum/[curriculumId]/page.tsx`)
- **Server Component**: Fetches curriculum detail via `readCurriculumDetailAction()`
- **Client Component**: Split-panel editor with change tracking
- **Layout**:
  - Left panel (60%): Markdown editor
  - Right panel (40%): Change tracking

### Tech Stack

- **Framework**: Next.js App Router (existing)
- **State Management**: React useState + useTransition
- **Server Actions**: Existing curriculum actions from `src/lib/server-updates.ts`
- **UI Components**: shadcn/ui (Card, Button, Textarea, Badge, Sheet)
- **Auto-save**: Debounced with 3-second delay
- **Text Editor**: Plain textarea (optionally upgrade to CodeMirror later)

## Markdown Syntax

### Format

```markdown
# AO1: Computational Thinking
## LO: Understand abstraction and decomposition
- Can identify key components of a problem [L3]
- Can break down complex problems into smaller parts [L4]

## LO: Apply problem-solving techniques
- Can use decomposition in practice [L5]

# AO2: Programming Fundamentals
## LO: Understand variables and data types
- Can explain what a variable is [L2]
```

### Syntax Rules

| Element | Syntax | Example |
|---------|--------|---------|
| Assessment Objective | `# CODE: Title` | `# AO1: Computational Thinking` |
| Learning Objective | `## LO: Title` | `## LO: Understand abstraction` |
| Success Criterion | `- Description [LN]` | `- Can identify components [L3]` |

### Parsing Rules

1. **AO (Assessment Objective)**:
   - Starts with `# `
   - Format: `# CODE: Title`
   - Code: Required (e.g., AO1, AO2)
   - Extracts: `code`, `title`

2. **LO (Learning Objective)**:
   - Starts with `## `
   - Format: `## LO: Title` or `## Title`
   - Must be under an AO
   - Extracts: `title`

3. **SC (Success Criterion)**:
   - Starts with `- `
   - Format: `- Description [LN]` where N is 1-9
   - Must be under an LO
   - Level extraction: `/\[L(\d)\]$/`
   - Default level: 1 if not specified
   - Extracts: `description`, `level`

4. **Special Behaviors**:
   - Empty lines: Ignored
   - Invalid lines: Show warning indicator
   - Pressing Enter after SC: Creates new SC at same level
   - Tab/Shift+Tab: Indent/outdent (change hierarchy level)

### Parser Implementation

```typescript
interface ParsedStructure {
  aos: Array<{
    code: string
    title: string
    order_index: number
    los: Array<{
      title: string
      order_index: number
      scs: Array<{
        description: string
        level: number
        order_index: number
      }>
    }>
  }>
}

function parseMarkdown(text: string): ParsedStructure {
  const lines = text.split('\n')
  const result: ParsedStructure = { aos: [] }
  let currentAO = null
  let currentLO = null
  let aoIndex = 0, loIndex = 0, scIndex = 0

  lines.forEach((line, lineNumber) => {
    const trimmed = line.trim()

    if (trimmed.startsWith('# ')) {
      // Parse AO: # CODE: Title
      const match = trimmed.match(/^#\s+([A-Z0-9]+):\s*(.+)$/)
      if (match) {
        currentAO = {
          code: match[1],
          title: match[2],
          order_index: aoIndex++,
          los: [],
          _line: lineNumber
        }
        result.aos.push(currentAO)
        currentLO = null
        loIndex = 0
      }
    } else if (trimmed.startsWith('## ')) {
      // Parse LO: ## LO: Title or ## Title
      const match = trimmed.match(/^##\s+(?:LO:\s*)?(.+)$/)
      if (match && currentAO) {
        currentLO = {
          title: match[1],
          order_index: loIndex++,
          scs: [],
          _line: lineNumber
        }
        currentAO.los.push(currentLO)
        scIndex = 0
      }
    } else if (trimmed.startsWith('- ')) {
      // Parse SC: - Description [LN]
      const match = trimmed.match(/^-\s+(.+?)(?:\s+\[L(\d)\])?$/)
      if (match && currentLO) {
        const description = match[1]
        const level = match[2] ? parseInt(match[2], 10) : 1

        if (level >= 1 && level <= 9) {
          currentLO.scs.push({
            description,
            level,
            order_index: scIndex++,
            _line: lineNumber
          })
        }
      }
    }
  })

  return result
}
```

## Change Tracking System

### Change Types

```typescript
type ChangeType = 'added' | 'modified' | 'deleted' | 'reordered'
type EntityType = 'ao' | 'lo' | 'sc'

interface Change {
  id: string // UUID
  timestamp: Date
  type: ChangeType
  entityType: EntityType
  entityId: string | null // null for new items
  details: {
    before?: any
    after?: any
    field?: string
  }
  saved: boolean
  canRollback: boolean
}
```

### Change Detection

Compare parsed structure against saved state:

1. **Added**: Entity exists in parsed but not in saved
2. **Deleted**: Entity exists in saved but not in parsed
3. **Modified**: Entity exists in both but values differ
4. **Reordered**: Same entities but different order_index

### Right Panel Display

```
┌─────────────────────────────────────┐
│ Changes                             │
├─────────────────────────────────────┤
│ [Unsaved - Auto-saving in 2s...]   │
│                                     │
│ ✓ Added AO1: Computational...  [X] │
│ ✓ Added LO: Understand...       [X] │
│ ✓ Added SC: Can identify... [L3][X] │
│                                     │
├─────────────────────────────────────┤
│ [Saved]                             │
│                                     │
│ ✓ Modified AO1: Title changed       │
│   Before: "Comp Thinking"     [⟲]  │
│   After: "Computational..."         │
│   2 minutes ago                     │
│                                     │
│ ✓ Changed SC level: 3 → 4     [⟲]  │
│   "Can break down complex..."       │
│   5 minutes ago                     │
└─────────────────────────────────────┘
```

### Actions

- **[X] Undo** (unsaved changes): Remove from pending, restore to previous state
- **[⟲] Revert** (saved changes): Create reversing change and save

## UI Components

### Index Page Layout

```tsx
<main className="container mx-auto py-8 px-4">
  <header className="flex justify-between items-center mb-8">
    <div>
      <h1 className="text-3xl font-bold">Curriculum Test UI</h1>
      <p className="text-muted-foreground">
        Document-style curriculum editor
      </p>
    </div>
    <Button onClick={handleCreate}>
      <Plus className="mr-2 h-4 w-4" />
      Create New Curriculum
    </Button>
  </header>

  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {curricula.map(curriculum => (
      <Card key={curriculum.curriculum_id}>
        <CardHeader>
          <div className="flex justify-between items-start">
            <CardTitle>{curriculum.title}</CardTitle>
            <Badge variant="secondary">
              {curriculum.subject}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            {curriculum.description}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleEdit(curriculum)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
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
```

### Detail Page Layout

```tsx
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
      onChange={handleMarkdownChange}
      className="flex-1 font-mono text-sm p-4 resize-none border-0 focus-visible:ring-0"
      placeholder="# AO1: Assessment Objective Title&#10;## LO: Learning Objective Title&#10;- Success criterion description [L3]"
      spellCheck={false}
    />

    {parseErrors.length > 0 && (
      <div className="border-t p-2 bg-destructive/10">
        <p className="text-sm text-destructive">
          {parseErrors.length} parse error(s)
        </p>
      </div>
    )}
  </div>

  {/* Right Panel - Changes */}
  <div className="flex-[2] flex flex-col bg-muted/30">
    <header className="border-b p-4 bg-background">
      <div className="flex justify-between items-center">
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
      </div>
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
```

### Component Structure

```
src/app/tests/curriculum/
├── page.tsx                          # Index page (server)
├── curriculum-cards-client.tsx       # Card grid (client)
├── [curriculumId]/
│   ├── page.tsx                      # Detail page (server)
│   └── curriculum-editor-client.tsx  # Split editor (client)
└── _components/
    ├── markdown-editor.tsx           # Textarea with syntax hints
    ├── changes-panel.tsx             # Change tracking display
    ├── change-item.tsx               # Individual change row
    ├── edit-curriculum-sheet.tsx     # Edit properties modal
    └── create-curriculum-sheet.tsx   # Create new curriculum
```

## Data Persistence

### Auto-save Hook

```typescript
function useAutoSave(
  markdown: string,
  curriculumId: string,
  savedStructure: ParsedStructure
) {
  const [pendingChanges, setPendingChanges] = useState<Change[]>([])
  const [savedChanges, setSavedChanges] = useState<Change[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // Detect changes
  useEffect(() => {
    const parsed = parseMarkdown(markdown)
    const changes = detectChanges(savedStructure, parsed)
    setPendingChanges(changes)
  }, [markdown, savedStructure])

  // Auto-save with debounce
  useEffect(() => {
    if (pendingChanges.length === 0) return

    const timer = setTimeout(async () => {
      setIsSaving(true)

      try {
        const parsed = parseMarkdown(markdown)
        const result = await saveCurriculumStructure(curriculumId, parsed)

        if (result.success) {
          // Move pending to saved
          setSavedChanges(prev => [...pendingChanges, ...prev])
          setPendingChanges([])
          setLastSaved(new Date())
          toast.success(`${pendingChanges.length} changes saved`)
        } else {
          toast.error('Save failed: ' + result.error)
        }
      } catch (error) {
        toast.error('Save failed: ' + String(error))
      } finally {
        setIsSaving(false)
      }
    }, 3000) // 3 second debounce

    return () => clearTimeout(timer)
  }, [pendingChanges, markdown, curriculumId])

  return {
    pendingChanges,
    savedChanges,
    isSaving,
    lastSaved
  }
}
```

### Server Action

```typescript
export async function saveCurriculumStructure(
  curriculumId: string,
  structure: ParsedStructure
) {
  "use server"

  try {
    await requireTeacherProfile()

    // Start transaction
    const result = await db.transaction(async (tx) => {
      // 1. Fetch current state
      const current = await readCurriculumDetailAction(curriculumId)

      // 2. Calculate operations
      const ops = calculateOperations(current.data, structure)

      // 3. Execute operations
      // Delete removed items
      for (const op of ops.deletes) {
        if (op.type === 'sc') {
          await tx.delete(success_criteria)
            .where(eq(success_criteria.success_criteria_id, op.id))
        }
        // ... similar for LO and AO
      }

      // Update modified items
      for (const op of ops.updates) {
        if (op.type === 'ao') {
          await tx.update(assessment_objectives)
            .set({ code: op.code, title: op.title, order_index: op.order_index })
            .where(eq(assessment_objectives.assessment_objective_id, op.id))
        }
        // ... similar for LO and SC
      }

      // Insert new items
      for (const op of ops.inserts) {
        if (op.type === 'ao') {
          await tx.insert(assessment_objectives).values({
            curriculum_id: curriculumId,
            code: op.code,
            title: op.title,
            order_index: op.order_index
          })
        }
        // ... similar for LO and SC
      }

      return { success: true }
    })

    revalidatePath(`/tests/curriculum/${curriculumId}`)
    return result
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

## Error Handling

### Parse Errors

Display inline indicators for invalid syntax:

```tsx
<div className="relative">
  <Textarea value={markdown} onChange={handleChange} />

  {parseErrors.map(error => (
    <div
      key={error.line}
      className="absolute left-0 bg-destructive/20"
      style={{ top: `${error.line * 1.5}rem` }}
    >
      <Tooltip>
        <TooltipTrigger>
          <AlertCircle className="h-4 w-4 text-destructive" />
        </TooltipTrigger>
        <TooltipContent>
          Line {error.line}: {error.message}
        </TooltipContent>
      </Tooltip>
    </div>
  ))}
</div>
```

### Save Errors

- Keep changes in pending state
- Show error toast with details
- Retry button in changes panel
- Log error to console for debugging

### Validation

- **AO Code**: Required, max 10 chars
- **Titles**: Required, max 255 chars
- **SC Level**: 1-9 range
- **Hierarchy**: LO must be under AO, SC must be under LO

### Conflict Detection

```typescript
async function detectConflicts(curriculumId: string, lastFetchedAt: Date) {
  const current = await readCurriculumDetailAction(curriculumId)
  const hasConflict = current.data?.modified_at > lastFetchedAt

  if (hasConflict) {
    return {
      conflict: true,
      message: "Curriculum was modified by another user. Reload to see latest?"
    }
  }

  return { conflict: false }
}
```

## Edge Cases

1. **Empty curriculum**: Show template markdown with example structure
2. **Delete all content**: Confirm dialog before clearing
3. **Browser refresh**: Save to localStorage as backup, restore on load
4. **Network offline**: Queue changes, show "offline" indicator, sync when online
5. **Very large curriculum**: Consider pagination or lazy loading for change history
6. **Rapid typing**: Debounce parse to avoid performance issues

## Testing Considerations

### Manual Test Cases

1. **Parse markdown correctly**:
   - Create AO with code and title
   - Create nested LO under AO
   - Create SC with level under LO
   - Handle missing level (defaults to 1)

2. **Change detection**:
   - Add new AO → Shows in "Added"
   - Modify existing title → Shows in "Modified"
   - Delete line → Shows in "Deleted"
   - Reorder items → Shows in "Reordered"

3. **Auto-save**:
   - Type changes → See pending changes
   - Wait 3 seconds → Changes move to saved
   - Verify database updated correctly

4. **Rollback**:
   - Undo pending change → Markdown reverts
   - Revert saved change → New change created

5. **Error handling**:
   - Invalid syntax → Shows warning
   - Save fails → Changes stay pending
   - Network error → Graceful degradation

## Success Criteria

- ✅ Index page displays all curricula as cards
- ✅ Can edit curriculum properties (title, subject, description)
- ✅ Detail page shows split editor layout
- ✅ Markdown syntax correctly parsed into AO/LO/SC structure
- ✅ Changes detected and displayed in right panel
- ✅ Auto-save works with 3-second debounce
- ✅ Can undo unsaved changes
- ✅ Can revert saved changes
- ✅ Parse errors shown with helpful messages
- ✅ Responsive design works on desktop (mobile not required for test UI)

## Future Enhancements (Out of Scope)

- Syntax highlighting in editor
- Autocomplete for AO codes
- Keyboard shortcuts (Ctrl+S to save, Ctrl+Z to undo)
- Export to markdown file
- Import from markdown file
- Collaborative editing (real-time sync)
- Version history with git-like diff view
- Search/filter in change history
