# Planner MCP Server

The MCP server exposes the Planner database to AI agents via the Model Context Protocol. It runs as a Next.js App Router route at `/api/MCP`.

## Connection

| Setting | Value |
|---|---|
| Transport | HTTP (SSE for Claude Code, POST for other clients) |
| Auth | Bearer token — `MCP_SERVICE_KEY` env var |
| Production URL | `https://dino.mr-salih.org/api/MCP` |
| Local URL | `http://localhost:3000/api/MCP` |

### `.mcp.json` config

```json
{
  "mcpServers": {
    "plannerDev": {
      "type": "http",
      "url": "http://localhost:3000/api/MCP",
      "headers": { "Authorization": "Bearer ${MCP_SERVICE_KEY}" }
    },
    "planner": {
      "type": "http",
      "url": "https://dino.mr-salih.org/api/MCP",
      "headers": { "Authorization": "Bearer ${MCP_SERVICE_KEY}" }
    }
  }
}
```

Both `MCP_SERVICE_KEY` must be exported in the shell session running Claude Code.

---

## Safety Guard

**All write operations that touch lesson or activity content require the parent unit to be `active = false`.**  
The guard fires before any DB write. Attempting to modify an active unit returns:

> *"Unit X is active. MCP write operations are only allowed on inactive units. Deactivate the unit in the app before making changes via MCP."*

This applies to: `create_lesson`, `create_activity`, `remove_activity`, `add_success_criterion_to_lesson`, `upload_lesson_file`, `upload_activity_file`, and the direct upload endpoints.

---

## Tools

### Curriculum

#### `get_all_curriculum`
Returns all curriculum summaries.

**Input:** none  
**Output:** `{ curricula: [{ curriculum_id, title, is_active }] }`

---

#### `get_curriculum`
Returns a single curriculum by ID.

**Input:** `{ curriculum_id: string }`  
**Output:** `{ curriculum: { curriculum_id, title, subject, description, is_active } | null }`

---

#### `get_curriculum_id_from_title`
Finds curricula whose title matches a pattern (case-insensitive contains).

**Input:** `{ title: string }`  
**Output:** `{ curricula: [{ curriculum_id, title }] }`

---

#### `get_all_los_and_scs_for_curriculum`
Returns the full LO + SC tree for a curriculum.

**Input:** `{ curriculum_id: string }`  
**Output:** Full nested structure of assessment objectives → learning objectives → success criteria.

---

#### `create_curriculum`
Creates a new curriculum.

**Input:** `{ title: string, subject?: string, description?: string }`  
**Output:** `{ curriculum: { curriculum_id, title, subject, description, is_active } | null }`

---

### Assessment Objectives

#### `create_assessment_objective`
Creates a new assessment objective under a curriculum. `order_index` is computed automatically as `MAX + 1`.

**Input:** `{ curriculum_id: string, code: string, title: string }`  
**Output:** `{ assessment_objective: { assessment_objective_id, curriculum_id, code, title, order_index } | null }`

---

### Learning Objectives & Success Criteria

#### `create_learning_objective`
Creates a learning objective under an assessment objective. Validates the AO exists. `order_index` computed automatically.

**Input:** `{ assessment_objective_id: string, title: string, spec_ref?: string }`  
**Output:** `{ learning_objective: { learning_objective_id, assessment_objective_id, title, spec_ref, active, order_index } | null }`

---

#### `create_success_criterion`
Creates a success criterion under a learning objective. Validates the LO exists. `level` must be 1–9. `order_index` computed automatically.

**Input:** `{ learning_objective_id: string, description: string, level: number }`  
**Output:** `{ success_criterion: { success_criteria_id, learning_objective_id, description, level, order_index, active } | null }`

---

### Units

#### `get_all_units`
Returns all units.

**Input:** none  
**Output:** `{ units: [{ unit_id, title, subject, is_active }] }`

---

#### `get_unit_by_title`
Finds units whose title matches a pattern (case-insensitive contains).

**Input:** `{ title: string }`  
**Output:** `{ units: [{ unit_id, title, subject, is_active }] }`

---

#### `create_unit`
Creates a new unit. **Always created with `is_active = false`** — the teacher must activate via the app UI after review.

**Input:** `{ title: string, subject: string, description?: string, year?: number }`  
**Output:** `{ unit: { unit_id, title, subject, description, year, is_active } | null }`

---

### Lessons

#### `get_lessons_for_unit`
Lists all lessons for a unit.

**Input:** `{ unit_id: string }`  
**Output:** `{ lessons: [{ lesson_id, unit_id, title, is_active, order_index }] }`

---

#### `create_lesson`
Creates a lesson under a unit. Appended at the end of the unit's lesson order. **Unit must be inactive.**

**Input:** `{ unit_id: string, title: string }`  
**Output:** `{ lesson: { lesson_id, unit_id, title, is_active, order_index } | null }`

---

#### `add_success_criterion_to_lesson`
Links a success criterion to a lesson. The parent learning objective is automatically linked to the lesson if not already present. **Unit must be inactive.**

**Input:** `{ lesson_id: string, success_criteria_id: string }`  
**Output:** `{ link: { lesson_id, success_criteria_id, learning_objective_id, lo_already_linked, sc_already_linked } | null }`

---

### Activities

#### `get_activities_for_lesson`
Lists all active activities for a lesson.

**Input:** `{ lesson_id: string }`  
**Output:** `{ activities: [{ activity_id, lesson_id, title, type, order_index, is_summative, active }] }`

---

#### `create_activity`
Creates an activity under a lesson. **Unit must be inactive.**

