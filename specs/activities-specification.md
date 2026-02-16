# Activities Specification

This document defines the required structure for creating activities via the MCP server. Each activity is stored in the `activities` table and its type-specific configuration lives in the `body_data` JSONB column.

## Database Schema

### `activities` table

> Source: `src/migrations/schema.sql` line 1499

| Column | Type | Default | Description |
|---|---|---|---|
| `activity_id` | `text` | `gen_random_uuid()` | Primary key (UUID) |
| `lesson_id` | `text` | — | Foreign key to `lessons.lesson_id` |
| `title` | `text` | — | Display title shown to pupils |
| `type` | `text` | — | Activity type identifier (see below) |
| `body_data` | `jsonb` | — | Type-specific configuration (see per-type schemas) |
| `order_by` | `integer` | — | Sort position within the lesson (0-based) |
| `active` | `boolean` | `true` | Soft-delete flag |
| `is_summative` | `boolean` | `false` | Whether this counts toward assessment averages |
| `notes` | `text` | — | Teacher-only notes (not shown to pupils) |

### `activity_success_criteria` junction table

> Source: `src/migrations/schema.sql` line 1531

| Column | Type | Description |
|---|---|---|
| `activity_id` | `text` | Foreign key to `activities.activity_id` |
| `success_criteria_id` | `text` | Foreign key to `success_criteria.success_criteria_id` |

Links activities to curriculum success criteria for per-criterion scoring.

### `submissions` table

> Source: `src/migrations/schema.sql` line 2157

| Column | Type | Default | Description |
|---|---|---|---|
| `submission_id` | `text` | `gen_random_uuid()` | Primary key |
| `activity_id` | `text` | — | Foreign key to `activities.activity_id` |
| `user_id` | `text` | — | Pupil who submitted |
| `submitted_at` | `timestamptz` | `now()` | Submission timestamp |
| `body` | `json` | — | Type-specific submission data |
| `submission_status` | `text` | `'inprogress'` | One of: `inprogress`, `submitted`, `completed`, `rejected` |
| `is_flagged` | `boolean` | `false` | Teacher review flag |
| `replication_pk` | `bigint` | auto-increment | Internal replication key |

## Zod Container Schema

> Source: `src/types/index.ts` line 794 — `LessonActivitySchema`

All activities share this container structure:

```typescript
{
  activity_id: string,          // UUID, auto-generated
  lesson_id: string,            // parent lesson
  title: string,                // display title
  type: string,                 // activity type identifier
  body_data: unknown,           // type-specific JSON (see below)
  is_summative: boolean,        // assessment flag (only for scorable types)
  notes: string,                // teacher notes
  order_by: number | null,      // sort order
  active: boolean,              // soft-delete
  success_criteria_ids: string[], // linked SC IDs (hydrated)
  success_criteria: ActivitySuccessCriterion[], // hydrated SC details
}
```

## Server Action: Creating Activities

> Source: `src/lib/server-actions/lesson-activities.ts` line 25

Use `createLessonActivityAction(unitId, lessonId, input)` where `input` matches:

```typescript
// CreateActivityInputSchema (line 25)
{
  title?: string,
  type: string,                              // required, min 1 char
  bodyData?: unknown | null,                 // type-specific body (see below)
  isSummative?: boolean,                     // only allowed for scorable types
  successCriteriaIds?: string[],             // SC IDs to link
}
```

### Summative rules

Only scorable activity types can have `is_summative = true`. The scorable types are defined in `src/dino.config.ts` line 1:

- `multiple-choice-question`
- `short-text-question`
- `text-question`
- `long-text-question`
- `upload-file`
- `upload-url`
- `feedback`
- `sketch-render`

Non-scorable types (line 12):

- `text` (display text)
- `display-image`
- `file-download`
- `show-video`
- `voice`

Setting `isSummative: true` on a non-scorable type will return an error.

---

## Activity Type: `text` (Display Text)

### Type string

```
"text"
```

### Category

Non-scorable. No submissions are collected. `is_summative` must be `false`.

### `body_data` structure

> Source: `src/components/lessons/lesson-activities-manager.tsx` line 1417

