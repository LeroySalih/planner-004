# MCP List & Create Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new tools to the MCP server — one missing list tool (`get_activities_for_lesson`) and six create tools for all primary curriculum entities.

**Architecture:** All helpers use `query()` / `withDbClient()` from `src/lib/db.ts` directly, matching the existing pattern in `src/lib/mcp/`. No server actions are involved (those require `requireTeacherProfile()` which reads session cookies unavailable in MCP context). Tools are registered in `src/app/api/MCP/route.ts` alongside the 7 already there.

**Tech Stack:** TypeScript, Next.js 15 App Router, `@modelcontextprotocol/sdk`, `zod`, `pg` via `src/lib/db.ts`

---

## File Map

| File | Change |
|---|---|
| `src/lib/mcp/curriculum.ts` | Add `createCurriculum()` helper |
| `src/lib/mcp/units.ts` | Add `createUnit()` helper |
| `src/lib/mcp/lessons.ts` | Add `createLesson()` helper |
| `src/lib/mcp/losc.ts` | Add `createLearningObjective()` and `createSuccessCriterion()` helpers |
| `src/lib/mcp/activities.ts` | **New file** — `listActivitiesForLesson()` and `createActivity()` |
| `src/app/api/MCP/route.ts` | Register all 8 new tools |

---

## Task 1: `createCurriculum` helper + tool

**Files:**
- Modify: `src/lib/mcp/curriculum.ts`
- Modify: `src/app/api/MCP/route.ts`

- [ ] **Step 1: Add `createCurriculum` helper to `src/lib/mcp/curriculum.ts`**

Append to the end of the file (after `findCurriculumIdsByTitle`):

```ts
export type CurriculumRecord = {
  curriculum_id: string
  title: string
  subject: string | null
  description: string | null
  is_active: boolean
}

export async function createCurriculum(
  title: string,
  subject?: string | null,
  description?: string | null,
): Promise<CurriculumRecord> {
  const { rows } = await query<{
    curriculum_id: string
    title: string
    subject: string | null
    description: string | null
    active: boolean
  }>(
    `insert into curricula (title, subject, description, active)
     values ($1, $2, $3, true)
     returning curriculum_id, title, subject, description, active`,
    [title.trim(), subject?.trim() ?? null, description?.trim() ?? null],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to create curriculum')
  return {
    curriculum_id: row.curriculum_id,
    title: row.title,
    subject: row.subject,
    description: row.description,
    is_active: row.active,
  }
}
```

- [ ] **Step 2: Register `create_curriculum` tool in `src/app/api/MCP/route.ts`**

Inside `createMcpServer()`, before the closing `return srv`, add:

```ts
srv.registerTool(
  'create_curriculum',
  {
    title: 'Create curriculum',
    description: 'Create a new curriculum. Returns the full created record.',
    inputSchema: {
      title: z.string().min(1).describe('Curriculum title.'),
      subject: z.string().optional().describe('Subject area (e.g. "Computer Science").'),
      description: z.string().optional().describe('Optional description.'),
    },
    outputSchema: {
      curriculum: z.object({
        curriculum_id: z.string(),
        title: z.string(),
        subject: z.string().nullable(),
        description: z.string().nullable(),
        is_active: z.boolean(),
      }).nullable(),
    },
  },
  async ({ title, subject, description }) => {
    try {
      const curriculum = await createCurriculum(title, subject ?? null, description ?? null)
      return {
        content: [{ type: 'text' as const, text: `Created curriculum ${curriculum.curriculum_id} • ${curriculum.title}` }],
        structuredContent: { curriculum },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create curriculum'
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { curriculum: null },
      }
    }
  },
)
```

- [ ] **Step 3: Add `createCurriculum` to the imports in `route.ts`**

The import from `@/lib/mcp/curriculum` already exists. Extend it:

```ts
import {
  listCurriculumSummaries,
  getCurriculumSummary,
  findCurriculumIdsByTitle,
  createCurriculum,
} from '@/lib/mcp/curriculum'
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/leroysalih/nodejs/planner-004/.claude/worktrees/agitated-haibt-9e3996
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to the new code.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/curriculum.ts src/app/api/MCP/route.ts
git commit -m "feat(mcp): add create_curriculum tool"
```

