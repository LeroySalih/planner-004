# Planner MCP Server

The MCP server exposes the Planner database to AI agents via the Model Context Protocol. It runs as a Next.js App Router route at `/api/MCP`.

## Connection

| Setting | Value |
|---|---|
| Transport | HTTP (SSE for Claude Code, POST for other clients) |
| Auth | OAuth 2.1 (a teacher signs in), or Bearer `MCP_SERVICE_KEY` |
| Production URL | `https://dino.mr-salih.org/api/MCP` |
| Local URL | `http://localhost:3000/api/MCP` |

### Connecting Claude with sign-in (OAuth)

No key is needed. In claude.ai or Claude Desktop open **Settings → Connectors →
Add custom connector** and enter `https://dino.mr-salih.org/api/MCP`. In Claude
Code: `claude mcp add --transport http dino https://dino.mr-salih.org/api/MCP`,
then `/mcp` to sign in.

Claude opens DINO in a browser; sign in as a teacher and press **Allow**. The
connection has full MCP access — there are no scopes. Pupils cannot connect.
Each teacher can see and **Revoke** their connections under *Connected apps* on
their profile page (`/profiles/<userId>`).

How it works (MCP authorization spec 2025-06-18):

| Step | Endpoint |
|---|---|
| Refused request → `401` + `WWW-Authenticate: Bearer resource_metadata=…` | `/api/MCP` |
| Protected resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource` (and path-suffixed variants) |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server` |
| Dynamic client registration (RFC 7591) | `POST /oauth/register` |
| Consent page — sign-in, teacher check, Allow / Deny | `GET /oauth/authorize` |
| Code → tokens (PKCE S256), refresh rotation | `POST /oauth/token` |

- **`APP_ORIGIN` is required in production** (e.g. `APP_ORIGIN=https://dino.mr-salih.org`).
  It is the OAuth issuer and the origin of every advertised URL — discovery
  documents, `WWW-Authenticate`, upload URLs — via `publicOrigin()` in
  `src/lib/public-origin.ts`. Unset, the origin is derived from
  `x-forwarded-host` / `x-forwarded-proto`, which clients control: anyone could
  make the metadata point at their own host. That fallback is for local dev only.
- Registration only accepts Claude's callbacks —
  `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`,
  `https://claude.ai/api/organizations/custom-connectors/oauth/callback` — and
  loopback `http://localhost:<port>/…` / `http://127.0.0.1:<port>/…` for Claude
  Code. A code can therefore only be delivered to Claude. The list is
  `CLAUDE_CALLBACKS` in `src/lib/oauth/server.ts`; the consent form's CSP
  `form-action` in `next.config.ts` must allow the same origins.
- Redirect URIs match exactly, except loopback ones, which match on any port
  (RFC 8252 §7.3) because Claude Code listens on an ephemeral port each session.
- Access tokens last 1 hour, refresh tokens 30 days. Refreshing rotates both in
  place and requires `client_id`; the old refresh token stops working at once,
  and presenting it again revokes the connection (OAuth 2.1 §4.3.1). Only
  SHA-256 hashes are stored (`oauth_tokens`, migration 105).
- A replayed authorization code revokes the connection it was exchanged for.
- The user must still be a teacher when a token is issued, refreshed or used.
- Registration is open, so registrations that never produced a connection are
  pruned after 24 hours (along with expired codes and dead tokens) whenever a
  code is issued.

`verifyMcpAuthorization()` returns the teacher's `userId` for an OAuth token
(`null` for the service key); tools do not use it yet.

The same OAuth server also signs people in to the Kerf Sabre apps as first-party clients with JWT access tokens. MCP clients are unaffected: their tokens stay opaque, teacher only, with no scopes, and a Kerf token is refused by `/api/MCP`. See `docs/KERF-SSO.md`.

### Connecting with the service key (`.mcp.json`)

Scripts and header-configured clients keep using `MCP_SERVICE_KEY`, sent as
`Authorization: Bearer <key>` or `x-mcp-service-key: <key>`:

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

`MCP_SERVICE_KEY` must be exported in the shell session running Claude Code.
When `headers.Authorization` is set Claude Code does not fall back to OAuth.

---

## Audit Log

There is no longer a "unit must be inactive" guard: MCP can edit lessons and
activities in live units, so every call is recorded instead (migration 106).
Each tool call and each upload to the direct upload endpoints writes one row to
`mcp_audit_log`, reads included:

| Column | Meaning |
|---|---|
| `auth_method` | `oauth` (a teacher signed in through a connector) or `service_key` (a script) |
| `user_id`, `user_name`, `user_email` | The signed-in teacher. Name and email are copied at the time of the call, so they survive the profile being deleted. Null for the service key. |
| `oauth_client_id`, `oauth_client_name` | The connector the teacher authorised, e.g. "Claude" |
| `tool` | Tool name, or `file_upload:lesson` / `file_upload:activity` for the upload endpoints |
| `is_write` | `false` for `get_*`, `list_*` and `status`; `true` for everything else |
| `arguments` | The tool input. `base64_content` and any string over 20 000 chars are replaced by their length. |
| `outcome`, `error` | `ok` or `error`, with the message the caller was given |
| `duration_ms` | Time spent in the tool |

A tool that fails returns null payloads with the message as text, rather than
throwing; the log treats that as an `error`. A failed log write is reported to
the server log and never fails the call.

```sql
-- changes made through MCP in the last week, newest first
select created_at, user_name, oauth_client_name, tool, outcome, error, arguments
from mcp_audit_log
where is_write and created_at > now() - interval '7 days'
order by created_at desc;
```

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

#### `list_assessment_objectives`
Lists a curriculum's assessment objectives in display order (`order_index`, then `code`), with the number of active learning objectives under each.

**Input:** `{ curriculum_id: string }`  
**Output:** `{ assessment_objectives: [{ assessment_objective_id, curriculum_id, code, title, order_index, learning_objective_count }] | null }`

---

#### `create_assessment_objective`
Creates a new assessment objective under a curriculum. `order_index` is computed automatically as `MAX + 1`.

**Input:** `{ curriculum_id: string, code: string, title: string }`  
**Output:** `{ assessment_objective: { assessment_objective_id, curriculum_id, code, title, order_index } | null }`

---

#### `update_assessment_objective`
Updates an assessment objective's `code`, `title` and/or `order_index` (display position). Omitted fields keep their current value. (Assessment objectives have no `active` flag, so there is no delete tool.)

**Input:** `{ assessment_objective_id: string, code?: string, title?: string, order_index?: number }`  
**Output:** `{ assessment_objective: { assessment_objective_id, curriculum_id, code, title, order_index } | null }`

---

### Learning Objectives & Success Criteria

#### `create_learning_objective`
Creates a learning objective under an assessment objective. Validates the AO exists. `order_index` computed automatically.

**Input:** `{ assessment_objective_id: string, title: string, spec_ref?: string }`  
**Output:** `{ learning_objective: { learning_objective_id, assessment_objective_id, title, spec_ref, active, order_index } | null }`

---