Scorable types: `multiple-choice-question`, `short-text-question`, `text-question`, `long-text-question`, `upload-file`, `upload-url`, `feedback`, `sketch-render`, `do-flashcards`  
Non-scorable types: `text`, `display-image`, `display-flashcards`, `file-download`, `show-video`, `voice`, `share-my-work`, `review-others-work`, `display-section`

Setting `is_summative = true` on a non-scorable type returns an error without writing to the DB.

**Input:** `{ lesson_id: string, type: ActivityType, title?: string, body_data?: object, is_summative?: boolean }`  
**Output:** `{ activity: { activity_id, lesson_id, title, type, order_index, is_summative, active } | null }`

##### Flashcard body_data format
`display-flashcards` stores card content as a `lines` string. Each line with `**answer**` syntax becomes one card:

```json
{
  "lines": "The **mitochondria** is the powerhouse of the cell\nPhotosynthesis converts **light energy** into chemical energy"
}
```

`do-flashcards` references a `display-flashcards` activity by ID:

```json
{ "flashcardActivityId": "<activity_id of the display-flashcards activity>" }
```

---

#### `update_activity`
Updates `title`, `body_data`, and/or `is_summative` on an existing activity. Only provided fields are changed — omitted fields are left as-is. **Unit must be inactive.** Setting `is_summative = true` on a non-scorable type is rejected.

**Input:** `{ activity_id: string, title?: string | null, body_data?: object | null, is_summative?: boolean }`  
**Output:** `{ activity: { activity_id, lesson_id, title, type, order_index, is_summative, active } | null }`

---

#### `add_success_criterion_to_activity`
Links a success criterion to an activity via `activity_success_criteria`. Validates both exist. Silently skips if already linked. **Unit must be inactive.**

**Input:** `{ activity_id: string, success_criteria_id: string }`  
**Output:** `{ link: { activity_id, success_criteria_id, already_linked } | null }`

---

#### `remove_activity`
Permanently deletes an activity and its `activity_success_criteria` links. **Unit must be inactive.**

**Input:** `{ activity_id: string, lesson_id: string }`  
**Output:** `{ removed: { activity_id, lesson_id } | null }`

---

### File Uploads

Two strategies are supported depending on the client's capabilities:

#### Strategy A — base64 (small files only, ≤ ~18 KB raw)

##### `upload_lesson_file`
Uploads a base64-encoded file to the lesson's private teacher file store. Not visible to pupils. **Unit must be inactive.** Max 5 MB.

**Input:** `{ lesson_id: string, file_name: string, base64_content: string, content_type?: string }`  
**Output:** `{ file: { lesson_id, file_name, size_bytes, url } | null }`

##### `upload_activity_file`
Uploads a base64-encoded file to a `file-download` activity (so pupils can download it) or a `display-image` activity (to set its image). **Unit must be inactive.** Max 5 MB.

**Input:** `{ lesson_id: string, activity_id: string, file_name: string, base64_content: string, content_type?: string }`  
**Output:** `{ file: { activity_id, lesson_id, file_name, size_bytes, url } | null }`

---

#### Strategy B — direct multipart POST (recommended for larger files)

Use the info tools to get the upload parameters, then POST the file directly — no base64 encoding, no token-limit issues.

##### `get_lesson_file_upload_info`
Returns everything needed to POST a file directly to the lesson teacher file store.

**Input:** `{ lesson_id: string }`  
**Output:**
```json
{
  "upload_url": "https://dino.mr-salih.org/api/MCP/files/lesson",
  "method": "POST",
  "headers": { "Authorization": "Bearer <MCP_SERVICE_KEY>" },
  "form_fields": { "lesson_id": "<lesson_id>" },
  "instructions": "Send a multipart/form-data POST. File field name: 'file'. Max 5 MB."
}
```

##### `get_activity_file_upload_info`
Returns everything needed to POST a file directly to a `file-download` or `display-image` activity.

**Input:** `{ lesson_id: string, activity_id: string }`  
**Output:**
```json
{
  "upload_url": "https://dino.mr-salih.org/api/MCP/files/activity",
  "method": "POST",
  "headers": { "Authorization": "Bearer <MCP_SERVICE_KEY>" },
  "form_fields": { "lesson_id": "<lesson_id>", "activity_id": "<activity_id>" },
  "instructions": "Send a multipart/form-data POST. File field name: 'file'. Max 5 MB. Activity must be type file-download or display-image."
}
```

##### Direct upload endpoints (auth: `MCP_SERVICE_KEY` bearer token)

| Endpoint | Purpose |
|---|---|
| `POST /api/MCP/files/lesson` | Upload to lesson teacher file store |
| `POST /api/MCP/files/activity` | Upload to a `file-download` or `display-image` activity |

---

### Utility

#### `status`
Health probe.

**Input:** none  
**Output:** `{ status: "ok", timestamp: string }`

---

## Implementation

| File | Purpose |
|---|---|
| `src/app/api/MCP/route.ts` | Main MCP server — tool registration |
| `src/app/api/MCP/files/lesson/route.ts` | Direct lesson file upload endpoint |
| `src/app/api/MCP/files/activity/route.ts` | Direct activity file upload endpoint |
| `src/lib/mcp/auth.ts` | Bearer token verification |
| `src/lib/mcp/guards.ts` | `assertUnitIsInactive` / `assertLessonUnitIsInactive` safety guards |
| `src/lib/mcp/curriculum.ts` | Curriculum read/write helpers |
| `src/lib/mcp/units.ts` | Unit read/write helpers |
| `src/lib/mcp/lessons.ts` | Lesson read/write/upload helpers |
| `src/lib/mcp/losc.ts` | AO / LO / SC read/write helpers |
| `src/lib/mcp/activities.ts` | Activity read/write/upload helpers |