---

## Task 2: `createUnit` helper + tool

**Files:**
- Modify: `src/lib/mcp/units.ts`
- Modify: `src/app/api/MCP/route.ts`

- [ ] **Step 1: Add `createUnit` helper to `src/lib/mcp/units.ts`**

Append after `findUnitsByTitle`:

```ts
export type UnitRecord = {
  unit_id: string
  title: string
  subject: string
  description: string | null
  year: number | null
  is_active: boolean
}

export async function createUnit(
  title: string,
  subject: string,
  description?: string | null,
  year?: number | null,
): Promise<UnitRecord> {
  const sanitizedYear =
    typeof year === 'number' && Number.isFinite(year)
      ? Math.min(Math.max(Math.trunc(year), 1), 13)
      : null

  const { rows } = await query<{
    unit_id: string
    title: string
    subject: string
    description: string | null
    year: number | null
    active: boolean
  }>(
    `insert into units (title, subject, description, year, active)
     values ($1, $2, $3, $4, false)
     returning unit_id, title, subject, description, year, active`,
    [title.trim(), subject.trim(), description?.trim() ?? null, sanitizedYear],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to create unit')
  return {
    unit_id: row.unit_id,
    title: row.title,
    subject: row.subject,
    description: row.description,
    year: row.year,
    is_active: row.active,
  }
}
```

- [ ] **Step 2: Register `create_unit` tool in `route.ts`**

Inside `createMcpServer()`, before the closing `return srv`, add:

```ts
srv.registerTool(
  'create_unit',
  {
    title: 'Create unit',
    description: 'Create a new unit. Units are always created inactive so the teacher can review before activating.',
    inputSchema: {
      title: z.string().min(1).describe('Unit title.'),
      subject: z.string().min(1).describe('Subject area (e.g. "Computer Science").'),
      description: z.string().optional().describe('Optional description.'),
      year: z.number().int().min(1).max(13).optional().describe('Year group (1–13).'),
    },
    outputSchema: {
      unit: z.object({
        unit_id: z.string(),
        title: z.string(),
        subject: z.string(),
        description: z.string().nullable(),
        year: z.number().nullable(),
        is_active: z.boolean(),
      }).nullable(),
    },
  },
  async ({ title, subject, description, year }) => {
    try {
      const unit = await createUnit(title, subject, description ?? null, year ?? null)
      return {
        content: [{ type: 'text' as const, text: `Created unit ${unit.unit_id} • ${unit.title} (inactive — awaiting teacher review)` }],
        structuredContent: { unit },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create unit'
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { unit: null },
      }
    }
  },
)
```

- [ ] **Step 3: Add `createUnit` to imports in `route.ts`**

The import from `@/lib/mcp/units` already exists. Extend it:

```ts
import { listUnits, findUnitsByTitle, createUnit } from '@/lib/mcp/units'
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/units.ts src/app/api/MCP/route.ts
git commit -m "feat(mcp): add create_unit tool (inactive by default)"
```

---

## Task 3: `createLesson` helper + tool

**Files:**
- Modify: `src/lib/mcp/lessons.ts`
- Modify: `src/app/api/MCP/route.ts`

- [ ] **Step 1: Add `withDbClient` import to `src/lib/mcp/lessons.ts`**

The file currently imports only `query`. Change the import:

```ts
import { query, withDbClient } from '@/lib/db'
```

- [ ] **Step 2: Add `createLesson` helper to `src/lib/mcp/lessons.ts`**

Append after `listLessonsForUnit`:

```ts
export type LessonRecord = {
  lesson_id: string
  unit_id: string
  title: string
  is_active: boolean
  order_index: number
}

export async function createLesson(unitId: string, title: string): Promise<LessonRecord> {
  let result: LessonRecord | null = null

  await withDbClient(async (client) => {
    const { rows: maxRows } = await client.query<{ order_by: number }>(
      'select order_by from lessons where unit_id = $1 order by order_by desc nulls last limit 1',
      [unitId],
    )
    const nextOrder = (maxRows[0]?.order_by ?? -1) + 1

    const { rows } = await client.query<{
      lesson_id: string
      unit_id: string
      title: string
      active: boolean
      order_by: number
    }>(
      `insert into lessons (unit_id, title, active, order_by)
       values ($1, $2, true, $3)
       returning lesson_id, unit_id, title, active, order_by`,
      [unitId, title.trim(), nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create lesson')
    result = {
      lesson_id: row.lesson_id,
      unit_id: row.unit_id,
      title: row.title,
      is_active: row.active,
      order_index: row.order_by,
    }
  })

  if (!result) throw new Error('Failed to create lesson')
  return result
}
```

