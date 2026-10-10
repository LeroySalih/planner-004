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
Updates a success criterion's `description`, `level` (1–9), and/or `active`. Omitted fields keep their current value.

**Input:** `{ success_criteria_id: string, description?: string, level?: number, active?: boolean }`  
**Output:** `{ success_criterion: { success_criteria_id, learning_objective_id, description, level, order_index, active } | null }`

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

### Lessons

#### `get_lessons_for_unit`
Lists all lessons for a unit.

**Input:** `{ unit_id: string }`  
**Output:** `{ lessons: [{ lesson_id, unit_id, title, is_active, order_index }] }`

---

#### `get_lesson_objectives`
Returns everything linked to a lesson: its learning objectives, the success criteria under each (ordered as in the curriculum), and which of the lesson's active activities use each criterion. A criterion that only an activity links is still listed, with `linked_to_lesson: false`; likewise an LO reached only through one of its criteria. Use it to confirm links after `add_success_criterion_to_lesson` and to find stale ones.

**Input:** `{ lesson_id: string }`  
**Output:** `{ lesson: { lesson_id, unit_id, title, learning_objectives: [{ learning_objective_id, assessment_objective_code, title, active, linked_to_lesson, success_criteria: [{ success_criteria_id, description, level, active, linked_to_lesson, activities: [{ activity_id, title, type }] }] }] } | null }`

---

#### `create_lesson`
Creates a lesson under a unit. Appended at the end of the unit's lesson order.

**Input:** `{ unit_id: string, title: string }`  
**Output:** `{ lesson: { lesson_id, unit_id, title, is_active, order_index } | null }`

---

#### `update_lesson`
Renames a lesson. Lessons have no description column, so title is the only field.

**Input:** `{ lesson_id: string, title: string }`  
**Output:** `{ lesson: { lesson_id, unit_id, title, is_active, order_index } | null }`

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

### Activities

#### `get_activities_for_lesson`
Lists all active activities for a lesson.

**Input:** `{ lesson_id: string }`  
**Output:** `{ activities: [{ activity_id, lesson_id, title, type, order_index, is_summative, active }] }`

---

#### `get_activity`
Returns one activity in full: its `body_data` (Display Text's `text` and `displayType`, a question and model answer, MCQ options, flashcards, …), teacher `notes`, `max_marks` and linked success criteria. `get_activities_for_lesson` stays a short list without bodies.

Read it before `update_activity`: `body_data` is replaced as a whole, so send back the complete object with your changes — e.g. to switch a Display Text to an exam tip, resend `text` along with `displayType: "exam-tip"`.

**Input:** `{ activity_id: string }`  
**Output:** `{ activity: { activity_id, lesson_id, title, type, order_index, is_summative, active, body_data, notes, max_marks, success_criteria: [{ success_criteria_id, description, sc_type }] } | null }`

---

#### `create_activity`
Creates an activity under a lesson.

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
Updates `title`, `body_data`, and/or `is_summative` on an existing activity. Only provided fields are changed — omitted fields are left as-is. Setting `is_summative = true` on a non-scorable type is rejected.

**Input:** `{ activity_id: string, title?: string | null, body_data?: object | null, is_summative?: boolean }`  
**Output:** `{ activity: { activity_id, lesson_id, title, type, order_index, is_summative, active } | null }`

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
Uploads a base64-encoded file to a `file-download` activity (so pupils can download it) or a `display-image` activity (to set its image). Max 5 MB.

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
Downloads a file into a `file-download` or `display-image` activity.

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
Returns everything needed to POST a file directly to a `file-download` or `display-image` activity.

**Input:** `{ lesson_id: string, activity_id: string }`  
**Output:**
```json
{
  "upload_url": "https://dino.mr-salih.org/api/MCP/files/activity",
  "method": "POST",
  "form_fields": { "lesson_id": "<lesson_id>", "activity_id": "<activity_id>" },
  "instructions": "Send a multipart/form-data POST with your MCP Authorization header. File field name: 'file'. Max 5 MB. Activity must be type file-download or display-image."
}
```

##### Direct upload endpoints (auth: `MCP_SERVICE_KEY` or an OAuth access token, as Bearer)

| Endpoint | Purpose |
|---|---|
| `POST /api/MCP/files/lesson` | Upload to lesson teacher file store |
| `POST /api/MCP/files/activity` | Upload to a `file-download` or `display-image` activity |

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
| `src/lib/interventions/store.ts` | Intervention reads/writes, derived status and score, pupil gaps, and the pupil access rule |
| `src/lib/assessments/store.ts` | Assessment paper reads/writes (shared with future server actions) |
