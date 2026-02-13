# Curriculum Management System

This document describes how Curricula, Assessment Objectives (AO), Learning Objectives (LO), and Success Criteria (SC) are structured, managed, and maintained in the planner application.

## Overview

The curriculum system follows a hierarchical structure:

```
Curriculum
└── Assessment Objectives (AO)
    └── Learning Objectives (LO)
        └── Success Criteria (SC)
            └── Unit Links (many-to-many)
```

### Key Concepts

- **Curriculum**: Top-level container for a subject's learning framework (e.g., "Computing GCSE")
- **Assessment Objective (AO)**: High-level learning goals within a curriculum (e.g., "AO1: Computational Thinking")
- **Learning Objective (LO)**: Specific learning outcomes under an assessment objective
- **Success Criteria (SC)**: Measurable statements that define what students must achieve, linked to learning objectives and optionally to specific units
- **Levels**: Success criteria are leveled 1-9, indicating progression/difficulty
- **Units**: Teaching units that can be associated with success criteria via a many-to-many relationship

## Database Schema

### Tables

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

**Primary Key**: `curriculum_id`

#### `assessment_objectives`
```sql
CREATE TABLE public.assessment_objectives (
    assessment_objective_id text DEFAULT gen_random_uuid() NOT NULL,
    curriculum_id text,
    unit_id text,
    code text NOT NULL,
    title text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL
);
```

**Primary Key**: `assessment_objective_id`
**Foreign Keys**:
- `curriculum_id` → `curricula(curriculum_id)`
- `unit_id` → `units(unit_id)` (optional link to a specific unit)

#### `learning_objectives`
```sql
CREATE TABLE public.learning_objectives (
    learning_objective_id text DEFAULT gen_random_uuid() NOT NULL,
    assessment_objective_id text NOT NULL,
    title text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    spec_ref text,
    sub_item_id text
);
```

**Primary Key**: `learning_objective_id`
**Foreign Keys**: `assessment_objective_id` → `assessment_objectives(assessment_objective_id)`

**Fields**:
- `spec_ref`: Optional reference to external specification document
- `sub_item_id`: Optional reference to sub-items
- `active`: Allows soft-deletion/hiding of learning objectives

#### `success_criteria`
```sql
CREATE TABLE public.success_criteria (
    success_criteria_id text DEFAULT gen_random_uuid() NOT NULL,
    learning_objective_id text NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    description text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true
);
```

**Primary Key**: `success_criteria_id`
**Foreign Keys**: `learning_objective_id` → `learning_objectives(learning_objective_id)`

**Fields**:
- `level`: Integer 1-9 indicating progression level
- `description`: The criterion statement
- `active`: Allows soft-deletion

#### `success_criteria_units` (Join Table)
```sql
CREATE TABLE public.success_criteria_units (
    success_criteria_id text NOT NULL,
    unit_id text NOT NULL
);
```

**Composite Primary Key**: `(success_criteria_id, unit_id)`

**Purpose**: Many-to-many relationship between success criteria and units. A success criterion can be associated with multiple units, and a unit can have multiple success criteria.

### Lesson Relationships

#### `lesson_success_criteria`
```sql
CREATE TABLE public.lesson_success_criteria (
    lesson_id text NOT NULL,
    success_criteria_id text NOT NULL
);
```

Links lessons to specific success criteria they address.

#### `lessons_learning_objective`
```sql
CREATE TABLE public.lessons_learning_objective (
    learning_objective_id text NOT NULL,
    lesson_id text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    active boolean DEFAULT true,
    order_by integer NOT NULL
);
```

Links lessons to learning objectives with ordering and title overrides.

## TypeScript Types & Zod Schemas

### Core Schemas

Located in `src/types/index.ts`:

```typescript
// Curriculum
export const CurriculumSchema = z.object({
    curriculum_id: z.string(),
    subject: z.string().nullable(),
    title: z.string().min(1).max(255),
    description: z.string().nullable(),
    active: z.boolean().default(true),
});

// Assessment Objective
export const AssessmentObjectiveSchema = z.object({
    assessment_objective_id: z.string(),
    curriculum_id: z.string().nullable(),
    unit_id: z.string().nullable(),
    code: z.string().min(1).max(10),
    title: z.string().min(1).max(255),
    order_index: z.union([z.number(), z.null(), z.undefined()])
        .transform((val) => (typeof val === "number" && Number.isFinite(val) ? val : 0)),
});

// Learning Objective
export const LearningObjectiveSchema = z.object({
    learning_objective_id: z.string(),
    assessment_objective_id: z.string(),
    title: z.string().min(1).max(255),
    order_index: z.number().default(0),
    active: z.boolean().default(true),
    spec_ref: z.string().nullable().optional(),
    // ... additional optional fields for joins
});

// Success Criterion
export const SuccessCriterionSchema = z.object({
    success_criteria_id: z.string(),
    learning_objective_id: z.string(),
    level: z.number().min(1).max(9).default(1),
    description: z.string().min(1),
    order_index: z.union([z.number(), z.null(), z.undefined()])
        .transform((val) => (typeof val === "number" && Number.isFinite(val) ? val : 0)),
    active: z.boolean().default(true),
    units: z.array(z.string()).default([]),
});
```

### Nested/Detail Schemas

```typescript
// Learning Objective with its Success Criteria
export const LearningObjectiveWithCriteriaSchema = LearningObjectiveSchema.extend({
    success_criteria: SuccessCriteriaSchema.default([]),
});

// Assessment Objective with nested Learning Objectives and Success Criteria
export const AssessmentObjectiveDetailSchema = AssessmentObjectiveSchema.extend({
    learning_objectives: z.array(LearningObjectiveWithCriteriaSchema).default([]),
});

// Complete Curriculum Detail (full hierarchy)
export const CurriculumDetailSchema = CurriculumSchema.extend({
    assessment_objectives: z.array(AssessmentObjectiveDetailSchema).default([]),
});
```

### Lesson-Related Schemas

```typescript
// Success Criteria linked to a Lesson
export const LessonSuccessCriterionSchema = z.object({
    lesson_id: z.string(),
    success_criteria_id: z.string(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    level: z.number().nullable().optional(),
    learning_objective_id: z.string().nullable().optional(),
    activity_id: z.string().nullable().optional(),
    is_summative: z.boolean().nullable().optional(),
});

// Learning Objective linked to a Lesson
export const LessonLearningObjectiveSchema = z.object({
    lesson_id: z.string(),
    learning_objective_id: z.string(),
    order_index: z.number(),
    learning_objective: LearningObjectiveSchema.extend({
        success_criteria: SuccessCriteriaSchema.optional(),
    }),
});
```

## Server Actions

All curriculum-related server actions are in `src/lib/server-actions/curricula.ts` and re-exported through `src/lib/server-updates.ts`.

### Curriculum Operations

#### `readCurriculaAction()`
Returns all curricula ordered by title.

**Return Type**: `{ data: Curriculum[] | null, error: string | null }`

#### `readCurriculumDetailAction(curriculumId: string)`
Returns complete curriculum hierarchy with all nested AOs, LOs, and SCs.

**Process**:
1. Fetch curriculum metadata
2. Fetch all assessment objectives for curriculum (ordered by `order_index`)
3. Fetch all learning objectives for those AOs
4. Fetch all success criteria for those LOs (via `fetchSuccessCriteriaForLearningObjectives()`)
5. Assemble nested structure

**Return Type**: `{ data: CurriculumDetail | null, error: string | null }`

#### `createCurriculumAction(payload)`
Creates a new curriculum.

**Parameters**: `{ title, subject?, description?, active? }`

**Validation**: Title must be non-empty after trimming.

#### `updateCurriculumAction(curriculumId, payload)`
Updates curriculum metadata.

**Revalidates**: `/curriculum` path

### Assessment Objective Operations

#### `readAssessmentObjectivesAction()`
Returns all assessment objectives across all curricula.

#### `createCurriculumAssessmentObjectiveAction(curriculumId, payload)`
Creates new AO under a curriculum.

**Parameters**: `{ code, title, unit_id?, order_index? }`