- [ ] **Step 3: Register `create_lesson` tool in `route.ts`**

Inside `createMcpServer()`, before the closing `return srv`, add:

```ts
srv.registerTool(
  'create_lesson',
  {
    title: 'Create lesson',
    description: 'Create a new lesson under a unit. Appended at the end of the unit\'s lesson order.',
    inputSchema: {
      unit_id: z.string().min(1).describe('Unit identifier.'),
      title: z.string().min(1).describe('Lesson title.'),
    },
    outputSchema: {
      lesson: z.object({
        lesson_id: z.string(),
        unit_id: z.string(),
        title: z.string(),
        is_active: z.boolean(),
        order_index: z.number(),
      }).nullable(),
    },
  },
  async ({ unit_id, title }) => {
    try {
      const lesson = await createLesson(unit_id, title)
      return {
        content: [{ type: 'text' as const, text: `Created lesson ${lesson.lesson_id} • ${lesson.title} in unit ${unit_id}` }],
        structuredContent: { lesson },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create lesson'
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { lesson: null },
      }
    }
  },
)
```

- [ ] **Step 4: Add imports in `route.ts`**

The import from `@/lib/mcp/lessons` already exists. Extend it:

```ts
import { listLessonsForUnit, createLesson } from '@/lib/mcp/lessons'
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/lessons.ts src/app/api/MCP/route.ts
git commit -m "feat(mcp): add create_lesson tool"
```

---

## Task 4: `createLearningObjective` + `createSuccessCriterion` helpers + tools

**Files:**
- Modify: `src/lib/mcp/losc.ts`
- Modify: `src/app/api/MCP/route.ts`

- [ ] **Step 1: Add `withDbClient` import to `src/lib/mcp/losc.ts`**

Change the existing import:

```ts
import { query, withDbClient } from '@/lib/db'
```

- [ ] **Step 2: Add `createLearningObjective` helper to `src/lib/mcp/losc.ts`**

Append after `fetchCurriculumLosc`:

```ts
export type LearningObjectiveRecord = {
  learning_objective_id: string
  assessment_objective_id: string
  title: string
  spec_ref: string | null
  active: boolean
  order_index: number
}

export async function createLearningObjective(
  assessmentObjectiveId: string,
  title: string,
  specRef?: string | null,
): Promise<LearningObjectiveRecord> {
  let result: LearningObjectiveRecord | null = null

  await withDbClient(async (client) => {
    const { rows: existsRows } = await client.query<{ assessment_objective_id: string }>(
      'select assessment_objective_id from assessment_objectives where assessment_objective_id = $1 limit 1',
      [assessmentObjectiveId],
    )
    if (!existsRows[0]) throw new Error(`Assessment objective ${assessmentObjectiveId} not found`)

    const { rows: maxRows } = await client.query<{ order_index: number }>(
      'select order_index from learning_objectives where assessment_objective_id = $1 order by order_index desc nulls last limit 1',
      [assessmentObjectiveId],
    )
    const nextOrder = (maxRows[0]?.order_index ?? -1) + 1

    const { rows } = await client.query<{
      learning_objective_id: string
      assessment_objective_id: string
      title: string
      spec_ref: string | null
      active: boolean
      order_index: number
    }>(
      `insert into learning_objectives (assessment_objective_id, title, spec_ref, active, order_index)
       values ($1, $2, $3, true, $4)
       returning learning_objective_id, assessment_objective_id, title, spec_ref, active, order_index`,
      [assessmentObjectiveId, title.trim(), specRef?.trim() ?? null, nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create learning objective')
    result = {
      learning_objective_id: row.learning_objective_id,
      assessment_objective_id: row.assessment_objective_id,
      title: row.title,
      spec_ref: row.spec_ref,
      active: row.active,
      order_index: row.order_index,
    }
  })

  if (!result) throw new Error('Failed to create learning objective')
  return result
}
```