```json
{
  "text": "The content to display to the pupil. Supports plain text."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | `string` | Yes | The text content shown to pupils |

There is no formal Zod schema for `text` activity bodies. The body falls through to the `default` case in `normalizeActivityBody` (line 789) which accepts any object or null.

### Example

```json
{
  "title": "Key Vocabulary",
  "type": "text",
  "bodyData": {
    "text": "Algorithm: A step-by-step set of instructions to solve a problem."
  }
}
```

### Submission body

Not applicable. Display-only activities do not accept submissions.

---

## Activity Type: `display-image` (Display Image)

### Type string

```
"display-image"
```

### Category

Non-scorable. No submissions are collected. `is_summative` must be `false`.

### `body_data` structure

> Source: `src/components/lessons/activity-view/utils.ts` line 19 — `ImageBody` interface

```json
{
  "imageFile": "filename.png",
  "imageUrl": null,
  "fileUrl": "filename.png"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `imageFile` | `string \| null` | Yes | Filename of an uploaded image (stored via activity file upload). Set to `null` when using an external URL. |
| `imageUrl` | `string \| null` | No | External image URL. Used when `imageFile` is `null`. |
| `fileUrl` | `string \| null` | No | Redundant reference to the file; typically mirrors `imageFile` or `imageUrl`. |
| `mimeType` | `string` | No | MIME type of the uploaded file (e.g. `"image/png"`). |
| `size` | `number` | No | File size in bytes. |

There is no formal Zod schema for `display-image` bodies. The body falls through to the `default` case in `normalizeActivityBody` (line 789).

### Image resolution

Images referenced by `imageFile` are resolved via the activity file system (`src/lib/activity-assets.ts` line 33). The file must be uploaded separately using the activity file upload flow.

When using an external URL, set `imageFile` to `null` and provide the URL in `imageUrl`.

### Example: Uploaded image

```json
{
  "title": "Circuit Diagram",
  "type": "display-image",
  "bodyData": {
    "imageFile": "circuit-diagram.png",
    "imageUrl": null,
    "fileUrl": "circuit-diagram.png"
  }
}
```

### Example: External URL

```json
{
  "title": "World Map",
  "type": "display-image",
  "bodyData": {
    "imageFile": null,
    "imageUrl": "https://example.com/images/world-map.jpg",
    "fileUrl": "https://example.com/images/world-map.jpg"
  }
}
```

### Submission body

Not applicable. Display-only activities do not accept submissions.

---

## Activity Type: `multiple-choice-question`

### Type string

```
"multiple-choice-question"
```

### Category

Scorable. Can be marked as summative (`is_summative: true`).

### `body_data` structure

> Source: `src/types/index.ts` line 491 — `McqActivityBodySchema`

```json
{
  "question": "What is the capital of France?",
  "imageFile": null,
  "imageUrl": null,
  "imageAlt": null,
  "options": [
    { "id": "option-a", "text": "London", "imageUrl": null },
    { "id": "option-b", "text": "Paris", "imageUrl": null },
    { "id": "option-c", "text": "Berlin", "imageUrl": null },
    { "id": "option-d", "text": "Madrid", "imageUrl": null }
  ],
  "correctOptionId": "option-b"
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `question` | `string` | Yes | min 1 char | The question text |
| `imageFile` | `string \| null` | No | min 1 char if present | Uploaded image filename for the question |
| `imageUrl` | `string \| null` | No | — | External image URL for the question |
| `imageAlt` | `string \| null` | No | — | Alt text for the question image |
| `options` | `McqOption[]` | Yes | min 2, max 4 items | Answer options |
| `correctOptionId` | `string` | Yes | min 1 char, must match one `options[].id` | ID of the correct option |

### `McqOption` schema

> Source: `src/types/index.ts` line 485 — `McqOptionSchema`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `id` | `string` | Yes | min 1 char | Unique option identifier (e.g. `"option-a"`) |
| `text` | `string` | Yes | max 500 chars | Option text |
| `imageUrl` | `string \| null` | No | — | Optional image for this option |

### Validation

The schema includes a refinement (line 500): `correctOptionId` must match the `id` of one of the provided options. If it doesn't, validation fails with `"Correct option must match one of the provided options."`.

### Example

```json
{
  "title": "Capitals Quiz",
  "type": "multiple-choice-question",
  "bodyData": {
    "question": "Which of these is a programming language?",
    "imageFile": null,
    "imageUrl": null,
    "imageAlt": null,
    "options": [
      { "id": "option-a", "text": "HTML", "imageUrl": null },
      { "id": "option-b", "text": "Python", "imageUrl": null },
      { "id": "option-c", "text": "CSS", "imageUrl": null }
    ],
    "correctOptionId": "option-b"
  },
  "isSummative": true,
  "successCriteriaIds": ["sc-uuid-1", "sc-uuid-2"]
}
```

### Submission body

> Source: `src/types/index.ts` line 513 — `McqSubmissionBodySchema`

```json
{
  "answer_chosen": "option-b",
  "is_correct": true,
  "teacher_override_score": null,
  "teacher_feedback": null,
  "success_criteria_scores": {
    "sc-uuid-1": 1.0,
    "sc-uuid-2": 1.0
  }
}
```

| Field | Type | Description |
|---|---|---|
| `answer_chosen` | `string` | The option ID the pupil selected |
| `is_correct` | `boolean` | Whether the chosen option matches `correctOptionId` |
| `teacher_override_score` | `number (0-1) \| null` | Teacher manual override (takes precedence) |
| `teacher_feedback` | `string \| null` | Teacher written feedback |
| `success_criteria_scores` | `Record<string, number \| null>` | Per-criterion scores (0.0 to 1.0) |

---

## Activity Type: `short-text-question`

### Type string

```
"short-text-question"
```

### Category

Scorable. Can be marked as summative (`is_summative: true`). Supports AI-powered auto-marking by comparing pupil answers against a model answer.

### `body_data` structure

> Source: `src/types/index.ts` line 532 — `ShortTextActivityBodySchema`

```json
{
  "question": "What is photosynthesis?",
  "modelAnswer": "Photosynthesis is the process by which plants convert sunlight, water, and carbon dioxide into glucose and oxygen."
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `question` | `string` | Yes | min 1 char | The question text shown to pupils |
| `modelAnswer` | `string` | Yes | min 1 char | The expected answer used by the AI marker for comparison |

The schema uses `.passthrough()` so additional fields are preserved but not required.

### Server-side validation

When type is `"short-text-question"`, the body is validated against `ShortTextActivityBodySchema` in `normalizeActivityBody` (line 774). Both `question` and `modelAnswer` must be non-empty strings.

### Example

```json
{
  "title": "Photosynthesis Question",
  "type": "short-text-question",
  "bodyData": {
    "question": "Explain what photosynthesis is in your own words.",
    "modelAnswer": "Photosynthesis is the process by which green plants use sunlight to convert carbon dioxide and water into glucose and oxygen."
  },
  "isSummative": true,
  "successCriteriaIds": ["sc-uuid-3"]
}
```

### Submission body

> Source: `src/types/index.ts` line 539 — `ShortTextSubmissionBodySchema`

```json
{
  "answer": "Photosynthesis is when plants use light to make food.",
  "ai_model_score": 0.75,
  "ai_model_feedback": "Good understanding of the basic concept. Missing mention of carbon dioxide and oxygen.",
  "teacher_override_score": null,
  "is_correct": false,
  "teacher_feedback": null,
  "success_criteria_scores": {
    "sc-uuid-3": 0.75
  }
}
```

| Field | Type | Description |
|---|---|---|
| `answer` | `string` | The pupil's written response |
| `ai_model_score` | `number (0-1) \| null` | AI-generated similarity score |
| `ai_model_feedback` | `string \| null` | AI-generated feedback text |
| `teacher_override_score` | `number (0-1) \| null` | Teacher manual override (takes precedence over AI score) |
| `is_correct` | `boolean` | Whether the answer is considered correct |
| `teacher_feedback` | `string \| null` | Teacher written feedback |
| `success_criteria_scores` | `Record<string, number \| null>` | Per-criterion scores (0.0 to 1.0) |

---

## MCP Server Integration Notes

### Current MCP tools (reference)

> Source: `MCP/src/server.ts` line 267

The MCP server currently exposes tools for reading curricula, units, and lessons but does not yet have tools for creating activities. The following tools provide the IDs needed to create activities:

| Tool | Purpose |
|---|---|
| `get_all_units` | List all units to find `unit_id` |
| `get_lessons_for_unit` | List lessons for a unit to find `lesson_id` |
| `get_all_los_and_scs_for_curriculum` | Get learning objectives and success criteria to find `success_criteria_id` values |

### Creating an activity via MCP

To create an activity, an MCP tool should call `createLessonActivityAction` with:

```typescript
createLessonActivityAction(
  unitId: string,       // parent unit ID
  lessonId: string,     // parent lesson ID
  {
    title: string,                       // activity display title
    type: string,                        // one of the type strings above
    bodyData: object | null,             // type-specific body (see schemas above)
    isSummative?: boolean,               // only for scorable types
    successCriteriaIds?: string[],       // SC IDs to link
  }
)
```

### Response shape

```typescript
{
  success: boolean,
  error: string | null,
  data: LessonActivity | null
}
```

### Body normalization by type

> Source: `src/lib/server-actions/lesson-activities.ts` line 749

| Stored `type` value | Normalizer case | Zod schema applied |
|---|---|---|
| `"mcq"` | `"mcq"` | `McqActivityBodySchema` (strict validation) |
| `"short-text-question"` | `"short-text-question"` | `ShortTextActivityBodySchema` (strict validation) |
| `"feedback"` | `"feedback"` | `FeedbackActivityBodySchema` (strict validation) |
| `"text"` | default | Pass-through (any object or null) |
| `"display-image"` | default | Pass-through (any object or null) |
| `"multiple-choice-question"` | default | Pass-through (any object or null) |
| All other types | default | Pass-through (any object or null) |

**Important**: The UI stores MCQ activities with `type = "multiple-choice-question"`, which falls through to the default case and is NOT validated against `McqActivityBodySchema`. The `"mcq"` case in the normalizer is effectively unused by the current UI. When creating MCQ activities via MCP, use `type = "multiple-choice-question"` to match existing data. The body should still conform to `McqActivityBodySchema` structure for correct rendering and scoring.

### Ordering

Activities are ordered by `order_by` within a lesson. The `createLessonActivityAction` automatically assigns the next available `order_by` value (current max + 1, or 0 if the lesson has no activities).

### File uploads

`display-image` activities that reference uploaded files (via `imageFile`) require a separate file upload step. The MCP server should either use external URLs (`imageUrl`) or implement the file upload flow from `src/lib/server-actions/lesson-activity-files.ts`.