#### `update_learning_objective`
Updates a learning objective's `title`, `spec_ref`, and/or `active`. Omitted fields keep their current value.

**Input:** `{ learning_objective_id: string, title?: string, spec_ref?: string, active?: boolean }`  
**Output:** `{ learning_objective: { learning_objective_id, assessment_objective_id, title, spec_ref, active, order_index } | null }`

---

#### `delete_learning_objective`
**Soft-delete** — sets `active = false` rather than removing the row, so pupil work and links that reference it are preserved (there are no FK cascades). Reactivate via `update_learning_objective` with `active: true`.

**Input:** `{ learning_objective_id: string }`  
**Output:** `{ learning_objective: { learning_objective_id, active } | null }`

---

#### `create_success_criterion`
Creates a success criterion under a learning objective. Validates the LO exists. `level` must be 1–9. `order_index` computed automatically.

**Input:** `{ learning_objective_id: string, description: string, level: number }`  
**Output:** `{ success_criterion: { success_criteria_id, learning_objective_id, description, level, order_index, active } | null }`

---

#### `update_success_criterion`
Updates a success criterion's `description`, `level` (1–9), `active` and/or `learning_objective_id`. Omitted fields keep their current value.

`learning_objective_id` moves the criterion to another LO, keeping every lesson and activity link and the marks pupils hold against it. The new LO must be in the same curriculum (for a unit's own AO, the same AO). The criterion goes last in the new LO. Each lesson that links the criterion gets the new LO linked, as `add_success_criterion_to_lesson` would, listed in `lessons_linked_to_new_lo`. The old LO stays linked to those lessons; remove it with `remove_learning_objective_from_lesson` if nothing else there uses it.

**Input:** `{ success_criteria_id: string, description?: string, level?: number, active?: boolean, learning_objective_id?: string }`  
**Output:** `{ success_criterion: { success_criteria_id, learning_objective_id, description, level, order_index, active, lessons_linked_to_new_lo } | null }`

---

#### `delete_success_criterion`
**Soft-delete** — sets `active = false` rather than removing the row, preserving referencing pupil work and links. Reactivate via `update_success_criterion` with `active: true`. To remove a criterion from a single lesson or activity without deactivating it entirely, use the unlink tools below.

**Input:** `{ success_criteria_id: string }`  
**Output:** `{ success_criterion: { success_criteria_id, active } | null }`

---

### Units

#### `get_all_units`
Returns all units.

**Input:** none  
**Output:** `{ units: [{ unit_id, title, subject, is_active }] }`

---

#### `get_unit`
Returns one unit, including its description, so a caller can read what `update_unit` will replace.

**Input:** `{ unit_id: string }`  
**Output:** `{ unit: { unit_id, title, subject, description, year, is_active, curriculum_id, curriculum_title, lesson_count } | null }`

`lesson_count` counts active standard lessons, not interventions.

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

#### `update_unit`
Changes a unit's title and/or description. Omitted fields are left unchanged; `description: ""` clears it. An empty title is rejected.

**Input:** `{ unit_id: string, title?: string, description?: string }`  
**Output:** `{ unit: { unit_id, title, subject, description, year, is_active } | null }`

---

### Unit audits

An auditor checks a unit and its lessons and records a pass, or a fail with the actions that would fix it. The status is derived (migration 123):

| `status` | Meaning |
|---|---|
| `audited` | The last audit passed and nothing has changed since. |
| `failed` | The last audit failed and nothing has changed since; `actions` say what to fix. |
| `not_audited` | Never audited, or the unit or its lessons changed after the last audit. `last_result`, `audited_at` and `actions` still describe that audit, so a failed audit's actions remain the to-do list. |

A change is anything to the unit itself (title, subject, description, year, curriculum, active), its lessons (added, removed, retitled, reordered, (de)activated, moved), their activities, links, LO and SC links, and unit, lesson and activity files. Making a lesson public or hiding it from pupils is not a change; nor is pupils' work, an intervention lesson, or editing a shared LO/SC's wording on the curriculum page. Database triggers record changes, so every route (app, MCP, AI chat) counts.

Audit shape: `{ unit_id, unit_title, subject, status, last_result: "passed" | "failed" | null, audited_at, audited_by, changed_at, actions: [{ action, lesson_id, lesson_title }] }`. Times are ISO; `audited_by` is the signed-in teacher's name, null over the service key.

#### `get_unit_audit`
**Input:** `{ unit_id: string }`  
**Output:** `{ audit: Audit | null }`

---

#### `list_unit_audits`
Every active unit's audit, optionally filtered. `status: "not_audited"` lists the units that need auditing.

**Input:** `{ subject?: string, curriculum_id?: string, status?: "audited" | "failed" | "not_audited" }`  
**Output:** `{ audits: Audit[] }`

---

#### `record_unit_audit`
Records an audit. `passed` takes no actions; `failed` needs at least one (at most 100). Each action says what must change and, when it concerns one lesson, carries that lesson's id, which must be a lesson of the unit. The actions replace those of the previous audit.

`started_at` is when the auditor began reading the unit (at most a day ago). The audit is stamped with it, so an edit made while the audit ran leaves the unit `not_audited`. An auditor that fixes things itself should make the fixes first, then read and record, or the pass will read as stale.

**Input:** `{ unit_id: string, result: "passed" | "failed", actions?: [{ action: string, lesson_id?: string }], started_at?: string }`  
**Output:** `{ audit: Audit | null }`

---

### Lessons

#### `get_lessons_for_unit`
Lists all lessons for a unit. `sub_unit_id` is the sub unit a lesson is grouped under, or null.

**Input:** `{ unit_id: string }`  
**Output:** `{ lessons: [{ lesson_id, unit_id, title, description, is_active, order_index, sub_unit_id }] }`

---

#### `get_lesson_objectives`
Returns everything linked to a lesson: its learning objectives, the success criteria under each (ordered as in the curriculum), and which of the lesson's active activities use each criterion. A criterion that only an activity links is still listed, with `linked_to_lesson: false`; likewise an LO reached only through one of its criteria. Use it to confirm links after `add_success_criterion_to_lesson` and to find stale ones.

**Input:** `{ lesson_id: string }`  
Also returns the lesson's `description` (null if unset), so a caller can write one from the objectives and criteria with `update_lesson`.

**Output:** `{ lesson: { lesson_id, unit_id, title, description, learning_objectives: [{ learning_objective_id, assessment_objective_code, title, active, linked_to_lesson, success_criteria: [{ success_criteria_id, description, level, active, linked_to_lesson, activities: [{ activity_id, title, type }] }] }] } | null }`

---

#### `create_lesson`
Creates a lesson under a unit. Appended at the end of the unit's lesson order.

**Input:** `{ unit_id: string, title: string, description?: string }`  
**Output:** `{ lesson: { lesson_id, unit_id, title, description, is_active, order_index } | null }`

---

#### `update_lesson`
Changes a lesson's title and/or description. Omitted fields are left unchanged, and `description: ""` clears it. An empty title is rejected.

The description (`lessons.description`, migration 124) is one short sentence telling pupils what they will achieve in the lesson. Write it from the lesson's learning objectives and success criteria (`get_lesson_objectives`). It appears under the title on the pupil lesson page. It is limited to 300 characters; a longer one is refused. Changing it makes the unit "not audited", like any other lesson content.

**Input:** `{ lesson_id: string, title?: string, description?: string }`  
**Output:** `{ lesson: { lesson_id, unit_id, title, description, is_active, order_index } | null }`

---

#### `reorder_lessons`
Sets the order of a unit's lessons. `lesson_ids` must list every active lesson in the unit exactly once, first to last. A partial list, a duplicate, an inactive lesson, or an id from another unit is rejected and nothing changes. Inactive lessons keep their relative order after the active ones. Interventions aren't part of the unit's order and are left alone. A sub unit's lessons are kept together: each sub unit sits where its first lesson lands, so the saved order can differ from `lesson_ids` when a sub unit's lessons were split. Returns the lessons in their new order.

**Input:** `{ unit_id: string, lesson_ids: string[] }`  
**Output:** `{ lessons: [{ lesson_id, unit_id, title, is_active, order_index, sub_unit_id }] | null }`

---

#### `add_success_criterion_to_lesson`
Links a success criterion to a lesson. The parent learning objective is automatically linked to the lesson if not already present.

**Input:** `{ lesson_id: string, success_criteria_id: string }`  
**Output:** `{ link: { lesson_id, success_criteria_id, learning_objective_id, lo_already_linked, sc_already_linked } | null }`

---

#### `remove_success_criterion_from_lesson`
Unlinks a success criterion from a lesson (deletes the `lesson_success_criteria` row only; the criterion and the lesson's learning-objective link are left intact). `removed` is `false` if no such link existed.

**Input:** `{ lesson_id: string, success_criteria_id: string }`  
**Output:** `{ lesson_id, success_criteria_id, removed }`

---

#### `remove_learning_objective_from_lesson`
Unlinks a learning objective from a lesson. The lesson's links to that LO's success criteria go with it, because a criterion left linked would show the LO again. The LO itself is untouched. `removed` is `false` if the lesson linked neither the LO nor any of its criteria.

Activity links are left alone: removing one changes what the activity is marked against. Activities in the lesson still linked to one of the LO's criteria are listed in `activities_still_linked`, and `get_lesson_objectives` keeps showing the LO through them with `linked_to_lesson: false`. Unlink them with `remove_success_criterion_from_activity` if they should go too.

**Input:** `{ lesson_id: string, learning_objective_id: string }`  
**Output:** `{ result: { lesson_id, learning_objective_id, removed, success_criteria_unlinked: string[], activities_still_linked: [{ activity_id, title, success_criteria_id }] } | null }`

---

### Sub units

A sub unit groups a unit's lessons for planning (migration 126). Teachers see
it on the unit page; pupils see it as a section heading on My Units. It is
structure only: reports and progress never read it, and lessons keep one
order across the whole unit, so numbering and scores don't change.

A lesson is in at most one sub unit of its own unit, or in none. A sub unit's
lessons always sit together in the unit's order, at the place of its first
lesson. The rules are in `src/lib/sub-units/store.ts`, shared with the unit page.

**Workflow:** `list_sub_units` → `create_sub_unit` → `set_lesson_sub_unit` for
each lesson → `get_lessons_for_unit` to check.

#### `list_sub_units`
A unit's sub units, active and inactive, each with its lessons in order.

**Input:** `{ unit_id: string }`  
**Output:** `{ sub_units: [{ sub_unit_id, unit_id, title, description, active, lessons: [{ lesson_id, title, is_active, order_index }] }] | null }`

---

#### `create_sub_unit`
Adds an empty, active sub unit. Description is optional, at most 300 characters.

**Input:** `{ unit_id: string, title: string, description?: string }`  
**Output:** `{ sub_unit: { sub_unit_id, unit_id, title, description, active } | null }`

---

#### `update_sub_unit`
Changes the title or description, or switches the sub unit on or off.
Omitted fields are unchanged; `description: ""` clears it.

Switching off (`active: false`) needs `lessons`:

| `lessons` | Its lessons |
|---|---|
| `ungroup` | return to the unit, still active |
| `deactivate` | become inactive and stay in the sub unit |

Switching back on doesn't reactivate lessons.

**Input:** `{ sub_unit_id: string, title?: string, description?: string, active?: boolean, lessons?: "ungroup" | "deactivate" }`  
**Output:** `{ sub_unit: { sub_unit_id, unit_id, title, description, active } | null }`

---

#### `set_lesson_sub_unit`
Puts a lesson in a sub unit of its own unit, or takes it out with
`sub_unit_id: null`. It joins at the end of the sub unit; taken out, it sits
just after it. A sub unit from another unit, or an intervention, is refused.
Returns the unit's lessons in their new order.

**Input:** `{ lesson_id: string, sub_unit_id: string | null }`  
**Output:** `{ lessons: [{ lesson_id, unit_id, title, description, is_active, order_index, sub_unit_id }] | null }`

---

### Activities

#### `get_activities_for_lesson`
Lists all active activities for a lesson.

**Input:** `{ lesson_id: string }`  
**Output:** `{ activities: [{ activity_id, lesson_id, title, type, order_index, is_summative, active }] }`

---

#### `get_activity`
Returns one activity in full: its `body_data` (Display Text's `text` and `displayType`, a question and model answer, MCQ options, flashcards, …), teacher `notes`, `max_marks` and linked success criteria. `get_activities_for_lesson` stays a short list without bodies.

To change part of `body_data`, pass only the changed fields to `update_activity` rather than resending the whole body. A body holding inline base64 images can be too large to read or resend; run `move_activity_images_to_files` first.

**Input:** `{ activity_id: string }`  
**Output:** `{ activity: { activity_id, lesson_id, title, type, order_index, is_summative, active, body_data, notes, max_marks, success_criteria: [{ success_criteria_id, description, sc_type }] } | null }`

---

#### `create_activity`
Creates an activity under a lesson.

Scorable types: `multiple-choice-question`, `short-text-question`, `text-question`, `long-text-question`, `upload-file`, `upload-url`, `feedback`, `sketch-render`, `group-items`, `matcher`, `sequence`  
Non-scorable types: `text`, `display-image`, `display-webpage`, `display-flashcards`, `file-download`, `show-video`, `voice`, `share-my-work`, `review-others-work`, `display-section`

`do-flashcards` is a legacy type. Asking for one returns an error and nothing is written. Existing do-flashcards activities still work. The list of legacy types is `LEGACY_ACTIVITY_TYPES` in `src/dino.config.ts`.

Setting `is_summative = true` on a non-scorable type returns an error without writing to the DB.

`max_marks` sets the marks the activity is out of, for example 6 for a "(6 marks)" question. If it is left out, a `short-text-question` is out of 3 and every other type out of 1, the same defaults as the app's form. It is refused for non-scorable types and for `matcher` and `group-items`, which are always worth one mark per pair or item. Linking success criteria afterwards replaces it with the marks the criteria are worth.

**Input:** `{ lesson_id: string, type: ActivityType, title?: string, body_data?: object, is_summative?: boolean, max_marks?: number }`  
**Output:** `{ activity: { activity_id, lesson_id, title, type, order_index, is_summative, active } | null }`

##### Flashcard body_data format
`display-flashcards` stores card content as a `lines` string. Each line with `**answer**` syntax becomes one card:

```json
{
  "lines": "The **mitochondria** is the powerhouse of the cell\nPhotosynthesis converts **light energy** into chemical energy"
}
```

##### Display Web Page (`display-webpage`)
A web page activity shows one uploaded HTML file, a link to a website, or both. `body_data` is `{ "htmlFile"?: string, "url"?: string }`.

1. `create_activity` with `type: "display-webpage"`. Pass `body_data: { "url": "https://…" }` for a link, or no `body_data` if it will only have a page.
2. Upload one `.html` or `.htm` file with any activity upload route (the one-time upload link is easiest). Any other extension is refused.

The upload sets `htmlFile` to the new file and keeps `url`. A web page holds a single file, so uploading again replaces the page and deletes the old file. The result's `url` is `/api/activity-webpage/<activity_id>`, the sandboxed route that opens the page. It runs with scripts allowed but no network access and no access to DINO, so the page must be self-contained, with inline CSS, JS and `data:` images.

##### Limits on body_data
`group-items`, `matcher` and `sequence` bodies are checked against the same Zod schemas the app uses to display and mark them (`src/types/index.ts`). Before this check, MCP saved a body that broke these limits, for example a group-items activity with 13 items. The tool reported success, but the app could not parse the activity, so it failed without any message.

| Type | Field | Allowed |
|---|---|---|
| `group-items` | `groups` | 2–4 |
| `group-items` | `items` | 2–12, each `groupId` must match a group |
| `group-items` | item `text` / group `name` | ≤ 200 / ≤ 100 characters |
| `matcher` | `pairs` | 2–8 |
| `sequence` | `terms` | 2–12 |

A body that breaks a limit is refused and nothing is written. The result has `isError: true`, and the text starts with the code:

```
Error [LIMIT_EXCEEDED] body_data.items has 13 items, but a group-items activity allows at most 12 items. Split the content across more than one activity.
```

`structuredContent.error` is `{ code, field, limit, received }`. `code` is one of:
- `LIMIT_EXCEEDED`: too many entries or characters;
- `BELOW_MINIMUM`: too few;
- `INVALID_BODY_DATA`: a missing field, a wrong type, or a `groupId` that doesn't match a group.

`update_activity` applies the same checks.

---

#### `update_activity`
Updates an existing activity. Only provided fields are changed. Setting `is_summative = true` on a non-scorable type is rejected.

- **Patch `body_data`** without resending it. `question`, `model_answer`, `mcq_options` and `correct_option_id` set the question fields (stored as `question`, `modelAnswer`, `options`, `correctOptionId`). `body_data_patch` sets any other top-level fields; a field set to `null` is removed. Everything else in the body, such as images, is kept.
- **Replace `body_data`** as a whole with `body_data`. It cannot be combined with the patch fields.
- **Change `type`.** This is refused once pupils have submitted work for the activity. The body must suit the new type, so pass it in the same call. For example, a text activity holding a video link becomes `type: "show-video"` with `body_data: { fileUrl: "https://…" }`. A patch keeps the old type's fields, so pass `body_data` to drop them. `max_marks` resets to the new type's default (short-text-question 3, others 1), or to what its success criteria, pairs or items are worth. A change to a non-scorable type clears `is_summative`.

The resulting body is checked as `create_activity` checks it. A short-text-question needs `question` and `modelAnswer`; a multiple-choice question needs `question`, 2–4 options and a `correctOptionId` naming one of them; a show-video needs an http(s) `fileUrl`. An upload-code or upload-spreadsheet activity needs `task` and `markingGuidance`, on create as well as update, because the AI marker cannot mark without them; an activity created without them used to fail every pupil submission.

**Input:** `{ activity_id: string, title?: string | null, type?: string, question?: string, model_answer?: string, mcq_options?: [{ id, text, imageUrl? }], correct_option_id?: string, body_data_patch?: object, body_data?: object | null, is_summative?: boolean }`  
**Output:** `{ activity: { activity_id, lesson_id, title, type, order_index, is_summative, active } | null }`

A new `body_data` on a `matcher` or `group-items` also resets `max_marks` to the new pair or item count, as in the app.

---

#### `set_activity_max_marks`
Sets the marks an existing activity is out of. Marks pupils already hold are rescaled with it (`rescaleStoredMarks`), so a pupil on full marks stays on full marks.

Refused with `isError` and nothing written:
- for non-scorable types;
- for `matcher` and `group-items`, whose marks come from their pairs and items;
- for an activity with success criteria linked. Its `max_marks` is derived from them (binary = 1, levelled = 1 per descriptor), so change the criteria instead.

**Input:** `{ activity_id: string, max_marks: number }`  
**Output:** `{ activity: { activity_id, type, title, previous_max_marks, max_marks, rescaled_submissions } | null }`

---

#### `add_success_criterion_to_activity`
Links a success criterion to an activity via `activity_success_criteria`. Validates both exist. Silently skips if already linked.

**Input:** `{ activity_id: string, success_criteria_id: string }`  
**Output:** `{ link: { activity_id, success_criteria_id, already_linked } | null }`

---

#### `remove_success_criterion_from_activity`
Unlinks a success criterion from an activity (deletes the `activity_success_criteria` row only; the criterion itself is untouched). `removed` is `false` if no such link existed.

**Input:** `{ activity_id: string, success_criteria_id: string }`  
**Output:** `{ activity_id, success_criteria_id, removed }`

---

#### `reorder_activities`
Sets the order of a lesson's activities. `activity_ids` must list every active activity in the lesson exactly once, first to last — a partial list, a duplicate, or an id from another lesson is rejected and nothing changes. Inactive activities keep their relative order after the active ones. Returns the activities in their new order.

**Input:** `{ lesson_id: string, activity_ids: string[] }`  
**Output:** `{ activities: [{ activity_id, lesson_id, title, type, order_index, is_summative, active }] | null }`

---

#### `remove_activity`
Permanently deletes an activity and its `activity_success_criteria` links.

**Input:** `{ activity_id: string, lesson_id: string }`  
**Output:** `{ removed: { activity_id, lesson_id } | null }`

---

### File Uploads

Two strategies are supported depending on the client's capabilities:

#### Strategy A — base64 (small files only, ≤ ~18 KB raw)

##### `upload_lesson_file`
Uploads a base64-encoded file to the lesson's private teacher file store. Not visible to pupils. Max 5 MB.

**Input:** `{ lesson_id: string, file_name: string, base64_content: string, content_type?: string }`  
**Output:** `{ file: { lesson_id, file_name, size_bytes, url } | null }`

##### `upload_activity_file`
Uploads a base64-encoded file to a `file-download` activity (so pupils can download it) a `display-image` activity (to set its image), or a `display-webpage` activity (its HTML page). Max 5 MB.

**Input:** `{ lesson_id: string, activity_id: string, file_name: string, base64_content: string, content_type?: string }`  
**Output:** `{ file: { activity_id, lesson_id, file_name, size_bytes, url } | null }`

---

#### Strategy D — one-time upload link (recommended for files Claude makes)

For a file that exists only in Claude's code sandbox, such as a deck it has just built. The sandbox has no copy of the connector's credentials, so the link carries its own narrow permission (migration 107):

##### `create_activity_file_upload_link`
**Input:** `{ lesson_id: string, activity_id: string, file_name?: string }`  
**Output:** `{ link: { upload_url, expires_at, max_bytes, instructions } | null }`

##### `create_lesson_file_upload_link`
**Input:** `{ lesson_id: string, file_name?: string }`  
**Output:** `{ link: { upload_url, expires_at, max_bytes, instructions } | null }`

Then, from the sandbox:

```bash
curl -sS -F "file=@deck.pptx" "<upload_url>"
# or raw bytes:
curl -sS -X PUT --data-binary @deck.pptx "<upload_url>?file_name=deck.pptx"
```

- A link accepts **one** file, for the one activity or lesson it was made for, and expires after **15 minutes**. A failed upload releases the link so it can be retried before expiry.
- Only a SHA-256 hash of the token is stored (`mcp_upload_links`). The link records the teacher who asked for it, and the upload is logged in `mcp_audit_log` as `file_upload:link` under that teacher.
- Max 5 MB. HTML and SVG are refused, because uploads are served inline from DINO's origin.
- If curl cannot connect, the sandbox's network allowlist is blocking DINO's host. In Claude's settings, allow the domain (e.g. `dino.mr-salih.org`) for code execution.

---

#### Strategy C — by link (recommended for Claude Desktop / claude.ai)

Claude's chat apps cannot reliably pass a file of more than a few hundred KB as base64, and their sandbox does not hold the connector's credentials, so neither strategy A nor B works from there. These tools take a link and DINO downloads the file itself.

##### `upload_activity_file_from_url`
Downloads a file into a `file-download`, `display-image` or `display-webpage` activity. A link that serves HTML as `text/html` is still refused, because that is usually a viewer or sign-in page rather than the file; use a one-time upload link for an HTML page instead.

**Input:** `{ lesson_id: string, activity_id: string, url: string, file_name?: string }`  
**Output:** `{ file: { activity_id, lesson_id, file_name, size_bytes, url } | null }`

##### `upload_lesson_file_from_url`
Downloads a file into the lesson's private teacher file store.

**Input:** `{ lesson_id: string, url: string, file_name?: string }`  
**Output:** `{ file: { lesson_id, file_name, size_bytes, url } | null }`

What the link may be:

- A Google Drive file shared **"Anyone with the link"** — its ordinary share link is rewritten to the download URL.
- A Google Slides / Docs / Sheets link, exported as `.pptx` / `.docx` / `.xlsx`.
- Any other public `https://` direct download link.

`file_name` defaults to the name the server sends (`Content-Disposition`), then the URL path, and is reduced to one safe path segment either way. Max 5 MB, as for every MCP upload.

Because the server makes the request, `src/lib/mcp/file-input.ts` guards it against SSRF: `https` on port 443 only, no credentials in the URL, and every address the host resolves to must be public — checked inside the socket's own DNS lookup so a name cannot rebind to a private address after the check. Redirects (max 5) are re-checked hop by hop. Responses that are web pages (`text/html`, usually a viewer or sign-in page) and SVGs (which can carry script and are served inline) are refused.

---

#### Strategy B — direct multipart POST (recommended for larger files)

Use the info tools to get the upload parameters, then POST the file directly — no base64 encoding, no token-limit issues.

The info tools return **no credential**. Send the same `Authorization` header
the client already uses for the MCP connection — the service key or the
teacher's OAuth access token. (They once returned the service key, which handed
a never-expiring master key to any OAuth-connected client.)

##### `get_lesson_file_upload_info`
Returns everything needed to POST a file directly to the lesson teacher file store.

**Input:** `{ lesson_id: string }`  
**Output:**
```json
{
  "upload_url": "https://dino.mr-salih.org/api/MCP/files/lesson",
  "method": "POST",
  "form_fields": { "lesson_id": "<lesson_id>" },
  "instructions": "Send a multipart/form-data POST with your MCP Authorization header. File field name: 'file'. Max 5 MB."
}
```

##### `get_activity_file_upload_info`
Returns everything needed to POST a file directly to a `file-download`, `display-image` or `display-webpage` activity. The route uses the same `uploadActivityFile` as the upload tools, so the checks and `body_data` updates are identical.

**Input:** `{ lesson_id: string, activity_id: string }`  
**Output:**
```json
{
  "upload_url": "https://dino.mr-salih.org/api/MCP/files/activity",
  "method": "POST",
  "form_fields": { "lesson_id": "<lesson_id>", "activity_id": "<activity_id>" },
  "instructions": "Send a multipart/form-data POST with your MCP Authorization header. File field name: 'file'. Max 5 MB. Activity must be type file-download, display-image or display-webpage."
}
```

##### Direct upload endpoints (auth: `MCP_SERVICE_KEY` or an OAuth access token, as Bearer)

| Endpoint | Purpose |
|---|---|
| `POST /api/MCP/files/lesson` | Upload to lesson teacher file store |
| `POST /api/MCP/files/activity` | Upload to a `file-download`, `display-image` or `display-webpage` activity |

---

### File Downloads

#### `list_lesson_files`
Lists a lesson's teacher files: its private lesson files (`activity_id: null`) and the files attached to its activities. Pupils' uploaded work, which is stored one folder below each activity, is never listed or downloadable.

**Input:** `{ lesson_id: string }`  
**Output:** `{ files: [{ lesson_id, activity_id, activity_title, activity_type, file_name, size_bytes, content_type, updated_at }] | null }`

#### `get_lesson_file_download_link`
Returns a one-time link that downloads one file from `list_lesson_files` with a plain `curl` GET and no credentials, for Claude's code sandbox. Pass `lesson_id`, `activity_id` (omit it for a lesson file) and `file_name` exactly as listed.

This is the second deliberate exception to "no credentials in tool output", alongside the upload links: one file, single use, 15 minutes, only a SHA-256 hash stored (`mcp_download_links`, migration 112). The download is logged in `mcp_audit_log` as `file_download:link`, attributed to the teacher who asked for the link. The file is always served as an `application/octet-stream` attachment. A failed download gives the link back for a retry.

**Input:** `{ lesson_id: string, activity_id?: string, file_name: string }`  
**Output:** `{ link: { download_url, expires_at, file, instructions } | null }`

Endpoint: `GET /api/MCP/download/<token>`.

---

### Removing files

#### `remove_lesson_file`
Deletes one of a lesson's private teacher files, such as an old deck or a timestamped copy. `file_name` must be exactly as `list_lesson_files` gives it, where lesson files have `activity_id: null`.

**Input:** `{ lesson_id: string, file_name: string }`  
**Output:** `{ file: { lesson_id, file_name } | null }`

#### `remove_activity_file`
Deletes one teacher file from an activity, such as one of a file-download's sheets. To replace a file, remove it and upload the new one.

Some fields of `body_data` name a file: a display-image's `imageFile`/`fileUrl`, a display-webpage's `htmlFile`, and an MCQ's `imageFile`. If one of them names the removed file, it is cleared (`cleared_fields`). `still_referenced` is `true` when body text still links to the file, for example an `<img>` in a question.

**Input:** `{ activity_id: string, file_name: string }`  
**Output:** `{ file: { activity_id, lesson_id, file_name, cleared_fields: string[], still_referenced } | null }`

---

### Question images

Images pasted into a question in the app are stored inline in `body_data` as base64 `data:` URLs. One such question can be hundreds of KB, which makes it impractical to read or resend. These tools store images as files in the activity's folder, and `body_data` links to them by URL (`/api/files/lessons/<lesson>/activities/<activity>/<file>`). Pupils see the same image.

They are refused for `file-download` activities, because every file in that folder is offered to pupils as a download. They are also refused for `display-image` and `display-webpage` activities; use `upload_activity_file` for those.

#### `upload_activity_image`
Stores one png, jpg, gif or webp image with an activity. Pass `base64_content` with a `file_name`, or a public https `url` that DINO downloads. The limit is 5 MB. Put the returned `url` in the body, either as `<img src="url">` in a question via `update_activity` or as an MCQ option's `imageUrl`.

**Input:** `{ activity_id: string, file_name?: string, base64_content?: string, url?: string }`  
**Output:** `{ image: { activity_id, lesson_id, file_name, size_bytes, url, img_tag } | null }`

#### `move_activity_images_to_files`
Moves every inline base64 image in an activity's `body_data` into a file and points the body at it. Nothing else in the body changes. Identical images become one file, named `image-<hash>.<ext>`. The write is compare-and-set: if the activity is edited meanwhile, the call fails and is safe to repeat.

**Input:** `{ activity_id: string }`  
**Output:** `{ result: { activity_id, images_moved, body_bytes_before, body_bytes_after, files: string[] } | null }`

---

### Teachers, Groups & Timetable

Tools do not act as the connected teacher (the service key carries no user
identity at all), so every timetable call names its teacher explicitly. `teacher` accepts an **email or a
user id** — email is usually what a caller has to hand.

A slot is uniquely `(teacher, day, period)`, so there is no separate create and
update: `set_timetable_slot` upserts. Three states, and they differ:

| State | Meaning |
|---|---|
| no row | the slot has never been set |
| row, `group_id: null` | explicitly no class |
| row, `group_id` set | that class |

The planner renders the first two the same, but deleting a slot and marking it
free are different operations, so both exist.

Days: `sunday, monday, tuesday, wednesday, thursday`. Periods: `1`–`7`.

#### `list_teachers`
Every teacher, for finding the identifier the timetable tools need.

**Input:** none  
**Output:** `{ teachers: [{ user_id, name, email }] }`

---

#### `list_groups`
Teaching groups (classes). Retired classes are excluded by default.

**Input:** `{ include_inactive?: boolean }`  
**Output:** `{ groups: [{ group_id, subject, is_active }] }`

---

#### `get_timetable_slots`
A teacher's timetable, ordered by day then period.

**Input:** `{ teacher: string }`  
**Output:** `{ teacher_id, slots: [{ day, period, group_id }] }`

---

#### `set_timetable_slot`
Creates or updates one slot. **Omit `group_id` to mark the slot as no class.**
The group is checked to exist first, so an unknown class gives a usable error
rather than a constraint violation.

**Input:** `{ teacher: string, day: string, period: number, group_id?: string }`  
**Output:** `{ teacher_id, slot: { day, period, group_id } }`

---

#### `delete_timetable_slot`
Removes a slot entirely, as though never set. Returns `deleted: false` when
there was nothing there, rather than erroring.

**Input:** `{ teacher: string, day: string, period: number }`  
**Output:** `{ teacher_id, deleted: boolean }`

---

### Lesson assignments

Read-only. Which lessons each class has been given and when, from the
planner. Assignments are made in the planner, not over MCP.

#### `list_lesson_assignments`
One row per (class, lesson), newest first.

- `start_date` — the week (Sunday) the class first has the lesson. Progress,
  My Units and due dates all work from this date.
- `due_date` — `start_date` + 7 days (`src/lib/lesson-due-date.ts`).
- `sessions` — every planned slot, with its calendar `date`, `day` and `period`.
  A lesson taught over two slots has two sessions.
- `locked` — pupils can view the lesson but not change answers.
  `feedback_visible` — pupils can see their feedback.

`from` / `to` (yyyy-MM-dd, inclusive) filter on `start_date`. Inactive lessons
are left out. Retired classes are left out unless `include_inactive` is true or
`group_id` names one.

**Input:** `{ group_id?: string, unit_id?: string, lesson_id?: string, from?: string, to?: string, include_inactive?: boolean }`  
**Output:** `{ assignments: [{ group_id, group_subject, lesson_id, lesson_title, unit_id, unit_title, start_date, due_date, locked, feedback_visible, sessions: [{ date, week_start_date, day, period }] }] | null }`

---

### Assessment papers

Written papers marked outside a lesson (e.g. "Practice B"). Results live in
their own tables (`104-assessments.sql`) and never touch submissions or
reports. **Not** the curriculum's assessment objectives — hence the
`*_assessment_paper*` names.

**Workflow**

1. `get_all_los_and_scs_for_curriculum` — find the curriculum learning objectives the paper's objectives map to.
2. `list_assessment_papers` — check the paper does not already exist.
3. `create_assessment_paper` — title, date, curriculum, groups, objectives.
4. `set_assessment_paper_questions` — every marked part.
5. `list_group_pupils` — real pupil ids. Never guess an id from a name; report unmatched pupils to the user.
6. `record_assessment_paper_result` — one pupil per call.
7. `get_assessment_paper` — verify totals.

**Rules**

- **Computed totals.** Totals and per-objective subtotals are summed from mark rows on every read. Never send them. They count **only the questions that have a mark**: `total_available` (and each objective's `available`) is the sum of `max_marks` over that pupil's marked questions, so a partly marked script reads e.g. 18/30 rather than 18/38. `marked_questions` and `question_count` say how complete the marking is; an objective with no marked questions has `available: 0`.
- **One-to-one LO mapping.** Each paper objective (`LO1`, `LO2`…) may link to at most one curriculum learning objective, which must belong to the paper's curriculum, and each learning objective may be linked at most once per paper. Changing a link never touches questions or marks.
- **Provenance.** Marks and whole-paper feedback written through MCP are `ai`. A row a teacher has edited is `teacher` and is never overwritten; `record_assessment_paper_result` lists such labels in `skipped_teacher_edited` (and sets `feedback_skipped_teacher_edited`).
- **Idempotent.** Every write tool can be re-run with the same input. `set_*` tools take the full list and upsert by `code` / `label`; list order is the position.
- **All or nothing.** Any validation problem (unknown label, mark above max, duplicate label…) rejects the whole call with a message naming the offender, and nothing is saved.
- **Arrays as JSON.** Every array input also accepts a JSON-encoded string.

#### `list_assessment_papers`
**Input:** `{ group_id?: string }`
**Output:** `{ assessments: [{ assessment_id, title, assessed_on, curriculum_id, curriculum_title, group_ids, objective_count, unlinked_objective_count, question_count, total_marks, pupils_with_results, feedback_visible }] }` — newest first.

#### `get_assessment_paper`
**Input:** `{ assessment_id }`
**Output:** `{ assessment: { …header, objectives: [{code, position, title, learning_objective_id, learning_objective_title}], questions: [{label, position, max_marks, objective_code, correct_answer}], total_marks, pupils: [{pupil_id, first_name, last_name, total_awarded, total_available, percent, marked_questions, question_count, objectives: [{code, awarded, available}]}] } }` — `pupils` lists only pupils with at least one mark.

#### `get_assessment_paper_result`
**Input:** `{ assessment_id, pupil_id }`
**Output:** `{ result: { assessment, pupil totals (total_awarded, total_available, percent, marked_questions, question_count), objectives, questions: [{label, objective_code, max_marks, correct_answer, awarded|null, why_not_awarded, how_to_improve, provenance|null}], went_well, targets } }`

#### `create_assessment_paper`
**Input:** `{ title, assessed_on: "YYYY-MM-DD", curriculum_id, group_ids: string[], objectives: [{ code?, title?, learning_objective_id? }] }`
`code` defaults to `LO{n}` by position; `title` defaults to the linked learning objective's title and is required when there is no link.
**Output:** `{ assessment }`

#### `set_assessment_paper_objectives`
**Input:** `{ assessment_id, objectives: [{ code, title?, learning_objective_id? }] }`
Upsert by code. Omitted `title` / `learning_objective_id` keep their stored values; `null` or `""` clears a link. A code left out is deleted unless questions use it (error names the codes and question labels).
**Output:** `{ assessment }`

#### `map_assessment_paper_objective`
**Input:** `{ assessment_id, code, learning_objective_id: string | null }` — `null` or `""` clears the link.
**Output:** `{ assessment }`

#### `set_assessment_paper_questions`
**Input:** `{ assessment_id, questions: [{ label, max_marks, objective_code, correct_answer? }] }`
Send the full list. Labels left out are deleted unless they have marks (error). `max_marks` cannot drop below an awarded mark. Omitting `correct_answer` keeps the stored one.
**Output:** `{ assessment }`

#### `list_group_pupils`
**Input:** `{ group_id }`
**Output:** `{ pupils: [{ pupil_id, first_name, last_name, email }] }` — pupils only (pupil role and no staff role, the shared roster rule in `src/lib/roles/pupil-membership.ts`), by surname.

#### `record_assessment_paper_result`
**Input:** `{ assessment_id, pupil_id, marks: [{ label, awarded, why_not_awarded?, how_to_improve? }], went_well?: string[], targets?: string[] }`
The pupil must be a pupil (same roster rule) in one of the paper's groups. `awarded` is a whole number 0..`max_marks`. Text is trimmed; empty strings are stored as null.
**Output:** `{ written, skipped_teacher_edited: string[], feedback_skipped_teacher_edited, missing_labels: string[], result }` — `missing_labels` are paper questions this pupil still has no mark for.

#### `attach_assessment_paper_file`
**Input:** `{ assessment_id, file_name, base64_content, content_type? }` — max 5 MB, no `/` or `\` in the name.
**Output:** `{ file: { assessment_id, file_name, size_bytes, path } }` — `path` is the `/api/files/assessments/…` download URL. Downloads from the `assessments` bucket are teacher-only (403 otherwise).

#### `create_assessment_paper_file_upload_link`
Use this to attach scans of pupils' papers that are in Claude's code sandbox. It works like the lesson upload links (migration 107, and migration 114 for papers): the link can be used once, lasts 15 minutes and takes one file of up to 25 MB, with no credentials. HTML and SVG files are refused. Teachers can also upload the same files from the paper's ⋯ menu → *Scans & files* on the Assessments page.
**Input:** `{ assessment_id, pupil_id?, file_name? }`. For a pupil's script, pass `pupil_id` to link the file to that pupil (migration 115). Leave it out for files that cover the whole paper, such as the question paper or mark scheme; these stay teacher-only. MCP uploads never match pupils by name. Only uploads made by teachers on the page are linked from the file name ("Surname Firstname …").
**Output:** `{ link: { upload_url, expires_at, max_bytes, instructions } }`

#### `list_assessment_paper_files`
**Input:** `{ assessment_id }`
**Output:** `{ files: [{ assessment_id, file_name, size_bytes, path, pupil_id }] }`

#### `remove_assessment_paper_file`
Deletes a file from the paper, along with any link to a pupil. This can't be undone.
**Input:** `{ assessment_id, file_name }`
**Output:** `{ removed }`

#### `link_assessment_paper_file_to_pupil`
Records whose script a file is. Once the paper's feedback is released, the linked pupil can open it from *My Assessments*. Unlinked files stay teacher-only.
**Input:** `{ assessment_id, file_name, pupil_id | null }`. Pass `null` to unlink.
**Output:** `{ file }`

---

### Pupil feedback

These two tools follow the same flow as the assignment results page. Writes go through the same shared functions as the page (`src/lib/feedback/teacher-feedback.ts`), so the rules match: a criterion edit becomes a teacher mark that survives a re-mark, the activity total is recalculated, and an overall edit is recorded in the pupil's feedback history. Neither tool changes whether the pupil can see feedback. That is still controlled by the assignment's feedback switch. With feedback switched on, the pupil sees an edit straight away.

#### `get_pupil_lesson_feedback`
Returns one pupil's work and feedback on a lesson's marked activities, or on one activity if `activity_id` is given. For each activity it returns:
- the pupil's answer, with pasted images left out, and any uploaded file names;
- `status` (`override` means a teacher set the mark), plus `score` and `marks_awarded` out of `max_marks`. A missing answer has `status: "missing"` and `marks_awarded: 0`, because missing work counts as 0 everywhere in DINO. When `submission_id` is null the pupil didn't answer; when it's set, the answer hasn't been marked yet;
- the overall `teacher_feedback` and `auto_feedback`;
- per success criterion: the mark, the comment the pupil is shown, the AI's comment, the teacher's comment and `provenance`.

`feedback_visibility` lists the pupil's class assignments and interventions for the lesson, and says whether feedback is switched on for any of them.

**Input:** `{ pupil_id: string, lesson_id: string, activity_id?: string }`  
`totals` gives the lesson score on the same baseline as every report: `marks_awarded` out of the full `max_marks` of every marked activity, and `percent`. It also counts `unanswered` and `not_yet_marked` questions.

**Output:** `{ feedback: { pupil_id, lesson_id, lesson_title, feedback_visibility: { assigned, visible_to_pupil, assignments }, totals: { marks_awarded, max_marks, percent, unanswered, not_yet_marked }, activities: [...] } | null }`

#### `set_pupil_feedback`
Sets a mark and/or comment on one activity for one pupil.

- **Overall** (leave out `success_criteria_id`): the whole-activity override from the results page. `marks` (0 to `max_marks`) and `feedback` are saved together, as on the page. Whichever one you leave out keeps its current value. If the pupil hasn't submitted, a submission is created, as on the page.
- **Per criterion** (pass `success_criteria_id`): `marks` (0 to the criterion's `available`) makes the row a teacher mark. `feedback` sets the teacher's comment, which replaces the AI's. Either can be given alone. This needs a submission that has criterion marks.

`feedback: ""` clears a comment. The reply contains the activity's updated feedback and its visibility.

**Input:** `{ pupil_id: string, activity_id: string, success_criteria_id?: string, marks?: number, feedback?: string }`  
**Output:** `{ result: { activity, feedback_visibility } | null }`

---

### Interventions

A lesson written for **one pupil** and assigned to them alone (`108-interventions.sql`).
Underneath it is an ordinary lesson (`lessons.kind = 'intervention'`), so every
activity, marking and success-criterion tool works on it unchanged. It sits in the
unit whose material it covers, but never appears in that unit's lesson list
(`get_lessons_for_unit`), the planner, class reports, the dashboard or the public
browser — the database refuses to plan it for a class or make it public. Only its
pupil can open it, under **My Interventions**; any teacher can see it at
`/interventions` and on the pupil's report.

Interventions are created **only through MCP**. The app reads them.

**Workflow**

1. `list_groups` → `list_group_pupils` — the real pupil id. Never guess one from a name.
2. `get_pupil_gaps` — the pupil's weakest learning objectives and success criteria.
3. `create_intervention` — makes the lesson in the right unit, links target LOs, assigns it.
4. `create_activity` on the returned `lesson_id`, then `add_success_criterion_to_activity` for the criteria being targeted.
5. `list_interventions` — check it, and later its progress and score.

**Rules**

- **One pupil each.** For several pupils, create one intervention per pupil, each written for that pupil's gaps.
- **Derived status.** `assigned` (nothing handed in) → `in_progress` → `completed` (every active scorable activity has a submission). Only `cancelled` is stored. An intervention with no scorable activities never completes.
- **Deleted interventions.** A teacher can delete interventions on `/interventions` (migration 109, `intervention_assignments.active = false`). Deleting is soft — the lesson and work are kept — but a deleted intervention is gone from every MCP tool, report and list, and `update_intervention` reports it as not found. There is no MCP tool to delete or restore one.
- **Score** is the mean of the scored activities' scores (0–1), from `compute_submission_base_score` on the pupil's current attempt.
- **Kept separate.** Intervention scores never feed class averages or the pupil's normal LO results, and `get_pupil_gaps` ignores intervention work.
- **Feedback straight away.** The pupil sees marks and feedback as soon as each activity is marked; there is no release switch.
- **Fixed kind.** A lesson can never be switched between standard and intervention.

#### `get_pupil_gaps`
**Input:** `{ pupil_id, curriculum_id?, unit_id? }`
**Output:** `{ gaps: [{ learning_objective_id, title, curriculum_id, lowest_score, lesson_work: { awarded, available, score, criteria: [{ success_criteria_id, description, awarded, available, score }] } | null, assessments: [{ assessment_id, title, assessed_on, awarded, available, score }] }] }` — weakest first. `lesson_work` comes from per-criterion marks on class lessons (`legacy` marks excluded); `assessments` from written papers whose objectives are linked to that LO. `unit_id` narrows lesson work only.

#### `create_intervention`
**Input:** `{ pupil_id, unit_id, title, reason?, due_date? (YYYY-MM-DD), group_id?, source_assessment_id?, learning_objective_ids?: string[] }`
**Output:** `{ intervention: InterventionSummary }`

`group_id` defaults to the pupil's only class (left empty if they are in several). Target LOs must belong to the unit's curriculum. The setting teacher is recorded from the OAuth sign-in.

#### `list_interventions`
**Input:** `{ pupil_id?, group_id?, statuses?: ("assigned"|"in_progress"|"completed"|"cancelled")[] }`
**Output:** `{ interventions: InterventionSummary[] }` — newest first.

`InterventionSummary` = `{ intervention_id, lesson_id, lesson_title, unit_id, unit_title, pupil_id, pupil_name, group_id, set_by_name, set_at, due_date, reason, source_assessment_id, status, overdue, started_at, completed_at, scorable_activities, submitted_activities, scored_activities, score, learning_objectives: [{ learning_objective_id, title }] }`

#### `update_intervention`
**Input:** `{ intervention_id, title?, due_date? ("" clears), reason?, cancelled?: boolean, feedback_visible?: boolean, locked?: boolean }`
**Output:** `{ intervention: InterventionSummary }`

Cancelling hides it from the pupil and blocks them opening it; their work is kept. `cancelled: false` restores it.

`feedback_visible` (migration 110, on by default) decides whether the pupil sees marks and feedback as soon as they exist. Teachers can also switch it on `/interventions`; a change reaches a pupil's open lesson page live.

`locked` (migration 111, off by default) makes the intervention read-only for the pupil, exactly as locking a class lesson does: they can open it but cannot change answers, upload or download files. The server enforces it (`src/lib/lesson-lock.ts`).

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
| `src/lib/mcp/guards.ts` | `assertUnitExists` / `assertLessonExists` — clear "not found" errors before a write |
| `src/lib/mcp/audit.ts` | `recordMcpCall` — writes `mcp_audit_log` |
| `src/lib/mcp/upload-links.ts` | Create / claim / release one-time upload links |
| `src/app/api/MCP/upload/[token]/route.ts` | The endpoint a one-time upload link points at |
| `src/lib/mcp/file-input.ts` | Base64 decoding, the shared 5 MB limit, and the SSRF-guarded fetch behind the `*_from_url` tools |
| `src/lib/mcp/curriculum.ts` | Curriculum read/write helpers |
| `src/lib/mcp/units.ts` | Unit read/write helpers |
| `src/lib/mcp/lessons.ts` | Lesson read/write/upload helpers |
| `src/lib/mcp/losc.ts` | AO / LO / SC read/write helpers |
| `src/lib/mcp/activities.ts` | Activity read/write/upload helpers |
| `src/lib/mcp/timetable.ts` | Teacher / group lookup and timetable slot CRUD |
| `src/lib/sub-units/store.ts` | Sub unit reads/writes and the keep-together rule, shared with the unit page |
| `src/lib/mcp/assignments.ts` | Read-only lesson assignments (class, lesson, dates) from the planner |
| `src/lib/interventions/store.ts` | Intervention reads/writes, derived status and score, pupil gaps, and the pupil access rule |
| `src/lib/assessments/store.ts` | Assessment paper reads/writes (shared with future server actions) |