- [ ] **Step 3: Add `createSuccessCriterion` helper to `src/lib/mcp/losc.ts`**

Append after `createLearningObjective`:

```ts
export type SuccessCriterionRecord = {
  success_criteria_id: string
  learning_objective_id: string
  description: string
  level: number
  order_index: number
  active: boolean
}

export async function createSuccessCriterion(
  learningObjectiveId: string,
  description: string,
  level: number,
): Promise<SuccessCriterionRecord> {
  let result: SuccessCriterionRecord | null = null

  await withDbClient(async (client) => {
    const { rows: existsRows } = await client.query<{ learning_objective_id: string }>(
      'select learning_objective_id from learning_objectives where learning_objective_id = $1 limit 1',
      [learningObjectiveId],
    )
    if (!existsRows[0]) throw new Error(`Learning objective ${learningObjectiveId} not found`)

    const { rows: maxRows } = await client.query<{ order_index: number }>(
      'select order_index from success_criteria where learning_objective_id = $1 order by order_index desc nulls last limit 1',
      [learningObjectiveId],
    )
    const nextOrder = (maxRows[0]?.order_index ?? -1) + 1

    const { rows } = await client.query<{
      success_criteria_id: string
      learning_objective_id: string
      description: string
      level: number
      order_index: number
      active: boolean
    }>(
      `insert into success_criteria (learning_objective_id, description, level, order_index, active)
       values ($1, $2, $3, $4, true)
       returning success_criteria_id, learning_objective_id, description, level, order_index, active`,
      [learningObjectiveId, description.trim(), level, nextOrder],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create success criterion')
    result = {
      success_criteria_id: row.success_criteria_id,
      learning_objective_id: row.learning_objective_id,
      description: row.description,
      level: row.level,
      order_index: row.order_index,
      active: row.active,
    }
  })

  if (!result) throw new Error('Failed to create success criterion')
  return result
}
```

- [ ] **Step 4: Register `create_learning_objective` tool in `route.ts`**

Inside `createMcpServer()`, before the closing `return srv`, add:

```ts
srv.registerTool(
  'create_learning_objective',
  {
    title: 'Create learning objective',
    description: 'Create a new learning objective under an assessment objective.',
    inputSchema: {
      assessment_objective_id: z.string().min(1).describe('Assessment objective identifier.'),
      title: z.string().min(1).describe('Learning objective title.'),
      spec_ref: z.string().optional().describe('Optional specification reference.'),
    },
    outputSchema: {
      learning_objective: z.object({
        learning_objective_id: z.string(),
        assessment_objective_id: z.string(),
        title: z.string(),
        spec_ref: z.string().nullable(),
        active: z.boolean(),
        order_index: z.number(),
      }).nullable(),
    },
  },
  async ({ assessment_objective_id, title, spec_ref }) => {
    try {
      const learning_objective = await createLearningObjective(assessment_objective_id, title, spec_ref ?? null)
      return {
        content: [{ type: 'text' as const, text: `Created learning objective ${learning_objective.learning_objective_id} • ${learning_objective.title}` }],
        structuredContent: { learning_objective },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create learning objective'
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { learning_objective: null },
      }
    }
  },
)
```

- [ ] **Step 5: Register `create_success_criterion` tool in `route.ts`**

Inside `createMcpServer()`, before the closing `return srv`, add:

```ts
srv.registerTool(
  'create_success_criterion',
  {
    title: 'Create success criterion',
    description: 'Create a new success criterion under a learning objective.',
    inputSchema: {
      learning_objective_id: z.string().min(1).describe('Learning objective identifier.'),
      description: z.string().min(1).describe('Success criterion description.'),
      level: z.number().int().min(1).max(9).describe('Level (1–9).'),
    },
    outputSchema: {
      success_criterion: z.object({
        success_criteria_id: z.string(),
        learning_objective_id: z.string(),
        description: z.string(),
        level: z.number(),
        order_index: z.number(),
        active: z.boolean(),
      }).nullable(),
    },
  },
  async ({ learning_objective_id, description, level }) => {
    try {
      const success_criterion = await createSuccessCriterion(learning_objective_id, description, level)
      return {
        content: [{ type: 'text' as const, text: `Created success criterion ${success_criterion.success_criteria_id} (level ${success_criterion.level})` }],
        structuredContent: { success_criterion },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create success criterion'
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { success_criterion: null },
      }
    }
  },
)
```

