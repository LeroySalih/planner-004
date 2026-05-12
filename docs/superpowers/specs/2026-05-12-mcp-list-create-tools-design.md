# MCP List & Create Tools — Design Spec

**Date:** 2026-05-12  
**Status:** Approved

## Overview

Extend the existing MCP server (`/api/MCP`) with 8 new tools: one missing read tool (`get_activities_for_lesson`) and six create tools covering all primary curriculum entities. All helpers follow the existing pattern of direct `query()` calls in `src/lib/mcp/` domain files, authenticated via `verifyMcpAuthorization` — no Next.js session required.

## Current State

The MCP server at `src/app/api/MCP/route.ts` already exposes 7 tools:

| Tool | Purpose |
|---|---|
| `get_all_curriculum` | List all curricula |
| `get_curriculum` | Get curriculum by ID |
| `get_curriculum_id_from_title` | Find curricula by title pattern |
| `get_all_los_and_scs_for_curriculum` | LO+SC tree for a curriculum |
| `get_all_units` | List all units |
| `get_unit_by_title` | Find units by title pattern |
| `get_lessons_for_unit` | List lessons for a unit |
| `status` | Health probe |

## New Tools (8)

| Tool | Action |
|---|---|
| `get_activities_for_lesson` | List activities for a lesson |
| `create_curriculum` | Create a new curriculum |
| `create_unit` | Create a new unit (always `active = false`) |
| `create_lesson` | Create a lesson under a unit |
| `create_learning_objective` | Create an LO under an assessment objective |
| `create_success_criterion` | Create an SC under a learning objective |
| `create_activity` | Create an activity under a lesson |

## Architecture

### Approach

Option A: extend existing MCP lib domain files with write helpers. All helpers call `query()` / `withDbClient()` from `src/lib/db.ts` directly — same pattern as existing read helpers. No server action involvement (those require `requireTeacherProfile()` which reads session cookies unavailable in MCP context).

### Files Changed

| File | Change |
|---|---|
| `src/lib/mcp/curriculum.ts` | Add `createCurriculum()` |
| `src/lib/mcp/units.ts` | Add `createUnit()` |
| `src/lib/mcp/lessons.ts` | New file — `createLesson()` (listLessonsForUnit already exists and stays in its current file) |
| `src/lib/mcp/losc.ts` | Add `createLearningObjective()`, `createSuccessCriterion()` |
| `src/lib/mcp/activities.ts` | New file — `listActivitiesForLesson()`, `createActivity()` |
| `src/app/api/MCP/route.ts` | Register all 8 new tools |

## Helper Signatures

### `src/lib/mcp/curriculum.ts`
```ts
createCurriculum(
  title: string,
  subject?: string | null,
  description?: string | null,
): Promise<{ curriculum_id: string; title: string; subject: string | null; description: string | null; is_active: boolean }>
```

### `src/lib/mcp/units.ts`
```ts
createUnit(
  title: string,
  subject: string,
  description?: string | null,
  year?: number | null,
): Promise<{ unit_id: string; title: string; subject: string; description: string | null; year: number | null; is_active: boolean }>
// always inserts active = false
```

### `src/lib/mcp/lessons.ts` (new file)
```ts
createLesson(
  unitId: string,
  title: string,
): Promise<{ lesson_id: string; unit_id: string; title: string; is_active: boolean; order_index: number }>
// order_by = max(order_by) + 1, active = true, computed inside withDbClient
```

### `src/lib/mcp/losc.ts`
```ts
createLearningObjective(
  assessmentObjectiveId: string,
  title: string,
  specRef?: string | null,
): Promise<{ learning_objective_id: string; assessment_objective_id: string; title: string; spec_ref: string | null; active: boolean; order_index: number }>

createSuccessCriterion(
  learningObjectiveId: string,
  description: string,
  level: number,  // 1–9, validated by Zod input schema
): Promise<{ success_criteria_id: string; learning_objective_id: string; description: string; level: number; order_index: number; active: boolean }>
```

### `src/lib/mcp/activities.ts` (new file)
```ts
type ActivityType =
  | "multiple-choice-question" | "short-text-question" | "text-question"
  | "long-text-question" | "upload-file" | "upload-url" | "feedback"
  | "sketch-render" | "do-flashcards"           // scorable
  | "text" | "display-image" | "display-flashcards" | "file-download"
  | "show-video" | "voice" | "share-my-work" | "review-others-work"
  | "display-section"                           // non-scorable

listActivitiesForLesson(
  lessonId: string,
): Promise<ActivitySummary[]>

createActivity(
  lessonId: string,
  type: ActivityType,
  title?: string | null,
  bodyData?: unknown,
  isSummative?: boolean,
): Promise<ActivitySummary>
```

## Key Behaviours

- **Units created inactive**: `create_unit` always inserts `active = false`. The teacher must activate via the app UI after review.
- **Activity type enum**: Constrained at the Zod input schema level to the 18 types in `dino.config.ts`. Unknown types are rejected before hitting the DB.
- **`isSummative` guard**: If `isSummative = true` is passed for a non-scorable type, the tool returns an explicit error (`"Only scorable activity types can be marked as summative"`) without touching the DB.
- **`order_by` for lessons and activities**: Computed as `MAX(order_by) + 1` within a `withDbClient` transaction to avoid races.
- **`order_index` for LOs and SCs**: Same MAX+1 pattern.

## Tool Input/Output Contract

Each tool follows the existing MCP pattern:
- `inputSchema`: Zod object with required + optional fields
- `outputSchema`: Zod object with the full inserted record
- On success: `content[0].text` = human-readable summary; `structuredContent` = full record
- On error: `content[0].text` = descriptive error message; `structuredContent` = `{ <entity>: null }`

## Error Handling

| Case | Behaviour |
|---|---|
| Parent not found (e.g. bad `assessment_objective_id`) | Tool returns error text, null structured content — no DB write |
| Zod validation failure (bad level, unknown type) | Rejected at input schema parse, before DB |
| `isSummative` on non-scorable type | Explicit error message returned |
| DB error | Helper throws; `route.ts` catch block returns `500` with JSON-RPC internal error |
| Successful create | Full inserted record in `structuredContent`, summary in `content[0].text` |

## Out of Scope

- Update / delete tools (not requested)
- Activating units via MCP (teacher does this in the app)
- Attaching success criteria to lessons or activities at create time
- Any changes to the legacy REST MCP endpoints (`/api/MCP/curriculum`, `/api/MCP/losc`)