**Validation**:
- Code required (max 10 chars)
- Title required (max 255 chars)

**Revalidates**: `/curriculum` and `/curriculum/${curriculumId}`

#### `updateCurriculumAssessmentObjectiveAction(aoId, curriculumId, updates)`
Updates AO fields.

**Updatable Fields**: `code`, `title`, `unit_id`, `order_index`

#### `deleteCurriculumAssessmentObjectiveAction(aoId, curriculumId)`
Deletes an assessment objective (CASCADE deletes child LOs and SCs).

#### `reorderCurriculumAssessmentObjectivesAction(curriculumId, orderedIds[])`
Reorders assessment objectives within a curriculum.

**Process**:
1. Updates `order_index` for all AOs in batch using `unnest()`
2. Re-fetches and returns updated hierarchy

### Learning Objective Operations

#### `createCurriculumLearningObjectiveAction(aoId, payload, curriculumId)`
Creates new LO under an assessment objective.

**Parameters**: `{ title, order_index?, spec_ref? }`

**Defaults**:
- `active: true`
- `order_index: 0`

#### `updateCurriculumLearningObjectiveAction(loId, curriculumId, updates)`
Updates LO fields.

**Updatable Fields**: `title`, `order_index`, `active`, `spec_ref`

#### `deleteCurriculumLearningObjectiveAction(loId, curriculumId)`
Deletes a learning objective (CASCADE deletes child SCs).

#### `reorderCurriculumLearningObjectivesAction(aoId, curriculumId, orderedIds[])`
Reorders learning objectives within an assessment objective.

### Success Criteria Operations

#### `createCurriculumSuccessCriterionAction(loId, curriculumId, payload)`
Creates new SC under a learning objective.

**Parameters**: `{ description, level?, order_index?, active?, unit_ids? }`

**Process**:
1. Insert into `success_criteria` table
2. If `unit_ids` provided, insert links into `success_criteria_units` table

**Defaults**:
- `level: 1`
- `order_index: 0`
- `active: true`

#### `updateCurriculumSuccessCriterionAction(scId, curriculumId, updates)`
Updates SC and optionally its unit associations.

**Updatable Fields**: `description`, `level`, `order_index`, `active`, `unit_ids`

**Unit Update Process**:
1. Fetch existing unit links
2. Calculate diff (toInsert, toDelete)
3. Delete removed links
4. Insert new links

#### `deleteCurriculumSuccessCriterionAction(scId, curriculumId)`
Deletes a success criterion (CASCADE deletes unit links).

#### `reorderCurriculumSuccessCriteriaAction(loId, curriculumId, orderedIds[])`
Reorders success criteria within a learning objective.

**Returns**: Updated success criteria list with unit associations.

## Helper Functions

### `fetchSuccessCriteriaForLearningObjectives(loIds: string[])`

Located in `src/lib/server-actions/learning-objectives.ts`.

**Purpose**: Efficiently fetch all success criteria and their unit links for multiple learning objectives.

**Returns**: `{ map: Map<string, SuccessCriterion[]>, error: string | null }`

**Process**:
1. Query `success_criteria` for all criteria matching LO IDs
2. Query `success_criteria_units` for unit associations
3. Group by `learning_objective_id` into a Map
4. Each SC includes its `units[]` array

This function is used extensively during curriculum detail loading to avoid N+1 queries.

## UI Components

### Main Pages

#### `/src/app/curriculum/page.tsx`
Lists all curricula with basic metadata.

#### `/src/app/curriculum/[curriculumId]/page.tsx`
Server component that:
1. Requires teacher authentication
2. Fetches curriculum detail with full hierarchy
3. Fetches all units and lessons for linking
4. Passes data to client component

### Client Component

#### `/src/app/curriculum/[curriculumId]/curriculum-prototype-client.tsx`

**Features**:
- **Inline Editing**: Click to edit AO codes/titles, LO titles, SC descriptions
- **Level Management**: Visual badges (1-7) with color coding (emerald gradient)
- **Unit Linking**: Multi-select interface to associate SCs with units
- **Reordering**: Drag-and-drop support for AOs, LOs, and SCs
- **Filtering**:
  - Visual filter by unit (shows only SCs linked to selected unit)
  - Text filter supporting `l <level>` and `yr <year>` tokens