- [ ] **Step 6: Add imports in `route.ts`**

The import from `@/lib/mcp/losc` already exists. Extend it:

```ts
import {
  fetchCurriculumLosc,
  createLearningObjective,
  createSuccessCriterion,
} from '@/lib/mcp/losc'
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/losc.ts src/app/api/MCP/route.ts
git commit -m "feat(mcp): add create_learning_objective and create_success_criterion tools"
```

---

## Task 5: `activities.ts` — list + create helpers + both tools

**Files:**
- Create: `src/lib/mcp/activities.ts`
- Modify: `src/app/api/MCP/route.ts`

- [ ] **Step 1: Create `src/lib/mcp/activities.ts`**

```ts
import { query, withDbClient } from '@/lib/db'
import { SCORABLE_ACTIVITY_TYPES, NON_SCORABLE_ACTIVITY_TYPES } from '@/dino.config'

export const ACTIVITY_TYPES = [...SCORABLE_ACTIVITY_TYPES, ...NON_SCORABLE_ACTIVITY_TYPES] as const
export type ActivityType = typeof ACTIVITY_TYPES[number]

export type ActivitySummary = {
  activity_id: string
  lesson_id: string
  title: string | null
  type: string
  order_index: number | null
  is_summative: boolean
  active: boolean
}

export async function listActivitiesForLesson(lessonId: string): Promise<ActivitySummary[]> {
  const { rows } = await query<{
    activity_id: string
    lesson_id: string
    title: string | null
    type: string
    order_by: number | null
    is_summative: boolean
    active: boolean
  }>(
    `select activity_id, lesson_id, title, type, order_by, is_summative, active
     from activities
     where lesson_id = $1 and active = true
     order by order_by asc nulls last, title asc`,
    [lessonId],
  )

  return (rows ?? []).map((row) => ({
    activity_id: row.activity_id,
    lesson_id: row.lesson_id,
    title: row.title,
    type: row.type,
    order_index: row.order_by,
    is_summative: row.is_summative ?? false,
    active: row.active ?? true,
  }))
}

export async function createActivity(
  lessonId: string,
  type: ActivityType,
  title?: string | null,
  bodyData?: unknown,
  isSummative?: boolean,
): Promise<ActivitySummary> {
  const isScorableType = (SCORABLE_ACTIVITY_TYPES as readonly string[]).includes(type)

  if (isSummative && !isScorableType) {
    throw new Error('Only scorable activity types can be marked as summative')
  }

  const effectiveIsSummative = isScorableType ? (isSummative ?? false) : false

  let result: ActivitySummary | null = null

  await withDbClient(async (client) => {
    const { rows: maxRows } = await client.query<{ order_by: number }>(
      'select order_by from activities where lesson_id = $1 order by order_by desc nulls last limit 1',
      [lessonId],
    )
    const nextOrder = (maxRows[0]?.order_by ?? -1) + 1

    const { rows } = await client.query<{
      activity_id: string
      lesson_id: string
      title: string | null
      type: string
      order_by: number | null
      is_summative: boolean
      active: boolean
    }>(
      `insert into activities (lesson_id, title, type, body_data, is_summative, order_by, active)
       values ($1, $2, $3, $4, $5, $6, true)
       returning activity_id, lesson_id, title, type, order_by, is_summative, active`,
      [
        lessonId,
        title?.trim() ?? null,
        type,
        bodyData != null ? JSON.stringify(bodyData) : null,
        effectiveIsSummative,
        nextOrder,
      ],
    )
    const row = rows[0]
    if (!row) throw new Error('Failed to create activity')
    result = {
      activity_id: row.activity_id,
      lesson_id: row.lesson_id,
      title: row.title,
      type: row.type,
      order_index: row.order_by,
      is_summative: row.is_summative ?? false,
      active: row.active ?? true,
    }
  })

  if (!result) throw new Error('Failed to create activity')
  return result
}
```

