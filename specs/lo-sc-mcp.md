# MCP Tools for Learning Objectives & Success Criteria Management

This specification defines the MCP server tools required to create, read, update, delete, and assign Learning Objectives (LOs) and Success Criteria (SCs) to curricula and lessons. It covers the database schema, data relationships, validation rules, existing patterns, and the exact tool contracts an MCP tool developer needs to implement.

## Table of Contents

1. [Context & Goals](#context--goals)
2. [Data Hierarchy](#data-hierarchy)
3. [Database Schema](#database-schema)
4. [Referential Integrity & Cascade Rules](#referential-integrity--cascade-rules)
5. [Existing MCP Server Architecture](#existing-mcp-server-architecture)
6. [Existing Read-Only Tools](#existing-read-only-tools)
7. [New Tools to Implement](#new-tools-to-implement)
8. [Tool Specifications](#tool-specifications)
9. [Validation Rules](#validation-rules)
10. [Error Handling Patterns](#error-handling-patterns)
11. [Data Flow Examples](#data-flow-examples)
12. [Implementation Notes](#implementation-notes)

---

## Context & Goals

The planner app manages curricula for education. The MCP server (`MCP/src/server.ts`) currently exposes **read-only** tools for browsing curricula, LOs, SCs, units, and lessons. This spec adds **write tools** so that an MCP client (e.g. an AI agent) can:

- Create, update, and delete Learning Objectives within Assessment Objectives
- Create, update, and delete Success Criteria within Learning Objectives
- Link/unlink Success Criteria to units
- Link/unlink Success Criteria to lessons
- Link/unlink Learning Objectives to lessons
- Reorder LOs and SCs within their parent containers

---

## Data Hierarchy

```
Curriculum
└── Assessment Objective (AO)
    └── Learning Objective (LO)           ← target of this spec
        └── Success Criterion (SC)        ← target of this spec
            ├── Unit Links (many-to-many via success_criteria_units)
            ├── Lesson Links (many-to-many via lesson_success_criteria)
            └── Activity Links (many-to-many via activity_success_criteria)

Lesson
├── Lesson → LO links (lessons_learning_objective)
└── Lesson → SC links (lesson_success_criteria)
```

### Key Concepts

| Entity | Description |
|--------|-------------|
| **Curriculum** | Top-level subject container (e.g. "Computing GCSE") |
| **Assessment Objective (AO)** | High-level goal within a curriculum (e.g. "AO1: Computational Thinking") |
| **Learning Objective (LO)** | Specific outcome under an AO |
| **Success Criterion (SC)** | Measurable statement defining student achievement, leveled 1-9 |
| **Unit** | Teaching unit; SCs can be tagged to multiple units |
| **Lesson** | Lesson within a unit; can be linked to SCs and LOs |

---

## Database Schema

### `learning_objectives`

```sql
CREATE TABLE public.learning_objectives (
    learning_objective_id text DEFAULT gen_random_uuid() NOT NULL,
    assessment_objective_id text NOT NULL,
    title text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    spec_ref text,          -- optional reference to external specification
    sub_item_id text        -- optional reference to sub-items
);
-- PK: learning_objective_id
-- FK: assessment_objective_id → assessment_objectives(assessment_objective_id)
```

### `success_criteria`

```sql
CREATE TABLE public.success_criteria (
    success_criteria_id text DEFAULT gen_random_uuid() NOT NULL,
    learning_objective_id text NOT NULL,
    level integer DEFAULT 1 NOT NULL,    -- range 1-9
    description text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true
);
-- PK: success_criteria_id
-- FK: learning_objective_id → learning_objectives(learning_objective_id)
```

### `success_criteria_units` (join table)

```sql
CREATE TABLE public.success_criteria_units (
    success_criteria_id text NOT NULL,
    unit_id text NOT NULL
);
-- Composite PK: (success_criteria_id, unit_id)
-- FK: success_criteria_id → success_criteria(success_criteria_id)
-- FK: unit_id → units(unit_id)
```

### `lesson_success_criteria` (join table)

```sql
CREATE TABLE public.lesson_success_criteria (
    lesson_id text NOT NULL,
    success_criteria_id text NOT NULL
);
-- Composite PK: (lesson_id, success_criteria_id)
-- FK: lesson_id → lessons(lesson_id)
-- FK: success_criteria_id → success_criteria(success_criteria_id) ON DELETE CASCADE
```

### `lessons_learning_objective` (join table)

```sql
CREATE TABLE public.lessons_learning_objective (
    learning_objective_id text NOT NULL,
    lesson_id text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    active boolean DEFAULT true,
    order_by integer NOT NULL
);
-- FK: learning_objective_id → learning_objectives(learning_objective_id)
-- FK: lesson_id → lessons(lesson_id)
```

### `activity_success_criteria` (join table)

```sql
CREATE TABLE public.activity_success_criteria (
    activity_id text NOT NULL,
    success_criteria_id text NOT NULL
);
-- Composite PK: (activity_id, success_criteria_id)
-- FK: activity_id → activities(activity_id)
-- FK: success_criteria_id → success_criteria(success_criteria_id) ON DELETE RESTRICT
```

### `feedback` (depends on SC)

```sql
CREATE TABLE public.feedback (
    id integer NOT NULL,          -- auto-increment
    user_id text NOT NULL,
    lesson_id text NOT NULL,
    success_criteria_id text NOT NULL,  -- FK with ON DELETE CASCADE
    rating integer NOT NULL
);
```

### Supporting Tables (read-only context)

#### `curricula`

```sql
CREATE TABLE public.curricula (
    curriculum_id text DEFAULT gen_random_uuid() NOT NULL,
    subject text,
    title text NOT NULL,
    description text,
    active boolean DEFAULT true
);
```

#### `assessment_objectives`

```sql
CREATE TABLE public.assessment_objectives (
    assessment_objective_id text DEFAULT gen_random_uuid() NOT NULL,
    curriculum_id text,
    unit_id text,
    code text NOT NULL,        -- short code e.g. "AO1" (max 10 chars)
    title text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL
);
-- FK: curriculum_id → curricula(curriculum_id)
-- Unique: (curriculum_id, code)
```

#### `lessons`

```sql
CREATE TABLE public.lessons (
    lesson_id text DEFAULT gen_random_uuid() NOT NULL,
    unit_id text NOT NULL,
    title text NOT NULL,
    active boolean DEFAULT true,
    order_by integer NOT NULL
);
-- FK: unit_id → units(unit_id)
```

#### `units`

```sql
CREATE TABLE public.units (
    unit_id text DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    active boolean DEFAULT true
    -- additional fields omitted for brevity
);
```

---

## Referential Integrity & Cascade Rules

Understanding cascade behaviour is critical for delete operations:

| FK Relationship | ON DELETE |
|-----------------|-----------|
| `success_criteria.learning_objective_id` → `learning_objectives` | CASCADE (deleting LO deletes its SCs) |
| `success_criteria_units.success_criteria_id` → `success_criteria` | CASCADE (deleting SC removes unit links) |
| `lesson_success_criteria.success_criteria_id` → `success_criteria` | CASCADE (deleting SC removes lesson links) |
| `feedback.success_criteria_id` → `success_criteria` | CASCADE (deleting SC removes student feedback) |
| `activity_success_criteria.success_criteria_id` → `success_criteria` | **RESTRICT** (cannot delete SC if assigned to activities) |

### Deletion Safety

- **Deleting a Learning Objective** cascades through to its Success Criteria, which cascades through to unit links, lesson links, and feedback. Activity links will **block** the delete if any SC is assigned to an activity.
- **Deleting a Success Criterion** cascades to unit links, lesson links, and feedback. Will be **blocked** if the SC is assigned to an activity.
- Always check activity usage before deletion. Use the existing `checkSuccessCriteriaUsageAction` pattern or query `activity_success_criteria` directly.

---

## Existing MCP Server Architecture

### Server Setup

- **Entry point**: `MCP/src/server.ts`
- **Framework**: Express 5 + `@modelcontextprotocol/sdk` (StreamableHTTPServerTransport)
- **Database**: Supabase client (`MCP/src/supabase.ts`) using service role key
- **Port**: `MCP_PORT` env (default 4545)
- **Route**: `MCP_ROUTE` env (default `/mcp`)
- **Auth**: Optional `x-mcp-service-key` header

### Service Layer Pattern

Each tool has a corresponding service function in `MCP/src/services/`. Services:
1. Get the Supabase client via `getSupabaseServiceClient()`
2. Execute queries using the Supabase query builder
3. Throw descriptive errors on failure
4. Return typed objects (never raw Supabase responses)

### Tool Registration Pattern

```typescript
server.registerTool(
  'tool_name',
  {
    title: 'Human-readable title',
    description: 'What the tool does',
    inputSchema: {
      field_name: z.string().min(1).describe('Field description')
    },
    outputSchema: {
      field_name: z.string().describe('Return field description')
    }
  },
  async ({ field_name }) => {
    const result = await serviceFunction(field_name);
    return {
      content: [{ type: 'text', text: 'Human-readable summary' }],
      structuredContent: { field_name: result }
    };
  }
);
```

### Return Format

Every tool handler returns:

```typescript
{
  content: [{ type: 'text', text: string }],        // human-readable summary
  structuredContent: { ... },                        // machine-readable payload
  isError?: boolean                                  // set true on failure
}
```

### Existing Zod Schemas (MCP server.ts)

```typescript
const successCriterionSchema = z.object({
  success_criteria_id: z.string(),
  title: z.string(),          // maps to description column
  active: z.boolean(),
  order_index: z.number()
});

const learningObjectiveSchema = z.object({
  learning_objective_id: z.string(),
  title: z.string(),
  active: z.boolean(),
  spec_ref: z.string().nullable(),
  order_index: z.number(),
  scs: z.array(successCriterionSchema)
});
```

> **Note**: The existing MCP SC schema uses `title` rather than `description` for the criterion text. New write tools should accept `description` (matching the database column) but the read return shape can continue using `title` for backward compatibility, or be updated to use `description`.

---

## Existing Read-Only Tools

These tools already exist and do NOT need to be re-implemented:

| Tool | Purpose |
|------|---------|
| `get_all_curriculum` | List all curricula (id, title, active) |
| `get_curriculum` | Get one curriculum by ID |
| `get_curriculum_id_from_title` | Search curricula by title pattern |
| `get_all_los_and_scs_for_curriculum` | Full LO→SC tree for a curriculum |
| `get_all_units` | List all units |
| `get_unit_by_title` | Search units by title pattern |
| `get_lessons_for_unit` | List lessons for a unit |
| `status` | Health check |

---

## New Tools to Implement

### Learning Objective Tools

| Tool Name | Operation | Description |
|-----------|-----------|-------------|
| `create_learning_objective` | INSERT | Create LO under an Assessment Objective |
| `update_learning_objective` | UPDATE | Update LO title, spec_ref, active status |
| `delete_learning_objective` | DELETE | Delete LO and cascade to SCs (blocked if SCs are on activities) |
| `reorder_learning_objectives` | UPDATE | Set order_index for all LOs under an AO |

### Success Criteria Tools

| Tool Name | Operation | Description |
|-----------|-----------|-------------|
| `create_success_criterion` | INSERT | Create SC under a Learning Objective, with optional unit links |
| `update_success_criterion` | UPDATE | Update SC description, level, active, and unit links |
| `delete_success_criterion` | DELETE | Delete SC (blocked if assigned to activities) |
| `reorder_success_criteria` | UPDATE | Set order_index for all SCs under an LO |

### Lesson Assignment Tools

| Tool Name | Operation | Description |
|-----------|-----------|-------------|
| `link_lesson_success_criterion` | INSERT | Assign an SC to a lesson |
| `unlink_lesson_success_criterion` | DELETE | Remove an SC from a lesson |
| `list_lesson_success_criteria` | SELECT | List SCs assigned to a lesson |
| `link_lesson_learning_objective` | INSERT | Assign an LO to a lesson |
| `unlink_lesson_learning_objective` | DELETE | Remove an LO from a lesson |

### Utility Tools

| Tool Name | Operation | Description |
|-----------|-----------|-------------|
| `check_success_criteria_usage` | SELECT | Check if SCs are assigned to activities (pre-delete safety check) |

---

## Tool Specifications

### `create_learning_objective`

Creates a new Learning Objective under an existing Assessment Objective.

**Input Schema:**

```typescript
{
  assessment_objective_id: z.string().min(1)
    .describe('ID of the parent Assessment Objective'),
  title: z.string().min(1).max(255)
    .describe('Title of the learning objective'),
  order_index: z.number().int().min(0).optional().default(0)
    .describe('Position within the AO (0-based)'),
  spec_ref: z.string().optional().nullable()
    .describe('Optional reference to external specification'),
  curriculum_id: z.string().min(1)
    .describe('Curriculum ID (for path revalidation context)')
}
```

**Output Schema:**

```typescript
{
  learning_objective: z.object({
    learning_objective_id: z.string(),
    assessment_objective_id: z.string(),
    title: z.string(),
    order_index: z.number(),
    active: z.boolean(),
    spec_ref: z.string().nullable()
  })
}
```

**SQL:**

```sql
INSERT INTO learning_objectives
  (assessment_objective_id, title, order_index, active, spec_ref)
VALUES ($1, $2, $3, true, $4)
RETURNING *;
```

**Validation:**
- `assessment_objective_id` must exist in `assessment_objectives` table
- `title` must be non-empty after trimming, max 255 chars

---

### `update_learning_objective`

Updates an existing Learning Objective.

**Input Schema:**

```typescript
{
  learning_objective_id: z.string().min(1)
    .describe('ID of the LO to update'),
  title: z.string().min(1).max(255).optional()
    .describe('New title'),
  order_index: z.number().int().min(0).optional()
    .describe('New position'),
  active: z.boolean().optional()
    .describe('Active status (false = soft-deleted)'),
  spec_ref: z.string().nullable().optional()
    .describe('External specification reference')
}
```

**Output Schema:**

```typescript
{
  learning_objective: z.object({
    learning_objective_id: z.string(),
    assessment_objective_id: z.string(),
    title: z.string(),
    order_index: z.number(),
    active: z.boolean(),
    spec_ref: z.string().nullable()
  })
}
```

**SQL (dynamic — build SET clause from provided fields):**

```sql
UPDATE learning_objectives
SET title = $2, order_index = $3, active = $4, spec_ref = $5
WHERE learning_objective_id = $1
RETURNING *;
```

**Validation:**
- At least one field besides `learning_objective_id` must be provided
- If `title` is provided, must be non-empty after trimming

---

### `delete_learning_objective`

Deletes a Learning Objective and cascades to its Success Criteria.

**Input Schema:**

```typescript
{
  learning_objective_id: z.string().min(1)
    .describe('ID of the LO to delete')
}
```

**Output Schema:**

```typescript
{
  deleted: z.boolean(),
  blocked_by_activities: z.boolean()
    .describe('True if deletion was blocked because SCs are assigned to activities')
}
```

**Pre-delete Check SQL:**

```sql
SELECT DISTINCT asc2.activity_id
FROM success_criteria sc
JOIN activity_success_criteria asc2
  ON asc2.success_criteria_id = sc.success_criteria_id
WHERE sc.learning_objective_id = $1;
```

If rows returned → return `{ deleted: false, blocked_by_activities: true }` with `isError: true`.

**Delete SQL:**

```sql
DELETE FROM learning_objectives
WHERE learning_objective_id = $1;
```

---

### `reorder_learning_objectives`

Sets the order of all LOs under an Assessment Objective.

**Input Schema:**

```typescript
{
  assessment_objective_id: z.string().min(1)
    .describe('Parent AO ID'),
  ordered_ids: z.array(z.string().min(1))
    .describe('LO IDs in the desired order (index becomes order_index)')
}
```

**Output Schema:**

```typescript
{
  success: z.boolean()
}
```

**SQL (batch update using unnest):**

```sql
UPDATE learning_objectives
SET order_index = idx.new_order
FROM (
  SELECT unnest($1::text[]) AS id,
         generate_series(0, array_length($1::text[], 1) - 1) AS new_order
) idx
WHERE learning_objective_id = idx.id
  AND assessment_objective_id = $2;
```

---

### `create_success_criterion`

Creates a new Success Criterion under a Learning Objective, with optional unit links.

**Input Schema:**

```typescript
{
  learning_objective_id: z.string().min(1)
    .describe('Parent LO ID'),
  description: z.string().min(1)
    .describe('The criterion statement'),
  level: z.number().int().min(1).max(9).optional().default(1)
    .describe('Progression level (1-9)'),
  order_index: z.number().int().min(0).optional().default(0)
    .describe('Position within the LO'),
  active: z.boolean().optional().default(true)
    .describe('Active status'),
  unit_ids: z.array(z.string()).optional().default([])
    .describe('Unit IDs to link this SC to')
}
```

**Output Schema:**

```typescript
{
  success_criterion: z.object({
    success_criteria_id: z.string(),
    learning_objective_id: z.string(),
    description: z.string(),
    level: z.number(),
    order_index: z.number(),
    active: z.boolean(),
    units: z.array(z.string())
  })
}
```

**SQL (use a transaction if unit_ids are provided):**

```sql
-- Step 1: Insert SC
INSERT INTO success_criteria
  (learning_objective_id, description, level, order_index, active)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- Step 2: Insert unit links (if any)
INSERT INTO success_criteria_units (success_criteria_id, unit_id)
SELECT $1, unnest($2::text[]);
```

**Validation:**
- `learning_objective_id` must exist
- `description` must be non-empty after trimming
- `level` must be 1-9
- Each `unit_id` in `unit_ids` should be a valid unit

---

### `update_success_criterion`

Updates a Success Criterion and optionally modifies its unit associations.

**Input Schema:**

```typescript
{
  success_criteria_id: z.string().min(1)
    .describe('ID of the SC to update'),
  description: z.string().min(1).optional()
    .describe('New criterion text'),
  level: z.number().int().min(1).max(9).optional()
    .describe('New level'),
  order_index: z.number().int().min(0).optional()
    .describe('New position'),
  active: z.boolean().optional()
    .describe('Active status'),
  unit_ids: z.array(z.string()).optional()
    .describe('New complete set of unit IDs (diff is computed automatically)')
}
```

**Output Schema:**

```typescript
{
  success_criterion: z.object({
    success_criteria_id: z.string(),
    learning_objective_id: z.string(),
    description: z.string(),
    level: z.number(),
    order_index: z.number(),
    active: z.boolean(),
    units: z.array(z.string())
  })
}
```

**Unit Update Logic (when `unit_ids` is provided):**

```sql
-- 1. Fetch existing links
SELECT unit_id FROM success_criteria_units
WHERE success_criteria_id = $1;

-- 2. Compute diff
--    toDelete = existing - new
--    toInsert = new - existing

-- 3. Delete removed links
DELETE FROM success_criteria_units
WHERE success_criteria_id = $1 AND unit_id = ANY($2::text[]);

-- 4. Insert new links
INSERT INTO success_criteria_units (success_criteria_id, unit_id)
SELECT $1, unnest($2::text[]);
```

**Validation:**
- At least one field besides `success_criteria_id` must be provided
- If `description` is provided, must be non-empty after trimming
- If `level` is provided, must be 1-9

---

### `delete_success_criterion`

Deletes a Success Criterion.

**Input Schema:**

```typescript
{
  success_criteria_id: z.string().min(1)
    .describe('ID of the SC to delete')
}
```

**Output Schema:**

```typescript
{
  deleted: z.boolean(),
  blocked_by_activities: z.boolean()
    .describe('True if deletion was blocked because SC is assigned to activities')
}
```

**Pre-delete Check SQL:**

```sql
SELECT activity_id
FROM activity_success_criteria
WHERE success_criteria_id = $1
LIMIT 1;
```

If rows returned → return `{ deleted: false, blocked_by_activities: true }` with `isError: true`.

**Delete SQL:**

```sql
DELETE FROM success_criteria
WHERE success_criteria_id = $1;
```

---

### `reorder_success_criteria`

Sets the order of all SCs under a Learning Objective.

**Input Schema:**

```typescript
{
  learning_objective_id: z.string().min(1)
    .describe('Parent LO ID'),
  ordered_ids: z.array(z.string().min(1))
    .describe('SC IDs in desired order')
}
```

**Output Schema:**

```typescript
{
  success: z.boolean()
}
```

**SQL:**

```sql
UPDATE success_criteria
SET order_index = idx.new_order
FROM (
  SELECT unnest($1::text[]) AS id,
         generate_series(0, array_length($1::text[], 1) - 1) AS new_order
) idx
WHERE success_criteria_id = idx.id
  AND learning_objective_id = $2;
```

---

### `link_lesson_success_criterion`

Assigns a Success Criterion to a lesson.

**Input Schema:**

```typescript
{
  lesson_id: z.string().min(1)
    .describe('Lesson to link to'),
  success_criteria_id: z.string().min(1)
    .describe('SC to link')
}
```

**Output Schema:**

```typescript
{
  success: z.boolean()
}
```

**SQL:**

```sql
INSERT INTO lesson_success_criteria (lesson_id, success_criteria_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;
```

---

### `unlink_lesson_success_criterion`

Removes a Success Criterion from a lesson.

**Input Schema:**

```typescript
{
  lesson_id: z.string().min(1)
    .describe('Lesson to unlink from'),
  success_criteria_id: z.string().min(1)
    .describe('SC to unlink')
}
```

**Output Schema:**

```typescript
{
  success: z.boolean()
}
```

**SQL:**

```sql
DELETE FROM lesson_success_criteria
WHERE lesson_id = $1 AND success_criteria_id = $2;
```

---

### `list_lesson_success_criteria`

Lists all Success Criteria currently linked to a lesson.

**Input Schema:**

```typescript
{
  lesson_id: z.string().min(1)
    .describe('Lesson ID to query')
}
```

**Output Schema:**

```typescript
{
  success_criteria: z.array(z.object({
    success_criteria_id: z.string(),
    description: z.string(),
    level: z.number().nullable(),
    learning_objective_id: z.string().nullable()
  }))
}
```

**SQL:**

```sql
SELECT l.success_criteria_id,
       sc.description,
       sc.level,
       sc.learning_objective_id
FROM lesson_success_criteria l
LEFT JOIN success_criteria sc ON sc.success_criteria_id = l.success_criteria_id
WHERE l.lesson_id = $1;
```

---

### `link_lesson_learning_objective`

Assigns a Learning Objective to a lesson.

**Input Schema:**

```typescript
{
  lesson_id: z.string().min(1)
    .describe('Lesson to link to'),
  learning_objective_id: z.string().min(1)
    .describe('LO to link'),
  title: z.string().min(1)
    .describe('Display title for this LO in the lesson context'),
  order_by: z.number().int().min(0).optional().default(0)
    .describe('Order position within the lesson')
}
```

**Output Schema:**

```typescript
{
  success: z.boolean()
}
```

**SQL:**

```sql
INSERT INTO lessons_learning_objective
  (lesson_id, learning_objective_id, title, order_by, order_index, active)
VALUES ($1, $2, $3, $4, $4, true)
ON CONFLICT DO NOTHING;
```

---

### `unlink_lesson_learning_objective`

Removes a Learning Objective from a lesson.

**Input Schema:**

```typescript
{
  lesson_id: z.string().min(1)
    .describe('Lesson to unlink from'),
  learning_objective_id: z.string().min(1)
    .describe('LO to unlink')
}
```

**Output Schema:**

```typescript
{
  success: z.boolean()
}
```

**SQL:**

```sql
DELETE FROM lessons_learning_objective
WHERE lesson_id = $1 AND learning_objective_id = $2;
```

---

### `check_success_criteria_usage`

Checks whether Success Criteria under a given LO or a specific SC are assigned to activities.

**Input Schema:**

```typescript
{
  learning_objective_id: z.string().optional()
    .describe('Check all SCs under this LO'),
  success_criteria_id: z.string().optional()
    .describe('Check a specific SC')
  // At least one must be provided
}
```

**Output Schema:**

```typescript
{
  in_use: z.boolean(),
  activity_count: z.number(),
  details: z.array(z.object({
    success_criteria_id: z.string(),
    activity_ids: z.array(z.string())
  }))
}
```

**SQL (for LO-level check):**

```sql
SELECT asc2.success_criteria_id, array_agg(asc2.activity_id) AS activity_ids
FROM success_criteria sc
JOIN activity_success_criteria asc2 ON asc2.success_criteria_id = sc.success_criteria_id
WHERE sc.learning_objective_id = $1
GROUP BY asc2.success_criteria_id;
```

**SQL (for SC-level check):**

```sql
SELECT success_criteria_id, array_agg(activity_id) AS activity_ids
FROM activity_success_criteria
WHERE success_criteria_id = $1
GROUP BY success_criteria_id;
```

---

## Validation Rules

### Learning Objectives

| Field | Constraint |
|-------|-----------|
| `title` | Non-empty after trim, max 255 characters |
| `assessment_objective_id` | Must exist in `assessment_objectives` |
| `order_index` | Integer >= 0 |
| `active` | Boolean, defaults to `true` |
| `spec_ref` | Nullable string, no length limit |

### Success Criteria

| Field | Constraint |
|-------|-----------|
| `description` | Non-empty after trim |
| `learning_objective_id` | Must exist in `learning_objectives` |
| `level` | Integer 1-9, defaults to 1 |
| `order_index` | Integer >= 0 |
| `active` | Boolean, defaults to `true` |
| `unit_ids` | Array of valid `unit_id` strings |

### Lesson Links

| Field | Constraint |
|-------|-----------|
| `lesson_id` | Must exist in `lessons` |
| `success_criteria_id` | Must exist in `success_criteria` |
| `learning_objective_id` | Must exist in `learning_objectives` |

---

## Error Handling Patterns

Follow the existing MCP server conventions:

### Service Layer Errors

```typescript
// In service functions (MCP/src/services/*.ts):
const { data, error } = await supabase.from('table').select('*');
if (error) {
  throw new Error(`Failed to [operation]: ${error.message}`);
}
```

### Tool Handler Errors

```typescript
// In tool handlers (MCP/src/server.ts):
async ({ field }) => {
  try {
    const result = await serviceFunction(field);
    return {
      content: [{ type: 'text', text: 'Success message' }],
      structuredContent: { result }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: message }],
      structuredContent: { error: message },
      isError: true
    };
  }
}
```

### Error Scenarios to Handle

| Scenario | Response |
|----------|----------|
| Parent ID not found | `isError: true`, message: "Assessment objective {id} not found" |
| Delete blocked by activity | `isError: true`, `blocked_by_activities: true` |
| Empty title/description | `isError: true`, validation error message |
| Duplicate link (ON CONFLICT) | Return success (idempotent) |
| Level out of range | `isError: true`, validation error message |

---

## Data Flow Examples

### Creating a Full LO→SC Structure

```
1. get_all_curriculum
   → Pick curriculum_id

2. get_all_los_and_scs_for_curriculum(curriculum_id)
   → Find assessment_objective_id for the target AO

3. create_learning_objective({
     assessment_objective_id: "ao-123",
     title: "Understand binary representation",
     spec_ref: "1.2.4",
     curriculum_id: "curr-abc"
   })
   → Returns learning_objective_id

4. create_success_criterion({
     learning_objective_id: "lo-xyz",
     description: "Can convert between binary and denary for 8-bit numbers",
     level: 3,
     unit_ids: ["unit-1", "unit-2"]
   })
   → Returns success_criteria_id

5. link_lesson_success_criterion({
     lesson_id: "lesson-789",
     success_criteria_id: "sc-new"
   })
```

### Safe Deletion Flow

```
1. check_success_criteria_usage({
     learning_objective_id: "lo-xyz"
   })
   → If in_use=true, warn user or unassign from activities first

2. delete_learning_objective({
     learning_objective_id: "lo-xyz"
   })
   → Cascades to SCs, unit links, lesson links, feedback
```

### Updating SC Unit Associations

```
1. update_success_criterion({
     success_criteria_id: "sc-123",
     unit_ids: ["unit-A", "unit-C"]   // was ["unit-A", "unit-B"]
   })
   → Computes diff: delete unit-B, insert unit-C
```

---

## Implementation Notes

### File Organisation

New service functions should follow the existing pattern:

```
MCP/src/services/
├── curriculum.ts        # existing - curriculum queries
├── losc.ts              # existing - read LO/SC tree
├── units.ts             # existing - unit queries
├── lessons.ts           # existing - lesson queries
├── learning-objectives.ts   # NEW - LO CRUD
├── success-criteria.ts      # NEW - SC CRUD
└── lesson-assignments.ts    # NEW - lesson link/unlink
```

### Database Access

The MCP server uses the Supabase client (not the `pg` pool used by the Next.js app). All database access goes through:

```typescript
import { getSupabaseServiceClient } from '../supabase.js';

const supabase = getSupabaseServiceClient();
```

For operations requiring transactions (e.g. creating SC with unit links), use the Supabase `rpc()` call to invoke a database function, or use multiple sequential queries with error handling to roll back on failure.

### Naming Conventions

- **Tool names**: `snake_case` (e.g. `create_learning_objective`)
- **Service functions**: `camelCase` (e.g. `createLearningObjective`)
- **Zod schemas**: `PascalCase` (e.g. `LearningObjectiveInputSchema`)

### Level Semantics

Levels 1-9 represent progression tiers:
- **1-3**: Foundation
- **4-6**: Developing
- **7-9**: Mastery

The level system maps to the boundary helpers in `src/lib/levels/index.ts`.

### Soft Delete Preference

Prefer setting `active = false` over hard deletion when the item may have downstream references (student feedback, lesson assignments). Hard delete is acceptable when:
- The item was just created (no downstream data)
- The caller has explicitly checked usage via `check_success_criteria_usage`

### Order Index Management

- Order indices are 0-based and contiguous
- Reorder operations receive the full ordered list and reassign indices
- Use PostgreSQL `unnest()` + `generate_series()` for efficient batch updates
- When creating new items, default `order_index: 0` (caller can reorder after)

### Idempotent Link Operations

- `link_lesson_success_criterion` and `link_lesson_learning_objective` use `ON CONFLICT DO NOTHING`
- Re-linking an already linked item is a no-op, not an error
- Unlinking a non-existent link is also not an error (DELETE where no match returns 0 rows)

### App-Layer Correspondence

Each MCP tool maps to an existing Next.js server action. Reference implementations:

| MCP Tool | Server Action | File |
|----------|---------------|------|
| `create_learning_objective` | `createCurriculumLearningObjectiveAction` | `src/lib/server-actions/curricula.ts` |
| `update_learning_objective` | `updateCurriculumLearningObjectiveAction` | `src/lib/server-actions/curricula.ts` |
| `delete_learning_objective` | `deleteCurriculumLearningObjectiveAction` | `src/lib/server-actions/curricula.ts` |
| `reorder_learning_objectives` | `reorderCurriculumLearningObjectivesAction` | `src/lib/server-actions/curricula.ts` |
| `create_success_criterion` | `createCurriculumSuccessCriterionAction` | `src/lib/server-actions/curricula.ts` |
| `update_success_criterion` | `updateCurriculumSuccessCriterionAction` | `src/lib/server-actions/curricula.ts` |
| `delete_success_criterion` | `deleteCurriculumSuccessCriterionAction` | `src/lib/server-actions/curricula.ts` |
| `reorder_success_criteria` | `reorderCurriculumSuccessCriteriaAction` | `src/lib/server-actions/curricula.ts` |
| `link_lesson_success_criterion` | `linkLessonSuccessCriterionAction` | `src/lib/server-actions/lesson-success-criteria.ts` |
| `unlink_lesson_success_criterion` | `unlinkLessonSuccessCriterionAction` | `src/lib/server-actions/lesson-success-criteria.ts` |
| `list_lesson_success_criteria` | `listLessonSuccessCriteriaAction` | `src/lib/server-actions/lesson-success-criteria.ts` |
| `link_lesson_learning_objective` | *(new — no existing action for single insert)* | `src/lib/server-actions/lesson-learning-objectives.ts` |
| `unlink_lesson_learning_objective` | *(new — no existing action for single delete)* | `src/lib/server-actions/lesson-learning-objectives.ts` |
| `check_success_criteria_usage` | `checkSuccessCriteriaUsageAction` | `src/lib/server-actions/curricula.ts` |

> The Next.js server actions use the `pg` pool via `src/lib/db.ts` and include `requireTeacherProfile()` auth guards. The MCP server uses Supabase service role (bypassing row-level security) and authenticates via the `x-mcp-service-key` header instead.