- **Export**: Excel export by levels or by units
- **Lesson Mapping**: Link/unlink success criteria to lessons

**State Management**:
- Optimistic updates for all edit operations
- Transition-based loading states via `useTransition()`
- Toast notifications for success/error feedback
- Server action calls for persistence
- Refetch after mutations to ensure consistency

**Level Styling**:
```typescript
const levelStyleMap: Record<number, { badge: string; text: string }> = {
  1: { badge: "bg-emerald-100 text-emerald-900", text: "text-emerald-900" },
  // ... through level 7
  7: { badge: "bg-emerald-700 text-emerald-50", text: "text-emerald-50" },
}
```

## Data Flow Examples

### Creating a Complete Curriculum Structure

```typescript
// 1. Create Curriculum
const { data: curriculum } = await createCurriculumAction({
  title: "Computing GCSE",
  subject: "Computer Science",
  description: "GCSE specification 2024"
});

// 2. Create Assessment Objective
const { data: ao } = await createCurriculumAssessmentObjectiveAction(
  curriculum.curriculum_id,
  {
    code: "AO1",
    title: "Computational Thinking",
    order_index: 0
  }
);

// 3. Create Learning Objective
const { data: lo } = await createCurriculumLearningObjectiveAction(
  ao.assessment_objective_id,
  {
    title: "Understand abstraction and decomposition",
    spec_ref: "1.2.3",
    order_index: 0
  },
  curriculum.curriculum_id
);

// 4. Create Success Criteria with Unit Links
const { data: sc } = await createCurriculumSuccessCriterionAction(
  lo.learning_objective_id,
  curriculum.curriculum_id,
  {
    description: "Can identify key components of a problem",
    level: 3,
    order_index: 0,
    unit_ids: ["unit-123", "unit-456"]
  }
);
```

### Updating Unit Associations

```typescript
// Add/remove unit links for existing SC
await updateCurriculumSuccessCriterionAction(
  scId,
  curriculumId,
  {
    unit_ids: ["unit-123", "unit-789"] // Diff calculated automatically
  }
);
```

### Fetching Curriculum Detail

```typescript
const { data: curriculum } = await readCurriculumDetailAction(curriculumId);

// Structure:
curriculum.assessment_objectives.forEach(ao => {
  console.log(`AO: ${ao.code} - ${ao.title}`);

  ao.learning_objectives.forEach(lo => {
    console.log(`  LO: ${lo.title}`);

    lo.success_criteria.forEach(sc => {
      console.log(`    SC (L${sc.level}): ${sc.description}`);
      console.log(`       Units: ${sc.units.join(', ')}`);
    });
  });
});
```

## Best Practices

1. **Always use server actions** for curriculum mutations - never direct database access from client.

2. **Revalidation paths** must be called after mutations:
   - `/curriculum` - for curriculum list changes
   - `/curriculum/${curriculumId}` - for detail changes

3. **Order indices** are zero-based and contiguous. Use reorder actions to maintain consistency.

4. **Soft deletion**: Use `active: false` rather than hard deletes where relationships exist.

5. **Unit associations** are optional but enable powerful filtering and reporting when populated.

6. **Levels range 1-9** to support progression across key stages. Typically:
   - Levels 1-3: Foundation
   - Levels 4-6: Developing
   - Levels 7-9: Mastery

7. **Validation** happens at both Zod schema level and database constraint level. Always handle errors gracefully.

8. **Batch operations** use PostgreSQL `unnest()` for efficient multi-row updates (see reorder actions).

## Related Features

- **Lessons**: Link to success criteria via `lesson_success_criteria` and learning objectives via `lessons_learning_objective`
- **Units**: Teaching units that can be filtered and associated with success criteria
- **Assignments**: Use lesson assignments which inherit their success criteria associations
- **Reports**: Generate pupil reports based on success criteria achievement levels
- **Exports**: Excel exports available by levels or by units from curriculum detail page