- [ ] **Step 2: Register `get_activities_for_lesson` tool in `route.ts`**

Add this import at the top of `route.ts` alongside the other mcp imports:

```ts
import { ACTIVITY_TYPES, listActivitiesForLesson, createActivity } from '@/lib/mcp/activities'
```

Inside `createMcpServer()`, before the closing `return srv`, add:

```ts
srv.registerTool(
  'get_activities_for_lesson',
  {
    title: 'List activities for a lesson',
    description: 'Return all active activities for a given lesson.',
    inputSchema: {
      lesson_id: z.string().min(1).describe('Lesson identifier.'),
    },
    outputSchema: {
      activities: z.array(z.object({
        activity_id: z.string(),
        lesson_id: z.string(),
        title: z.string().nullable(),
        type: z.string(),
        order_index: z.number().nullable(),
        is_summative: z.boolean(),
        active: z.boolean(),
      })),
    },
  },
  async ({ lesson_id }) => {
    const activities = await listActivitiesForLesson(lesson_id)
    return {
      content: [
        {
          type: 'text' as const,
          text: activities.length > 0
            ? activities.map((a) => `${a.activity_id} • ${a.type}${a.title ? ` — ${a.title}` : ''}`).join('\n')
            : `No activities found for lesson ${lesson_id}.`,
        },
      ],
      structuredContent: { activities },
    }
  },
)
```

- [ ] **Step 3: Register `create_activity` tool in `route.ts`**

Inside `createMcpServer()`, before the closing `return srv`, add:

```ts
srv.registerTool(
  'create_activity',
  {
    title: 'Create activity',
    description: 'Create a new activity under a lesson.',
    inputSchema: {
      lesson_id: z.string().min(1).describe('Lesson identifier.'),
      type: z.enum(ACTIVITY_TYPES).describe(
        'Activity type. Scorable: multiple-choice-question, short-text-question, text-question, long-text-question, upload-file, upload-url, feedback, sketch-render, do-flashcards. Non-scorable: text, display-image, display-flashcards, file-download, show-video, voice, share-my-work, review-others-work, display-section.',
      ),
      title: z.string().optional().describe('Optional activity title.'),
      body_data: z.record(z.unknown()).optional().describe('Optional activity body JSON.'),
      is_summative: z.boolean().optional().describe('Mark as summative assessment (scorable types only).'),
    },
    outputSchema: {
      activity: z.object({
        activity_id: z.string(),
        lesson_id: z.string(),
        title: z.string().nullable(),
        type: z.string(),
        order_index: z.number().nullable(),
        is_summative: z.boolean(),
        active: z.boolean(),
      }).nullable(),
    },
  },
  async ({ lesson_id, type, title, body_data, is_summative }) => {
    try {
      const activity = await createActivity(lesson_id, type, title ?? null, body_data ?? null, is_summative)
      return {
        content: [{ type: 'text' as const, text: `Created activity ${activity.activity_id} • ${activity.type}${activity.title ? ` — ${activity.title}` : ''}` }],
        structuredContent: { activity },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create activity'
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent: { activity: null },
      }
    }
  },
)
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/activities.ts src/app/api/MCP/route.ts
git commit -m "feat(mcp): add get_activities_for_lesson and create_activity tools"
```

---

## Task 6: End-to-end smoke test

**Files:** None modified

The MCP server requires `MCP_SERVICE_KEY` for auth. The key is in `.env` at the project root. The dev server runs on port 3000 (main worktree). If using this worktree's own server, check the port it was started on.

- [ ] **Step 1: Confirm the dev server is running**

```bash
curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"status","arguments":{}}}' | jq .
```

Expected: `{"result":{"content":[{"type":"text","text":"ok"}],...}}`

- [ ] **Step 2: Smoke test `create_curriculum`**

```bash
curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_curriculum","arguments":{"title":"Test Curriculum MCP","subject":"Computer Science"}}}' | jq .result.structuredContent
```

Expected: `{ curriculum: { curriculum_id: "...", title: "Test Curriculum MCP", is_active: true, ... } }`

- [ ] **Step 3: Smoke test `create_unit` (must be inactive)**

```bash
curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_unit","arguments":{"title":"Test Unit MCP","subject":"Computer Science"}}}' | jq .result.structuredContent
```

Expected: `{ unit: { unit_id: "...", title: "Test Unit MCP", is_active: false, ... } }`  
**Verify `is_active` is `false`.**

- [ ] **Step 4: Smoke test `create_lesson`**

Use a real `unit_id` from `get_all_units` first:

```bash
# Get a unit_id
UNIT_ID=$(curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_all_units","arguments":{}}}' | jq -r '.result.structuredContent.units[0].unit_id')

echo "Using unit_id: $UNIT_ID"

curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"create_lesson\",\"arguments\":{\"unit_id\":\"$UNIT_ID\",\"title\":\"Test Lesson MCP\"}}}" | jq .result.structuredContent
```

Expected: `{ lesson: { lesson_id: "...", unit_id: "...", title: "Test Lesson MCP", is_active: true, ... } }`

- [ ] **Step 5: Smoke test `get_activities_for_lesson`**

Use a real `lesson_id`:

```bash
LESSON_ID=$(curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"get_lessons_for_unit\",\"arguments\":{\"unit_id\":\"$UNIT_ID\"}}}" | jq -r '.result.structuredContent.lessons[0].lesson_id')

echo "Using lesson_id: $LESSON_ID"

curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"get_activities_for_lesson\",\"arguments\":{\"lesson_id\":\"$LESSON_ID\"}}}" | jq .result.structuredContent
```

Expected: `{ activities: [...] }` (empty array or populated, no error).

- [ ] **Step 6: Smoke test `create_activity`**

```bash
curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"create_activity\",\"arguments\":{\"lesson_id\":\"$LESSON_ID\",\"type\":\"text\",\"title\":\"Test Activity MCP\"}}}" | jq .result.structuredContent
```

Expected: `{ activity: { activity_id: "...", type: "text", title: "Test Activity MCP", is_summative: false, ... } }`

- [ ] **Step 7: Smoke test `create_learning_objective`**

Get an `assessment_objective_id` first:

```bash
CURRICULUM_ID=$(curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_all_curriculum","arguments":{}}}' | jq -r '.result.structuredContent.curricula[0].curriculum_id')

# DATABASE_URL is in .env at the project root — source it or substitute inline
AO_ID=$(psql "$(grep DATABASE_URL /Users/leroysalih/nodejs/planner-004/.env | cut -d= -f2-)" -t -c "select assessment_objective_id from assessment_objectives where curriculum_id = '$CURRICULUM_ID' limit 1" | tr -d ' ')

echo "Using assessment_objective_id: $AO_ID"

curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"create_learning_objective\",\"arguments\":{\"assessment_objective_id\":\"$AO_ID\",\"title\":\"Test LO MCP\"}}}" | jq .result.structuredContent
```

Expected: `{ learning_objective: { learning_objective_id: "...", title: "Test LO MCP", active: true, ... } }`

- [ ] **Step 8: Smoke test `create_success_criterion`**

```bash
LO_ID=$(curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"get_all_los_and_scs_for_curriculum\",\"arguments\":{\"curriculum_id\":\"$CURRICULUM_ID\"}}}" | jq -r '.result.structuredContent.learning_objectives[0].learning_objective_id')

echo "Using learning_objective_id: $LO_ID"

curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"create_success_criterion\",\"arguments\":{\"learning_objective_id\":\"$LO_ID\",\"description\":\"Test SC MCP\",\"level\":3}}}" | jq .result.structuredContent
```

Expected: `{ success_criterion: { success_criteria_id: "...", description: "Test SC MCP", level: 3, ... } }`

- [ ] **Step 9: Verify `is_summative` guard — expect error**

```bash
curl -s http://localhost:3000/api/MCP \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d34fbb682f8122158332f93c88f318c7db3ba48c" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",\"params\":{\"name\":\"create_activity\",\"arguments\":{\"lesson_id\":\"$LESSON_ID\",\"type\":\"text\",\"is_summative\":true}}}" | jq .result.content[0].text
```

Expected: `"Only scorable activity types can be marked as summative"`

- [ ] **Step 10: Run lint**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: no new errors.
