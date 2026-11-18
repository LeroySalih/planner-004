# Database Assessment (`database-assessment`): Implementation Plan

> **For agentic workers:** carry out this plan one task at a time, using a fresh subagent for each task. After each task, run a spec-compliance review and then a code-quality review. Each task lists the files to touch, what to change, the checks to write, the commands to run and when it is done. **Subagents do not commit.**

## Goal

Add a new practical activity type, `database-assessment`. A pupil hands in two files:

1. a Microsoft Access database (`.accdb`);
2. an EVIDENCE `.docx`, with screenshots under headings 1–9 and typed Section B answers under headings B1–B8.

The work is marked per question, the same way as a PowerPoint assessment. The lifecycle is the same too:

- upload slots, and *Hand in* starts marking;
- teacher *Undo hand in* and *Request Resubmission*;
- an in-app read with no model, then one AI mark per question, with the mark scheme as the only standard;
- `ai_awarded`, Check/Confirm, pupil flags, the results panel, pupil feedback, feedback PDFs and MCP.

Whatever is read from the database goes to the marker as exact facts. Screenshots and typed answers come from the EVIDENCE document.

## Architecture summary

- **One set of practical-assessment machinery, two types.** PowerPoint's files, slots, hand-in, reopen, read/mark jobs, results, pupil view, feedback and MCP code becomes generic over a small **type registry**. Every type-specific part is either data in the registry or a branch on **slot kind** (not activity type) in the reader and marker. PowerPoint keeps exactly the same behaviour, prompts, cache keys, messages and MCP output. Its 11 checks plus `tests/pptx/inspect.check.ts` are the regression oracle, and they are not edited.
- **The `.accdb` reader is a new library, `src/lib/accdb/`.** It is the database equivalent of `src/lib/pptx/`:
  - It runs `mdbtools` (`mdb-ver`, `mdb-tables`, `mdb-schema`, `mdb-prop`, `mdb-json`, `mdb-queries`) with `execFile`, never a shell. Each command works on a temp copy and has a timeout and an output cap, like `src/lib/pdf/poppler.ts`.
  - It produces a structured `DatabaseSnapshot`: tables, fields, lookups, table sort, records, relationships, saved query designs, and forms/reports with their base table where one can be read.
  - It produces a diff against the activity's **starting database**.
  - It renders text sections that a question can select, in the same way as `describePresentationSections`.
- **The database type adds one new evidence source,** `database`. It takes section selectors. The type also reuses `evidence_section`, `file` and `reference_file`. It cannot use `presentation` or `slide_images`.
- **The starting database is an ordinary activity file.** It is named in `body_data.startingDatabaseFile`, the same pattern as `evidenceTemplateFile`. Pupils download it as the blank database, the reader diffs against it, and its sha256 is part of the cache key. No new table is needed.
- **Phase 1:** the model marks every question, and the database facts are given to it as exact. **Phase 2** (optional, last, can be deferred) adds rule checks, stored as data, whose results are given to the marker. They never mark on their own in v1.

## Key decisions, with reasons

1. **The modules stay in `src/lib/powerpoint-assessment/` in v1. Nothing is moved or renamed.** The PowerPoint checks import `@/lib/powerpoint-assessment/{files,jobs,reading,evidence-spec,...}`, as do roughly 30 app files. Moving them would churn about 16k lines and the regression tests. Instead, the header comment of each module says it serves every practical type. Exported names such as `storePracticalFile`, `handInPowerPointAssessment` and `reopenPowerPointAssessment` are kept and now accept any practical type. A rename to `src/lib/practical-assessment/` is a mechanical follow-up and is not part of this plan.
2. **The registry is pure and client-safe:** `src/lib/practical-assessment/types.ts`. For each type it holds:
   - the label;
   - the body schema;
   - the allowed slot kinds;
   - the main kind (`pptx` or `accdb`), of which there must be exactly one required slot;
   - the allowed evidence sources;
   - the default body;
   - `hasSuppliedImages` (PowerPoint only);
   - `hasStartingDatabase` (database only).

   The marking texts (system prompt, evidence-naming phrase, report heading) are server-side, in a map in `marking.ts`. The PowerPoint strings stay byte-identical.
3. **The reader dispatches on slot kind, not type.** `accdb` is a new slot kind. `pptx` is accepted only by the PowerPoint schema and `accdb` only by the database schema, so dispatching on kind is the same as dispatching on type and adds no type branches to the reader.
4. **`PowerPointAssessmentActivityBodySchema` is unchanged.** Its enum, messages and checks stay as they are, so the PowerPoint error messages stay identical. A new `DatabaseAssessmentActivityBodySchema` is added. Both are built from a shared slot schema factory. A widened `PracticalUploadSlot` / `PracticalUploadSlotKind` type is used wherever code handles any practical slot.
5. **`validateQuestionEvidence(questions, body, type = "powerpoint-assessment")` gains a third parameter.** The default keeps the existing two-argument calls in the PowerPoint tests working. Every app call site passes the type explicitly.
6. **Result and MCP field names stay as they are** (`result.powerpoint`, `setup.powerpoint`, the MCP `powerpoint: {...}` object). They are filled in for any practical type. Renaming them would break the PowerPoint tests and MCP clients. `docs/MCP.md` will say the object is "practical files (PowerPoint or database assessment)". MCP `kind` is the activity type, so a database assessment reports `kind: "database-assessment"`.
7. **`hand_in_powerpoint_assessment` keeps its name and accepts both practical types.** Renaming an MCP tool would break clients. Its description says it also covers database assessments.
8. **`.mdb` files are refused.** The message tells the pupil to save as `.accdb`. Access 2007 and later saves `.accdb` by default, and the task hands out an `.accdb`. Access `.laccdb` lock files, files that are not Access databases, damaged files and password-protected files are refused at upload with the reader's message. A password and damage cannot be told apart reliably, so there is one combined message.
9. **Form and report design is not decoded.** The spike showed that fonts, sizes, borders, positions and sections cannot be tied to a control. The report gives only existence and the base table (from the hidden `~sq_f…` / `~sq_r…` queries). The marking system prompt says design must be judged from screenshots only.
10. **Dates.** Record dates are formatted DD-MM-YYYY by `mdb-json -D "%d-%m-%Y" -T "%d-%m-%Y %H:%M:%S"`, with a time of `00:00:00` removed. Query criteria keep Access's `#m/d/yyyy#` text exactly, with the date added in words, for example `<#1/1/2020# (1 January 2020)`. The model is told that Access writes criteria dates month-first.
11. **Relationships.** Referential integrity is derived with the DAO flag rule (`grbit & 2` means not enforced), and the report says so. The spike saw `grbit 0` with RI enforced, which matches. Section B marks never depend on it, because those questions are marked from text.
12. **Privacy:**
    - No pupil file name reaches a model, a job row or `ai_marking_logs`. The marker gets `slot_key.accdb`, and the read job row gets the slot label, file id and extension.
    - Database object names, records and SQL are the pupil's work, the same as slide text.
    - The EVIDENCE document's "Name / Class" lines are before the first heading. They are therefore *unplaced*, stay teacher-only and are never sent.
    - The database system prompt carries PowerPoint's anonymity paragraph, because report 8i's screenshot shows the pupil's name.
13. **Questions follow the mark scheme row by row:** 68 questions of 1 mark each, the same granularity as the 6.5 PowerPoint specs. Each row can then have its own evidence and `ai_check`.

## Call sites of `isPowerPointAssessmentType` and the `'powerpoint-assessment'` literal

**G = becomes practical-generic** (`isPracticalAssessmentType`, the registry, or a type parameter). **P = stays PowerPoint-only.**

| File : line | Today | Decision |
|---|---|---|
| `src/dino.config.ts` 20, 36, 142 | type lists | G: add `database-assessment` to SCORABLE, QUESTION_MARKED and AI_MARKED; add `PRACTICAL_ASSESSMENT_TYPES`, `isPracticalAssessmentType`, `isDatabaseAssessmentType` |
| `src/lib/ai/marking-queue.ts` 118 | enqueue branch | G (`enqueuePracticalSubmission`; per-type body schema; messages use the registry label) |
| `marking-queue.ts` 337 | `PowerPointAssessmentActivityBodySchema` | G (`practicalBodySchema(type)`) |
| `marking-queue.ts` 1111 | "Reading the files" | G |
| `marking-queue.ts` 1140 | jobs dispatch, log text | G (PowerPoint log text unchanged) |
| `src/lib/assessment-paper/store.ts` 243 | `checkQuestionEvidence` | G (passes the type) |
| `store.ts` 515/870 | `isPowerPointActivity` | G (rename to `isPracticalActivity`) |
| `store.ts` 732 | SQL `x.type = 'powerpoint-assessment'` | G (`x.type = any($n::text[])` with `PRACTICAL_ASSESSMENT_TYPES`) |
| `store.ts` 1051 | `selectHeldQuestionsToSend` | G |
| `src/lib/assessment-paper/results.ts` 183, `powerPointFiles` | files block | G (per-type body schema; adds database evidence text) |
| `src/lib/assessment-paper/feedback-pdf.ts` 101 | feedback readiness | G |
| `src/lib/assessment-paper/class-feedback-pdf.ts` 105 | "Not sat" = not handed in | G |
| `src/lib/assessment-paper/pupil-feedback.ts` 266 | question shown | G |
| `src/lib/assessment-paper/files.ts` 618 | paper-file access | G |
| `src/lib/assessment-paper/setup.ts` 53, 95, 125 | setup read | G (enum gains the type; `type: row.type`) |
| `src/lib/mcp/activities.ts` 188 | body validation | G (per-type schema and example in the message) |
| `mcp/activities.ts` 783 | slot change | G |
| `src/lib/mcp/upload-links.ts` 86, 119 | messages | G (label) |
| `upload-links.ts` 98 | `practical_file` / `supplied_image` | `practical_file` G; `supplied_image` **P** |
| `src/lib/mcp/assessment-activities.ts` 108 | `readPowerPointActivity` | G (rename to `readPracticalActivity`) |
| `assessment-activities.ts` 250, 554, 718 | evidence, result, message | G |
| `assessment-activities.ts` 372 | `kind`, body, `supplied_images` | G (`kind = type`); `supplied_images` P (`[]` for a database) |
| `assessment-activities.ts` 844 | `resolveLatestScript` refusal | G as `!isAssessmentPaperType`: "Practical assessments have no scripts…" (PowerPoint wording kept for PowerPoint) |
| `src/lib/server-actions/lesson-activities.ts` 62, 253, 264, 565, 633 | body merge, default, problem, slot change | G |
| `src/lib/server-actions/resubmit.ts` 95 | reopen | G |
| `src/lib/server-actions/assessment-paper-activity.ts` 157 | unmarked list | G |
| `src/lib/server-actions/short-text.ts` 193 (via `files.ts` 725) | not-queued reason | G |
| `src/lib/powerpoint-assessment/files.ts` 133 | `readPowerPointActivity` | G (`readPracticalActivity`) |
| `files.ts` 725, 752 (SQL literal), 959 (regex) | not-queued reason, unmarked list, pupil open | G (literal becomes `any($2)`; regex adds `accdb`) |
| `files.ts` `storeSuppliedImage`, `removeSuppliedImage`, `readKnownImages` | supplied images | **P** (assert PowerPoint) |
| `src/lib/powerpoint-assessment/pupil-view.ts` 112 | | G |
| `src/lib/powerpoint-assessment/editor.ts` 22 | template check | G; `renameSuppliedImage` **P** |
| `src/lib/powerpoint-assessment/reading.ts`, `marking.ts`, `jobs.ts`, `slot-changes.ts` | body schema, labels | G |
| `src/lib/server-actions/powerpoint-assessment.ts` | actions | G except the supplied-image actions (**P**) |
| `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx` 1030, 1200 | view map, render case | G (`case "database-assessment"` shares the render) |
| `src/components/assignment-results/assignment-results-dashboard.tsx` 544, 551 | texts | G |
| `src/components/lessons/lesson-activities-manager.tsx` 132, 906, 3930, 4431, 4675, 6012/6014, 6144 | picker option, branches | G (new option "Database Assessment") |
| `src/components/lessons/activity-view/index.tsx` 400, 1405 | short/present view | G |
| `src/app/api/MCP/route.ts` 3245–3290, hand-in tool | descriptions | G (adds `DATABASE_ASSESSMENT_WORKFLOW`) |
| `scripts/setup-powerpoint-assessment.ts` 160, 179 | creates the type | G (`spec.type`, default PowerPoint) |
| `scripts/copy-uploads-to-powerpoint-assessment.ts` | | **P** in v1 (optional Task 16) |
| `src/lib/pptx/*`, slide rendering, `presentation`/`slide_images` sources, `POWERPOINT_MARK_SYSTEM`, `PowerPointAssessmentActivityBodySchema` | | **P** |

Never use `isQuestionMarkedActivityType` where scripts, files or slots are involved. Use `isPracticalAssessmentType`, `isPowerPointAssessmentType`, `isDatabaseAssessmentType` or `isAssessmentPaperType`.

## Constraints every task must keep

- **No commits.** Never print secrets: do not echo `.env` or show `DATABASE_URL` / API keys in output. **No real AI marking calls**: checks run with `MARKING_QUEUE_SECRET=` (blank) and any model call is a fake `ModelJsonCall`. Never hand in through the live app, because the queue would call a model. **Do not touch prod.** `scripts/migrate.sh` on this host targets the dev DB in the local `db` container.
- **Node is not on the host.** Typecheck in the `dino-deps` image (known pre-existing errors are only `tests/prototypes/fast-ui.spec.ts` lines 20–21; never mount `next-env.d.ts`):
  ```
  docker run --rm -v /home/leroy/planner-004/src:/app/src:ro -v /home/leroy/planner-004/tests:/app/tests:ro -v /home/leroy/planner-004/scripts:/app/scripts:ro -v /home/leroy/planner-004/tsconfig.json:/app/tsconfig.json:ro -w /app dino-deps node --max-old-space-size=2500 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
  ```
- **Checks** are `tsx` scripts in the `dino-deps` image on the compose network. Use the parent's helper: `bash <scratchpad>/run-check.sh <path> [<path>…]`. It currently lives at `/tmp/claude-1000/-home-leroy-planner-004/19188b9c-3092-46bb-a313-62118fb0bb8b/scratchpad/run-check.sh`; the parent gives the path. Each check creates its own unit, lesson, activity, class and pupils, and removes them. It prints `PASS`/`FAIL` lines and exits non-zero on failure, in the style of `tests/powerpoint-assessment/*.check.ts`.
- **Untrusted files.** Pupil-style files are only ever read from a temp copy inside their own `mkdtemp` directory, which is always removed. The reader never runs anything from the file, and arguments are passed to `execFile`, never through a shell.
- **Rules from CLAUDE.md:**
  - Latest attempt only: `order by attempt_number desc, submitted_at desc nulls last, submission_id desc`.
  - A locked lesson blocks a pupil's uploads, hand-in and downloads, never staff's.
  - Teacher marks and comments always win.
  - Pupils never see `ai_awarded`, `marker_evidence` or the mark scheme PDF.
  - Dates are shown DD-MM-YYYY.
  - Two-space indentation.
  - Delete unused code rather than keeping compatibility shims.
- **Dev app rebuild:** only in Task 14. The host has 3.9 GB, so batch everything first. Run no other build at the same time.

---

## Task 0 (parent, before Task 1): prepare the check helper

- Add `mdbtools` to the `apt-get install` line in the parent's `run-check.sh`, next to `poppler-utils`.
- Confirm with `docker run --rm debian:bookworm-slim sh -c 'apt-get update -qq && apt-cache policy mdbtools'` that the version is 1.0.x. `dino-deps` is bookworm.

---

## Task 1: Type registry, schemas, migration 146, Dockerfile, fixtures

**Files**
- Modify `src/dino.config.ts`:
  - Add `"database-assessment"` to `SCORABLE_ACTIVITY_TYPES`, `QUESTION_MARKED_ACTIVITY_TYPES` and `AI_MARKED_ACTIVITY_TYPES`. Update the comments: the PowerPoint exception note covers both practical types.
  - Add `PRACTICAL_ASSESSMENT_TYPES = Object.freeze(["powerpoint-assessment","database-assessment"])`, `isPracticalAssessmentType(type)` and `isDatabaseAssessmentType(type)`, with doc comments.
- Modify `src/types/index.ts`:
  - Add `PRACTICAL_UPLOAD_SLOT_KINDS = ["pptx","pdf","docx","accdb"]`, `PracticalUploadSlotKind` and `DATABASE_UPLOAD_SLOT_KINDS = ["accdb","pdf","docx"]`.
  - Add a slot schema factory `uploadSlotSchema(kinds)`. `PowerPointUploadSlotSchema` stays equal to `uploadSlotSchema(POWERPOINT_UPLOAD_SLOT_KINDS)`, with the same messages.
  - Add `DatabaseUploadSlotSchema`.
  - Add `PracticalUploadSlot = {key,label,kind: PracticalUploadSlotKind, required, hint?}`.
  - Add `DatabaseAssessmentActivityBodySchema`: `instructions?`, `uploadSlots` (1–8, unique keys, exactly one `accdb` slot, which is required; messages read "a database assessment needs exactly one accdb slot (the database), not N" and "the accdb slot (the database) must be required"), `evidenceTemplateFile?`, `startingDatabaseFile?` (an activity file name ending `.accdb`, no slashes), `questionPaperPath?`, `markSchemePath?`, `showMarkSchemeToPupils?`, `.passthrough()`.
  - Leave `PowerPointAssessmentActivityBodySchema` behaviourally untouched. Only the uniqueness `superRefine` may be shared through a helper, and its messages must stay identical.
- Create `src/lib/practical-assessment/types.ts`. It is pure, with no `server-only`:
  - `PracticalAssessmentType`.
  - `PracticalTypeConfig { type, label, labelLower, bodySchema, slotKinds, mainKind, sources: readonly QuestionEvidenceSource[] /* type-only import */, defaultBody(), hasSuppliedImages, hasStartingDatabase }`.
  - `PRACTICAL_TYPE_CONFIGS`, `practicalTypeConfig(type)` (throws on a non-practical type) and `practicalBodySchema(type)`.
  - PowerPoint sources: `["presentation","slide_images","file","evidence_section","reference_file"]`, the same order as today's `QUESTION_EVIDENCE_SOURCES`.
  - Database sources: `["database","evidence_section","file","reference_file"]`.
  - The database default body is `{ uploadSlots: [{key:"database",label:"Database",kind:"accdb",required:true},{key:"evidence",label:"Evidence document",kind:"docx",required:true}] }`.
  - The PowerPoint default stays `defaultPowerPointAssessmentBody()`, re-exported.
  - Until Task 4, `QuestionEvidenceSource` does not yet include `database`. Type the database list as `readonly string[]` cast in Task 1, or bring forward only the union member. The subagent decides, and the result must compile.
- Create `src/migrations/146-database-assessment.sql` (`BEGIN … COMMIT`, with a header comment in the style of migration 143):
  - `CREATE OR REPLACE FUNCTION is_question_marked_activity_type`, with `'database-assessment'` added.
  - `CREATE OR REPLACE FUNCTION is_scorable_activity_type`, with the full list from 143 plus `'database-assessment'`.
  - `ALTER TABLE practical_submission_evidence DROP CONSTRAINT IF EXISTS practical_submission_evidence_kind_check;` then `ADD CONSTRAINT practical_submission_evidence_kind_check CHECK (kind IN ('presentation','pdf','evidence_doc','database'))`. First verify the actual constraint name with `\d practical_submission_evidence` (read-only).
  - The route row `('database-assessment', NULL)`: copy the provider, model and effort of the `('powerpoint-assessment', NULL)` route, else of `assessment-paper`, else `anthropic` / `claude-sonnet-5`, with `updated_by 'migration-146'`, `WHERE NOT EXISTS`.
  - No change to `mcp_upload_links`: the `practical_file` kind and `slot_key` are already generic.
- Modify `scripts/migrate.sh`: append `"146-database-assessment.sql|select is_question_marked_activity_type('database-assessment')"`.
- Modify `Dockerfile-dino`, runner stage: add `mdbtools` to the existing `apt-get install` line, with a comment ("mdbtools: reads pupils' Access .accdb files for database assessments, src/lib/accdb").
- Create fixtures in `tests/fixtures/database/`. These are teacher files with no pupil data. Copy them with `cp`, then `chmod 644`:
  - `palm-grove-model-answer.accdb` ← `~/prod-mirror/files/lessons/db8e7cd4-3088-413f-9ada-d5702f0cacc2/PALM GROVE VETS MODEL ANSWER.accdb`
  - `palm-grove-start.accdb` ← `…/activities/ec3b183f-cb12-4d02-ab5c-cd4bca4f9752/PALM GROVE VETS.accdb`
  - `palm-grove-evidence-model-answer.docx` ← `…/EVIDENCE MODEL ANSWER.docx`
  - `palm-grove-evidence-template.docx` ← `…/activities/ec3b183f-…/EVIDENCE.docx`
  - `tests/fixtures/database/README.md`: the source of each file, and a note that they hold no pupil data.
- Apply the migration to dev: `bash scripts/migrate.sh --yes`. This takes a backup, so make sure there is disk space.

**Checks**
- Create `tests/database-assessment/config.check.ts`. It checks:
  - The predicates for each type.
  - The registry: slot kinds, sources, default bodies parse, PowerPoint config sources equal to `QUESTION_EVIDENCE_SOURCES`.
  - `DatabaseAssessmentActivityBodySchema` accepts the default body and refuses no accdb slot, two accdb slots, an accdb slot that is not required, a `pptx` kind and duplicate keys, with the exact messages.
  - `PowerPointAssessmentActivityBodySchema` refuses `accdb`.
  - SQL parity: `select is_question_marked_activity_type('database-assessment')` and `is_scorable_activity_type(...)` are true, and `('database-assessment', NULL)` is in `ai_model_routes`.
  - The evidence `kind` constraint accepts `'database'`. Test this with an insert inside a transaction that is rolled back.
- Run: `run-check.sh tests/database-assessment/config.check.ts tests/powerpoint-assessment/questions.check.ts`. Typecheck.

**Done when** both checks pass, the typecheck shows only the known errors, `scripts/migrate.sh --check` lists nothing pending, and the Dockerfile builds nothing yet (no rebuild).

---

## Task 2: The mdbtools runner and the `.accdb` reader (`src/lib/accdb/`)

**Files to create**
- `src/lib/accdb/errors.ts`:
  - `UnreadableDatabaseError` (the file is bad; the message is written for the pupil).
  - `DATABASE_MESSAGES`:
    - `mdb`: "This is an older Access .mdb file. Open it in Access and save it as an Access Database (.accdb), then upload that."
    - `lockFile`: "This is Access's lock file (.laccdb), not your database. Close Access and upload the .accdb file."
    - `notAccess`: "This is not an Access database (.accdb) file."
    - `unopenable`: "DINO could not open this database. If it has a password, remove it (File > Info > Decrypt Database); otherwise it may be damaged: use Compact and Repair in Access, then upload it again."
    - `notThisType`: "Upload your Access database as an .accdb file."
- `src/lib/accdb/mdbtools.ts`:
  - `withTempDatabase(bytes, use)`: `mkdtemp(tmpdir()/dino-accdb-)`, writes `db.accdb`, and always runs `rm -rf` in `finally`.
  - `runMdb(tool, args, {timeoutMs = 30_000, maxBytes = 16 MB})`: uses `execFile` with `env: { PATH: process.env.PATH, LANG: "C.UTF-8", HOME: tmpdir }` and no shell.
  - Failure classification is the same as `toolFailure` in `poppler.ts`. A non-zero exit, not killed and with no signal, throws `UnreadableDatabaseError(DATABASE_MESSAGES.unopenable)`. Anything else (ENOENT, a timeout, `maxBuffer`) throws a plain `Error` whose message says the database reader failed or is not installed, so the job retries.
  - An overall time budget per read (`READ_BUDGET_MS = 120_000`).
- `src/lib/accdb/types.ts`. The `DatabaseSnapshot` type:
  - `version` (for example `"ACE14"`)
  - `tables: [{ name, fields: [{ name, type, size: number|null, required: boolean|null, notNull, validationRule, validationText, defaultValue, inputMask, format, caption, lookup: { rowSourceType, rowSource, limitToList, boundColumn, columnCount, displayControl } | null }], sort: { orderBy: string|null, orderByOn: boolean|null }, filter: string|null, rowCount, rows: Array<Record<string, string|null>>, rowsTruncated: boolean }]`
  - `relationships: [{ name, table, fields: string[], referencedTable, referencedFields: string[], enforced: boolean|null, cascadeUpdate, cascadeDelete, grbit }]`
  - `queries: [{ name, type: "select"|"other", sql: string|null, tables: [{ name, alias|null }], joins: [{ left, right, on, kind: "inner"|"left"|"right"|"unknown" }], outputs: [{ expression, alias|null }], hiddenFields: string[], where: string|null, groupBy: string[], having: string|null, orderBy: [{ expression, descending }] }]` (user queries only, not names starting with `~`)
  - `forms` / `reports`: `[{ name, baseTables: string[] | null }]`
  - `warnings: string[]`
- `src/lib/accdb/read.ts`: `readAccessDatabase(bytes, options?): Promise<DatabaseSnapshot>`.
  1. **Sniff the header first, before any process runs.** Bytes 4..19 `"Standard ACE DB"` mean ACCDB. `"Standard Jet DB"` refuses with `mdb`. Anything else refuses with `notAccess`. The caller handles a name ending `.laccdb` before this, with `lockFile`. Confirm the offsets against both fixtures.
  2. Inside one `withTempDatabase`:
     - `mdb-ver`.
     - `mdb-tables -1` gives the user tables.
     - `mdb-schema --no-relations` (or the default) is parsed per `CREATE TABLE [X]` block: field `[NAME]`, type text (`Long Integer`, `Text (30)`, `DateTime`, `Currency`, `Boolean`, …) giving the size, and `NOT NULL`.
     - `mdb-prop <file> <table>` is parsed as blocks (`name: X` then tab-indented `Key: value`). `name: (none)` holds the table properties (`OrderBy`, `OrderByOn`, `Filter`); the other blocks are field properties.
     - `mdb-json -D "%d-%m-%Y" -T "%d-%m-%Y %H:%M:%S" <file> <table>` gives one JSON object per line. Strip a trailing ` 00:00:00`. Boolean fields `1`/`0` become `"Yes"`/`"No"`. Currency is shown as a number without trailing zeros (`450.0000` becomes `450`). Keep every value as a string (null stays null). Keep at most `MAX_ROWS_PER_TABLE = 1000` rows and set `rowsTruncated`.
     - `mdb-json … MSysObjects` maps Id to Name and Type. Type 5 is a query, -32768 a form, -32764 a report. Drop the `LvProp`/`Lv`/`Owner` binary fields straight after parsing.
     - `mdb-json … MSysQueries` is grouped by `ObjectId`. Attribute 1 Flag 1 is a select query. Attribute 5 is `Name1` (the table) with an optional `Name2` alias. Attribute 6 is the output `Expression` with an optional `Name1` alias. Attribute 7 is a join: `Name1`, `Name2`, `Expression`, `Flag` 1 inner, 2 left, 3 right. Attribute 8 is the WHERE. Attribute 9 is GROUP BY. Attribute 10 is HAVING. Attribute 11 is ORDER BY, with `Name1 "D"` meaning descending.
     - `hiddenFields` are the fields named in WHERE or ORDER BY that no output shows. Compare normalised `Table.[Field]` forms.
     - `mdb-queries <file> <name>` gives the SQL text for each user query. Pass the name as an argument; never use a shell.
     - `mdb-json … MSysRelationships` is grouped by `szRelationship`. `enforced = (grbit & 2) === 0` (DAO `dbRelationDontEnforce`), `cascadeUpdate = grbit & 256`, `cascadeDelete = grbit & 4096`. Add a code comment saying the source is DAO `RelationAttributeEnum`.
     - Forms and reports get `baseTables` from the hidden query `~sq_f<FORM>` / `~sq_r<REPORT>` (its attribute 5 tables), else `null`.
  3. Any JSON line that fails to parse becomes a warning, not a crash. A required system table that cannot be read becomes a warning, and those parts become empty. An `UnreadableDatabaseError` from `mdb-tables` or `mdb-schema` propagates.
- `src/lib/accdb/check.ts`: `checkAccessDatabase(bytes, originalName)` is the light open used at upload. It covers the extension (`.laccdb` gives `lockFile`; not `.accdb` gives `notThisType`), the header sniff, `mdb-ver` and `mdb-tables -1` with a 15 s timeout. It throws `UnreadableDatabaseError`.

**Checks**
- Create `tests/database-assessment/reader.check.ts`. It needs no DB connection, but must run in `dino-deps` with mdbtools. It checks:
  - **Model answer:** version `ACE14`; tables `APPOINTMENTS`, `OWNERS`, `PETS` with the field types and sizes from the spike (`OWNERS.MOBILE` is `Text` size 10, `PETS.MICROCHIPPED` is `Boolean`).
  - Row counts OWNERS 26, APPOINTMENTS 61.
  - The last APPOINTMENTS row has `APPOINTMENT DATE` = `22-03-2027`, `PAID` = `No` and `COST` = `450`.
  - The OWNERS sort is `[OWNERS].[SURNAME]` and on.
  - The lookups: REASON row source `"Check-up";"Vaccination";"Dental";"Surgery";"Grooming"` with limit-to-list yes; VET; SPECIES.
  - The relationships OWNERSPETS and PETSAPPOINTMENTS, both enforced.
  - Query `MICROCHIP REMINDER`: table PETS; outputs PET ID, PET NAME, OWNER ID in order; hidden `DATE OF BIRTH`; WHERE contains `<#1/1/2020#`, `="Dog"` and `=No`; ORDER BY `DATE OF BIRTH` ascending.
  - Query `UNPAID TREATMENTS`: 3 tables; 2 inner joins; 7 outputs in order; WHERE contains `Between #2/1/2027# And #3/31/2027#`, `"Dental" Or` and `>150`; ORDER BY COST descending.
  - Forms `APPOINTMENT FORM` (base APPOINTMENTS) and `PETS LIST FORM` (base PETS); reports `UNPAID TREATMENTS REPORT` and `MICROCHIP REMINDER REPORT`. Assert whatever base the reader finds for the reports, or null.
  - No `~sq_` names among the queries.
  - **Start file:** no user queries, forms or reports; OWNERS 25 and APPOINTMENTS 60 rows.
  - **Refusals:** random bytes give `notAccess`. The first 4096 bytes of the model answer give `unopenable` (from `mdb-tables`). A copy with bytes 4..19 rewritten to `Standard Jet DB` gives `mdb`. `checkAccessDatabase(bytes, "x.laccdb")` gives `lockFile`. A `.accdb` name with docx bytes gives `notAccess`.
  - **Temp directories:** no `dino-accdb-*` directory is left in `tmpdir()` afterwards.
  - The tool missing (simulated by a `PATH` of an empty directory) throws a plain `Error`, not `UnreadableDatabaseError`.
- Run: `run-check.sh tests/database-assessment/reader.check.ts`. Typecheck.

**Done when** every assertion passes. Anything that differs from the spike (for example a report's base table) is reported back and becomes an asserted fact, not a guess.

---

## Task 3: Describe, section selectors and the diff (pure)

**Files to create**
- `src/lib/accdb/section-selectors.ts` (client-safe, like `src/lib/pptx/section-selectors.ts`):
  - `DATABASE_SECTION_KEYS = ["tables","fields","relationships","lookups","table-sort","records","changes","queries","query","objects","warnings"]`.
  - `DEFAULT_DATABASE_SECTIONS` = every key except `records` and `query`.
  - `parseDatabaseSection(text)`: `records:<TABLE>` and `query:<NAME>` take a name of 1–64 characters with no control characters. Keys are lower-cased and names trimmed.
  - `formatDatabaseSection` and `databaseNameKey(name)` (NFKC, upper case, whitespace collapsed) for matching.
- `src/lib/accdb/diff.ts`: `diffDatabases(start, pupil): DatabaseChanges`:
  - Tables and fields added or removed.
  - Field type, size or required changed.
  - Lookup changed.
  - Table sort changed.
  - Per table, records added, removed and changed, **paired by the table's first field**. Document the rule. A row with the same first field and other values that differ is "changed", listing each field from → to. A row in both and identical is unchanged.
  - Queries added, removed or changed (SQL differs).
  - Forms and reports added or removed.
  - Relationships added or removed, or enforcement changed.
- `src/lib/accdb/describe.ts`:
  - `describeDatabaseSections(report: DatabaseReport): Array<{ selector: string; title: string; text: string }>`, where `DatabaseReport = { snapshot, changes: DatabaseChanges | null, startingDatabase: { fileName } | null }`.
  - It produces `records:<T>` for every table and `query:<Q>` for every query.
  - `filterDatabaseSections(sections, selectors)` matches names with `databaseNameKey`. A named query or table that is not found gets a text block of its own: "There is no saved query called X in this database. Its saved queries are: A, B." `findDatabaseSection` reports this as absent.
  - `describeDatabase(report)` is everything, for the teacher and MCP.
  - **Text rules:**
    - Dates in records are DD-MM-YYYY.
    - Criteria `#m/d/yyyy#` are followed by `(d Month yyyy)`.
    - A query block lists, in order: tables; joins; "Fields shown, in order: …"; "Used for criteria or sort but not shown: …"; "Criteria (as Access stores them; dates are month/day/year): …"; "Sort: COST descending"; "SQL: …".
    - `changes` reads like "APPOINTMENTS: 1 record added: APPOINTMENT ID 61, PET ID 12, APPOINTMENT DATE 22-03-2027, REASON Dental, VET Dr Patel, COST 450, PAID No.", "OWNERS: 1 record added: …", "OWNERS: sort set to [OWNERS].[SURNAME] (on)", "Queries added: MICROCHIP REMINDER, UNPAID TREATMENTS", "Forms added: …", "Reports added: …". With no starting database it says: "No starting database is set for this activity, so changes cannot be listed."
    - `objects` says: "Forms: APPOINTMENT FORM (based on APPOINTMENTS) … Reports: … The database file does not record form or report design (fonts, sizes, borders, positions, colours); judge those from screenshots."
    - Records over `RECORDS_SHOWN_MAX = 200` say "200 of N shown".

**Checks**
- Create `tests/database-assessment/describe.check.ts`, reading the fixtures through `readAccessDatabase`. It checks:
  - The model answer diffed against the start gives exactly the changes listed above, and nothing else is listed as changed. Assert the OWNERS record added (`O026, Huda, Al-Dosari, 0559123456, Al Rakah`, or whatever the model answer holds; read it, then assert).
  - The query text blocks contain the expected lines, including `(1 January 2020)`.
  - Date format in records.
  - `filterDatabaseSections` with `query:microchip reminder` (case-insensitive) finds it.
  - `query:NOPE` gives an absent block naming the queries that do exist.
  - `records:OWNERS` lists 26 rows.
  - **Doctored snapshots** (deep-cloned and edited in the test):
    - the query's ORDER BY flipped to descending, so the text says descending;
    - the OWNERS sort removed, so `table-sort` says none and `changes` lists no sort;
    - a changed record (same first field, a different COST), giving a "changed" line;
    - no starting database, giving the note.
- Run: `run-check.sh tests/database-assessment/describe.check.ts`. Typecheck.

**Done when** everything passes and the text is plain English with no markup.

---

## Task 4: Generalise the evidence spec, store validation and slot changes

**Files to modify**
- `src/lib/powerpoint-assessment/evidence-spec.ts`:
  - Add `DatabaseSourceSchema = {source:"database", slot, sections?: string[] (min 1), required?: boolean}` (strict) to the union. Add `database` to `QuestionEvidenceSource`.
  - Make `QUESTION_EVIDENCE_SOURCES` all six, used only for parsing. Every allowed-list message uses `practicalTypeConfig(type).sources`, so the PowerPoint messages stay exactly as they are.
  - `SOURCE_SLOT_KIND.database = "accdb"`. `KIND_NAMES.accdb = "the database (.accdb)"`. `SOURCE_FIELDS.database`.
  - `validateQuestionEvidence(questions, body, type = "powerpoint-assessment")`:
    - parse the body with `practicalBodySchema(type)`;
    - refuse a source that is not in the type's list: "…has the source "presentation", which a database assessment does not take; use one of …";
    - canonicalise database selectors with `parseDatabaseSection`, refusing duplicates and unknown keys ("use tables, fields, …, records:TABLE, query:NAME").
  - `practicalBodyProblem(body, type)`. `powerPointBodyProblem(body)` stays as `practicalBodyProblem(body,"powerpoint-assessment")`, because callers and tests use it. Generalise the wording ("Upload slot …").
  - `defaultPracticalBody(type)`. `defaultPowerPointAssessmentBody` stays.
- `src/lib/powerpoint-assessment/slot-changes.ts`: `applyUploadSlotChange(client, activityId, before, after, { rename, type })` passes the type on. Update both callers (`lesson-activities.ts` 633 and `mcp/activities.ts` 783).
- `src/lib/assessment-paper/store.ts`: `checkQuestionEvidence` is generic over practical types and passes `activity.type`. The paper refusal is unchanged. Rename `isPowerPointActivity` to `isPracticalActivity`. In `heldQuestionsMessage`, the SQL becomes `x.type = any($2::text[])` with `PRACTICAL_ASSESSMENT_TYPES`. `selectHeldQuestionsToSend` becomes practical. Update the doc comments to "practical assessment (PowerPoint or database)".
- `src/components/lessons/assessment-paper-editor.tsx` line ~264: pass the activity type, which the setup already returns as `type`, to `validateQuestionEvidence`. This is the only UI touch in this task; it keeps the typecheck green.

**Checks**
- Create `tests/database-assessment/questions.check.ts`:
  - **Pure validation:**
    - a database source on the `accdb` slot passes and is canonicalised (`["Query:MICROCHIP REMINDER","records:owners"]` becomes `query:MICROCHIP REMINDER`, `records:owners`; the name case is kept);
    - a database source on the docx slot is refused;
    - `presentation` and `slide_images` are refused for the database type with the type's list;
    - `database` is refused for the PowerPoint type, with today's message;
    - unknown selector, duplicate selector and empty `records:` are refused;
    - a question with only `reference_file` is refused.
  - **With the DB:** create a database-assessment activity through `createActivity` (`@/lib/mcp/activities`), then call `setAssessmentQuestions` with database and evidence_section sources. They save and read back.
  - Changing the slots so that an evidence slot disappears is refused through `applyUploadSlotChange`, and a rename is carried into the evidence.
- Run: `run-check.sh tests/database-assessment/questions.check.ts tests/powerpoint-assessment/questions.check.ts tests/powerpoint-assessment/blank-reasons.check.ts tests/powerpoint-assessment/editor.check.ts`. Typecheck.

**Done when** all four pass and the PowerPoint ones are unchanged.

---

## Task 5: Files, slots, hand-in, reopen, enqueue and access, for any practical type

**Files to modify**
- `src/lib/powerpoint-assessment/files.ts`:
  - `readPracticalActivity(activityId, { only? })` replaces `readPowerPointActivity`. It checks `isPracticalAssessmentType`, parses with `practicalBodySchema(type)` and returns `type`. Refusal texts use the label ("This database assessment has no upload slots set up; ask your teacher.").
  - `EXTENSIONS.accdb = "accdb"`. `MIME_TYPES.accdb = "application/vnd.ms-access"`.
  - In `checkSlotFile(kind, bytes, name)`, the `accdb` branch calls `checkAccessDatabase` and maps `UnreadableDatabaseError` to `PracticalFileRefusal`.
  - The supplied-image functions call `readPracticalActivity(id, { only: "powerpoint-assessment" })`.
  - `powerPointNotQueuedReason` covers any practical type. Keep the function name; it is imported by `short-text.ts`.
  - `listUnmarkedPowerPointSubmissions` changes `a.type = 'powerpoint-assessment'` to `a.type = any($2::text[])`.
  - In `pupilMayOpenPracticalFile`, the regex becomes `^original\.(pptx|pdf|docx|accdb)$`.
  - Types widen from `PowerPointUploadSlot` / `Kind` to `PracticalUploadSlot` / `Kind`. Update the header comment.
- `src/lib/ai/marking-queue.ts`:
  - `enqueuePowerPointSubmission` becomes `enqueuePracticalSubmission`, with the body from `practicalBodySchema(type)` (select `a.type` too). The "not set up" text uses the label. PowerPoint's text stays word for word.
  - Line 118 branch → `isPracticalAssessmentType`.
  - `readFailurePrefix` → practical.
  - `processQuestionMarkedItem`: `practical = isPracticalAssessmentType(type)` loads `@/lib/powerpoint-assessment/jobs`. The log label is `${label} submission … fully marked`, so PowerPoint still logs "PowerPoint assessment". The no-question message uses the label.
- `src/lib/powerpoint-assessment/jobs.ts`: the log texts use the label (read from `activityOf`). PowerPoint strings stay the same.
- `src/lib/server-actions/resubmit.ts` 95, `src/lib/server-actions/assessment-paper-activity.ts` 157 and `src/lib/assessment-paper/setup.ts` (enum, `isPractical`, `type: normalized row.type`, `readPowerPointSetup` with the per-type schema) all become practical.
- `src/lib/assessment-paper/files.ts` 618: the paper-file access branch becomes practical.
- `src/lib/server-actions/powerpoint-assessment.ts`: the hand-in, reopen, slots, view and remove-file actions accept any practical type, since they go through `files.ts`. The supplied-image actions stay PowerPoint-only.
- `src/app/api/pupil-submission/practical/route.ts`: the comment says "practical assessment". The code is unchanged.

**Checks**
- Create `tests/database-assessment/files.check.ts`, modelled on `tests/powerpoint-assessment/files.check.ts`. It uses the fixtures and its own unit, lesson, activity (database type, default slots), class and pupils. It checks:
  - `storePracticalFile` stores the model `.accdb` at `{activityId}/practical/{fileId}/original.accdb` and the EVIDENCE docx.
  - It refuses, with the exact messages: a `.mdb`-header copy, a `.laccdb` name, garbage, the truncated file, docx bytes in the accdb slot, and an accdb in the docx slot.
  - Hand-in is refused while a required slot is empty ("Upload Database before handing in.").
  - Hand-in sets `submitted` and one `ai_read` job (the queue secret is blank, so nothing runs it).
  - A pupil change after hand-in is refused (`HANDED_IN_MESSAGE`).
  - A teacher replacement after hand-in clears AI rows, keeps teacher rows and re-queues with the 120 s delay.
  - `reopenPowerPointAssessment` sets `inprogress`, drops the jobs and keeps the files.
  - `requestResubmissionAction`'s reopen path (`reopenPowerPointAssessmentForTeacher`) works.
  - `pupilMayOpenPracticalFile`: the pupil opens their own `original.accdb` but not `evidence/...`; another pupil is refused; it is refused while the lesson is locked.
  - The latest attempt is used.
  - `listUnmarkedPowerPointSubmissions` lists the database submission.
- Run: `run-check.sh tests/database-assessment/files.check.ts tests/powerpoint-assessment/files.check.ts tests/powerpoint-assessment/read-guards.check.ts tests/powerpoint-assessment/results.check.ts`. Typecheck.

**Done when** all pass.

---

## Task 6: The read, the database evidence kind and the starting database

**Files to modify**
- `src/lib/powerpoint-assessment/reading.ts`:
  - `EvidenceKind` adds `"database"`. `EVIDENCE_KIND.accdb = "database"`.
  - `SlotEvidence` adds `{ kind: "database"; status: "ok"; report: DatabaseReport; description: string }`.
  - `PowerPointReaders` adds an **optional** `readDatabase?: typeof readAccessDatabase`. It must be optional so the PowerPoint checks' reader objects still compile; the default is `readAccessDatabase`.
  - `readActivity(submissionId)` selects `a.type`, parses with `practicalBodySchema(type)` and returns `type`, `startingDatabaseFile` and a label-worded `bodyError`. PowerPoint's message is unchanged.
  - **Starting database:** when an `accdb` slot has a file and `startingDatabaseFile` is set, read that activity file with `readActivityFile`.
    - Its sha256 goes into the cache key.
    - Read it once per job with `readers.readDatabase`. If it is unreadable or missing, add a warning ("The starting database "X" could not be read / is not among the activity's files, so changes are not listed.") and set changes to `null`. This never holds the submission.
  - The cache key for `accdb` is `${file.sha256}:${startHash|"none"}:${DATABASE_READER_VERSION}`, with `DATABASE_READER_VERSION = "database-reader-1"` exported. The pptx, pdf and docx keys are unchanged: `READER_VERSION` stays `"powerpoint-reader-1"`.
  - `readFile` `accdb` branch: `readers.readDatabase(bytes)`. An `UnreadableDatabaseError` is a refusal (`status 'error'`), and the whole submission is held as for pptx. Then the diff, `report = { snapshot, changes, startingDatabase }`, and `description = describeDatabase(report)`.
  - `evidenceFromRow('database', row)`. `slotSummary` adds `{ tables, queries, forms, reports }` **counts only**. `evidenceWarnings` adds `snapshot.warnings`, the start warnings, and "N of M records shown" truncation notes.
  - In `findSource`, the `database` source:
    - `!file` gives `didNotHandIn`.
    - The selectors are `databaseSections(source)`, with the default applied, then `filterDatabaseSections`.
    - `present` = at least one selected section exists. A `query:X` or `records:X` that is absent counts as absent.
    - `missing` for the pupil: "There is no saved query called X in your database." / "There is no table called X in your database."
    - The digest is `Database (${slot.label}): ${what}.`. The **slot label**, never `original_name`, so database digests do not carry pupil file names; this is a small improvement over pptx, which is not changed.
    - `textOnly` false.
  - `PowerPointReadCallRecord.request.reader` becomes `"powerpoint" | "database"`: `"database"` when the activity is a database assessment.
- `src/lib/powerpoint-assessment/evidence-spec.ts`: export `databaseSections(source)` (with the defaults) beside `presentationSections`.

**Checks**
- Create `tests/database-assessment/evidence-doc.check.ts` (no DB). Run `readEvidenceDocument` on `palm-grove-evidence-model-answer.docx`, with headings `1`…`9` and `B1`…`B8` and the template paragraphs from `palm-grove-evidence-template.docx`. Assert:
  - pictures per section 3,1,1,1,2,2,2,2,1;
  - typed text present under B1–B8;
  - B1's text contains none of the template wording ("PET ID is the primary key of the PETS table.", "(a)  State what is meant…");
  - no section text contains the "Name:" or "Candidate number" lines (they are unplaced);
  - `missingHeadings` is empty.

  The task states that `src/lib/docx/evidence.ts` needs no change. If any assertion fails because of the reader, stop and report back; do not patch the docx reader inside this task.
- Create `tests/database-assessment/reading.check.ts`, modelled on `tests/powerpoint-assessment/reading.check.ts`. Set up:
  - the activity with default slots, `evidenceTemplateFile` and `startingDatabaseFile`, both uploaded as activity files into `lessons/{lesson}/activities/{activity}/`;
  - questions with database sources (`["changes"]`, `["queries"]`, `["query:MICROCHIP REMINDER"]`, `["query:NOPE"]` required, `["table-sort","records:OWNERS"]`), screenshot sources (headings 1 and 6, required) and text sources (B1, B3);
  - the model answer files for one pupil, handed in.

  Run `runPowerPointReadJob` directly with counting readers and assert:
  - one evidence row of kind `database` whose report's `changes` lists 1 APPOINTMENTS and 1 OWNERS record added;
  - the screenshots are stored under `evidence/`;
  - the answers are answered; `query:NOPE` is blank with "There is no saved query called NOPE in your database."; there is no mark job for the blank one and a mark job for each answered, non-teacher question that has a mark scheme;
  - B1's transcription is its typed text;
  - a second read reuses the cache (`readDatabase` called 0 times);
  - changing `startingDatabaseFile` to a missing name re-reads with a warning, changes are null and nothing is held;
  - a damaged `.accdb` (the row inserted directly, bypassing the upload check, as `read-guards` does) holds the whole submission, with `mark_error` naming the slot;
  - **the job rows** (`external_jobs.model_request` / `model_response`) and `ai_marking_logs` contain neither the uploaded file names (give the uploads unique names such as `Pupil-Smith-db.accdb`) nor any base64.
- Run: `run-check.sh tests/database-assessment/evidence-doc.check.ts tests/database-assessment/reading.check.ts tests/powerpoint-assessment/reading.check.ts tests/powerpoint-assessment/read-guards.check.ts tests/powerpoint-assessment/evidence-doc.check.ts`. Typecheck.

**Done when** all pass.

---

## Task 7: Marking (per-type system prompt and database evidence blocks)

**Files**
- Create `src/lib/database-assessment/marking-text.ts`, which exports `DATABASE_MARK_SYSTEM`. It is modelled on `POWERPOINT_MARK_SYSTEM` paragraph by paragraph: anonymity; the mark scheme as the only standard; each point decided on its own; criteria as filing labels. The evidence paragraph says:
  - The DATABASE REPORT is read directly from the pupil's `.accdb`: tables, fields, lookups, saved sort, records, relationships, saved query designs (tables, joins, fields shown in order, fields used but not shown, criteria, sort) and which forms and reports exist. These are exact facts: trust them over a screenshot.
  - Access stores criteria dates month/day/year. The report adds each date in words; record dates are day-month-year.
  - The report cannot show form or report design (fonts, sizes, borders, colours, positions, sections, alignment, controls). Judge those only from screenshots, and never infer them.
  - A SCREENSHOT earns a mark only when what the mark scheme asks for can be read in it.
  - CHANGES compare the pupil's database with the database they were given.
  - FILE and REFERENCE FILE are as for PowerPoint.

  Every comment names its evidence: the EVIDENCE heading, the table, the query, the form or report, or the file. The evidence_note paragraph is the same as PowerPoint's.
- Modify `src/lib/powerpoint-assessment/marking.ts`:
  - Add `MARK_TEXT: Record<PracticalAssessmentType, { system: string; evidenceNames: string; workName: string }>`. PowerPoint's entry is `POWERPOINT_MARK_SYSTEM`, `"slide number, file or EVIDENCE heading"`, `"practical"`, so PowerPoint's prompt is byte-identical. The database entry is `DATABASE_MARK_SYSTEM`, `"EVIDENCE heading, table, query, form or report, or file"`.
  - `buildPowerPointMarkPrompt` takes `evidenceNames` (default PowerPoint) and uses it in the two lines that name evidence.
  - `markPowerPointQuestion` selects `type` with `body_data`, parses with `practicalBodySchema(type)` (label-worded error) and sends `MARK_TEXT[type].system`. The call record stores that `system`.
  - In `assembleEvidence`, the `database` source:
    - The report comes from `evidenceOf(file)`.
    - The block is ``DATABASE REPORT, ${slotLabel} (${markerFileName(file)}), ${what}:`` followed by the selected sections' text, joined by blank lines. `what` is the canonical selectors, or "every part but records".
    - The block key is `database:${slot}:${selectors}`.
    - Absent named sections say so in the text, for example "(there is no saved query called NOPE in this database; its saved queries are …)".
  - The caps are unchanged.
- `src/lib/powerpoint-assessment/jobs.ts`: no further change beyond Task 5.

**Checks**
- Create `tests/database-assessment/marking.check.ts`, modelled on `tests/powerpoint-assessment/marking.check.ts`. Read the model answer as in Task 6, then call `runPowerPointMarkJob` with a **fake `ModelJsonCall`** that captures the request and returns a valid reply. Assert:
  - `systemText === DATABASE_MARK_SYSTEM`;
  - the prompt contains `DATABASE REPORT, Database (database.accdb), query:MICROCHIP REMINDER:` and the query lines (`Fields shown, in order: PETS.[PET ID], …`, `(1 January 2020)`, `Sort: … ascending`);
  - a screenshot question attaches its screenshots with `EVIDENCE 6, SCREENSHOT n` labels;
  - a B question has the typed text;
  - no pupil file name and no unplaced "Name:" text appear in the prompt or the job row;
  - `marker_evidence` is stored and `ai_awarded` is set;
  - teacher rows are never overwritten;
  - a question over the caps fails permanently, naming the question.

  Also assert, by building a PowerPoint prompt with `buildPowerPointMarkPrompt` and no `evidenceNames`, that it still contains "slide number, file or EVIDENCE heading".
- Run: `run-check.sh tests/database-assessment/marking.check.ts tests/powerpoint-assessment/marking.check.ts tests/powerpoint-assessment/blank-reasons.check.ts`. Typecheck.

**Done when** all pass. The PowerPoint marking check must pass unmodified.

---

## Task 8: Results, pupil view, feedback, PDFs, flags and the editor's server side

**Files to modify**
- `src/lib/assessment-paper/results.ts`:
  - `isPractical`; `powerPointFiles(type, …)` with the per-type schema; `kind` widened.
  - Add a teacher-only per-question `evidenceTexts: Array<{ title: string; text: string }>`. For each `database` source it holds the same filtered section text the marker gets, rebuilt from the stored report with `describeDatabaseSections` / `filterDatabaseSections`. It is `[]` for other types.
  - Update the type `AssessmentPaperResult`. `buildPupilAssessmentFeedback` must not carry it: check `pupil-feedback.ts`, which copies only named fields.
- `src/lib/assessment-paper/pupil-feedback.ts` 266, `feedback-pdf.ts` 101 and `class-feedback-pdf.ts` 105: practical.
- `src/lib/powerpoint-assessment/pupil-view.ts`: practical, with the per-type schema. `suppliedImages` is listed only when the type `hasSuppliedImages`. The downloads include the starting database, because it is an ordinary activity file.
- `src/lib/powerpoint-assessment/editor.ts`:
  - `readActivity` becomes practical. `renameSuppliedImage` asserts PowerPoint.
  - Add `checkActivityStartingDatabase(activityId, fileName?)`. It reads the named `.accdb` activity file with `readAccessDatabase` and returns `{ fileName, tables: [{name, rows}], queries, forms, reports }` for the editor. `UnreadableDatabaseError` becomes `Error("<name>: <message>")`.
- `src/lib/server-actions/powerpoint-assessment.ts`: add `checkStartingDatabaseAction(activityId, fileName)` (teacher, `withTelemetry`, `{data, error}`). Export it through `src/lib/server-updates.ts` as the other actions are.

**Checks**
- Create `tests/database-assessment/results.check.ts`, modelled on the PowerPoint `results.check.ts` and using the read from Task 6 plus a fake mark. It checks:
  - `result.powerpoint` lists both slots with `kind accdb` / `docx` and their reader status;
  - a refused file shows its error;
  - the question `evidenceTexts` contain the query design;
  - `buildPupilAssessmentFeedback` output has no `evidenceTexts`, `ai_awarded`, `marker_evidence` or mark scheme;
  - the feedback PDF builds (`readAssessmentFeedbackPdfData` and the class PDF data), with *Not sat* for a pupil who has not handed in;
  - a pupil flag on a database question works (`setAssessmentQuestionFlagAction` path, or the store functions as `tests/assessment-paper/question-flags.check.ts` does);
  - `checkActivityStartingDatabase` on the start fixture gives 3 tables and 0 queries.
- Create `tests/database-assessment/pupil-view.check.ts`, modelled on the PowerPoint `pupil-view.check.ts`. It checks:
  - the slots and kinds;
  - downloads include the starting `.accdb` and the EVIDENCE template;
  - there are no supplied images;
  - a locked lesson blocks downloads and URLs;
  - there is no feedback before release;
  - after release, marks with no `ai_awarded` or `marker_evidence`.
- Run: `run-check.sh tests/database-assessment/results.check.ts tests/database-assessment/pupil-view.check.ts tests/powerpoint-assessment/results.check.ts tests/powerpoint-assessment/pupil-view.check.ts tests/assessment-paper/question-flags.check.ts tests/assessment-paper/class-feedback.check.ts`. Typecheck.

**Done when** all pass.

---

## Task 9: MCP

**Files to modify**
- `src/lib/mcp/activities.ts` 188: practical body validation per type. The example in the error message is the database body for the database type. 783: slot change for practical types, passing the type.
- `src/lib/mcp/upload-links.ts`:
  - `practical_file` for any practical type (slot lookup with the per-type schema).
  - `supplied_image` is refused unless the activity is PowerPoint: "kind "supplied_image" is for PowerPoint assessments".
  - The messages use the label.
  - Check the upload handler that stores a `practical_file`. It calls `storePracticalFile`, so `.accdb` follows. Confirm the stored-name extension handling accepts `.accdb`.
- `src/lib/mcp/assessment-activities.ts`:
  - `readPracticalActivity`.
  - `getAssessmentActivity`: `kind: activity.type` for practical types, the body described per type (`starting_database_file` for a database), `supplied_images` only for PowerPoint.
  - `getAssessmentActivityResult`: the `powerpoint` object for any practical type; questions also get `evidence_texts` (teacher MCP only).
  - `resolveLatestScript`: refuses `!isAssessmentPaperType`. PowerPoint keeps its wording; a database gets "Database assessments have no scripts; use get_practical_assessment_evidence or the results page."
  - `get_practical_assessment_evidence` (around line 1105): for a `database` row, return `{ kind: "database", status, error, summary: { version, tables: [{ name, fields, rows: rowCount }], queries: [design], forms, reports, relationships, changes }, description }`. Leave out record values beyond `RECORDS_SHOWN_MAX` per table. Keep the "no picture data" rule.
  - `handInPowerPointAssessmentForPupil`: any practical type.
- `src/app/api/MCP/route.ts`:
  - Add a `DATABASE_ASSESSMENT_WORKFLOW` description: create with `uploadSlots` (exactly one required `accdb`), `evidenceTemplateFile`, `startingDatabaseFile`; the `database` evidence source and its sections; `practical_file` uploads; hand in.
  - The `get_assessment_activity` description names `kind "database-assessment"`.
  - Update the `hand_in_powerpoint_assessment` description ("PowerPoint or database assessment").
  - Update the `set_assessment_activity_questions` evidence description to list `database` with its sections.
  - Update the result printer at line ~3417 (`r.powerpoint` for any practical type).
- `docs/MCP.md`: add a "Database assessment activities" section mirroring the PowerPoint one. Update the scorable type list, the `evidence` notes, the upload kinds and `get_practical_assessment_evidence`.

**Checks**
- Create `tests/database-assessment/mcp.check.ts`, modelled on the PowerPoint `mcp.check.ts`. It checks:
  - `create_activity` (through the lib function) with a database body; it refuses a body with no accdb slot;
  - `set_assessment_activity_questions` with database evidence;
  - `create_assessment_activity_file_upload_link` `practical_file` for the accdb slot is created; `supplied_image` is refused;
  - `get_assessment_activity` gives `kind "database-assessment"`, slots and `starting_database_file`;
  - `get_assessment_activity_result` gives `powerpoint.files` and `evidence_texts`;
  - `get_practical_assessment_evidence` gives the database summary without base64;
  - hand-in through `handInPowerPointAssessmentForPupil`;
  - the script download link is refused with the database wording.
- Run: `run-check.sh tests/database-assessment/mcp.check.ts tests/powerpoint-assessment/mcp.check.ts tests/assessment-paper/question-marks-mcp.check.ts`. Typecheck.

**Done when** all pass.

---

## Task 10: Lesson editor UI (no rebuild yet)

**Files to modify**
- `src/components/lessons/lesson-activities-manager.tsx`:
  - Line 132: add `{ value: "database-assessment", label: "Database Assessment", group: "interactive" }`.
  - Line 906: the toast text for any practical type ("Now set up the files pupils hand in, the question paper and the questions.").
  - Line 3930: practical.
  - Line 4431: create mode uses `defaultPracticalBody(type)`.
  - Line 4675: the editor branch for `isPracticalAssessmentType(type)` passes `type` to the editor. Use a `database-assessment-instructions` id for the database type.
  - Lines 6012/6014: task files for practical types. The database hint reads "Files pupils download with the task (the starting database and the blank evidence template) and any reference files the marker reads."
  - Line 6144: exclude practical types.
- `src/components/lessons/powerpoint-assessment-editor.tsx`: generalise it with a `type` prop.
  - Slot kinds come from `practicalTypeConfig(type).slotKinds`. `KIND_LABELS.accdb = "Database (.accdb)"`.
  - The main-kind rules use `mainKind`, with messages per type: "Add a database (.accdb) slot…" and "Only one slot can take the database (.accdb)…".
  - New-slot defaults per type.
  - The supplied images section is shown only when `hasSuppliedImages`.
  - When `hasStartingDatabase`, add a "Starting database" picker, built like the evidence template picker, over the activity's `.accdb` files. It saves `bodyData: { startingDatabaseFile }` and has a *Check* button calling `checkStartingDatabaseAction`, which shows "3 tables (APPOINTMENTS 60 records, …); no queries, forms or reports."
  - Keep the component and file name (decision 1). Update its header comment.
- `src/components/lessons/question-evidence-editor.tsx`:
  - `SOURCE_LABELS.database = "Database report"`, with a hint ("What the pupil's database says: tables, records, saved sort, lookups, saved queries, forms and reports, and what changed from the starting database.").
  - The sources offered come from `practicalTypeConfig(type).sources` (new `type` prop).
  - The database draft has checkboxes for the fixed keys, plus two text boxes: "Records of tables (comma-separated)" giving `records:X`, and "Saved queries by name (comma-separated)" giving `query:X`. "Required" is shown.
  - `toDraftSources` / `fromDraftSources` round-trip database sources.
  - `add()` starts with the type's first source.
  - Pass `type` from `src/components/lessons/assessment-paper-editor.tsx`, which has `setup.type`.
- `src/components/lessons/activity-view/index.tsx` 400, 1405: practical. The short view uses the label.

**Checks**
- Create `tests/database-assessment/editor.check.ts`:
  - Pure: `toDraftSources(fromDraftSources(x))` round-trips database sources with records and queries; `compatibleSlots('database', slots)` gives only the accdb slot.
  - Server actions the editor calls, as the PowerPoint `editor.check.ts` does: create with the default body; save the slots; set `startingDatabaseFile`; `checkStartingDatabaseAction`; `checkActivityEvidenceTemplate` with the template fixture and headings 1–9 and B1–B8 gives `missingHeadings []`.
- Run: `run-check.sh tests/database-assessment/editor.check.ts tests/powerpoint-assessment/editor.check.ts`. Typecheck.

**Done when** both pass and the typecheck is clean. **Do not rebuild.**

---

## Task 11: Results panel, pupil activity and dashboard UI (no rebuild yet)

**Files to modify**
- `src/components/assignment-results/powerpoint-evidence.tsx`:
  - `ACCEPT.accdb = ".accdb"`.
  - The hand-in and undo texts are generic ("files").
  - A collapsible "What the marker read from the database" `<pre>`-style block per question when `evidenceTexts` is non-empty. It is shown in `assessment-paper-marks-panel.tsx` next to the screenshots, and is teacher-only.
- `src/components/assignment-results/assessment-paper-marks-panel.tsx`: pass `evidenceTexts`; `hasWork` is unchanged.
- `src/components/assignment-results/assignment-results-dashboard.tsx` 544/551: `isPracticalAssessmentType`.
- `src/components/pupil/pupil-powerpoint-assessment-activity.tsx`:
  - `ACCEPT.accdb = ".accdb,application/vnd.ms-access,application/msaccess"`.
  - `KIND_NAME.accdb = "an Access database (.accdb) file"`.
  - The slot badge reads `.accdb`.
  - Copy that mentions a presentation becomes generic or per kind.
  - Before upload, the client refuses a `.laccdb` with the lock-file message. The server refuses it too.
- `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`:
  - The view map filter (1030) and the resubmit map are practical.
  - `case "database-assessment":` falls through to the same render, with the title fallback "Database assessment".
  - Check `renderActivity` in both Page and Slides layouts (CLAUDE.md: "a new activity type only needs adding there").

**Checks**
- Typecheck.
- Re-run `run-check.sh tests/database-assessment/pupil-view.check.ts tests/database-assessment/results.check.ts` to catch any server-side typing fallout.
- **Do not rebuild.**

**Done when** the typecheck is clean and the checks pass.

---

## Task 12: Setup script and the Palm Grove Vets spec

**Files**
- Modify `scripts/setup-powerpoint-assessment.ts` and `.sh`:
  - The spec gains `"type"`: `"powerpoint-assessment"` (the default) or `"database-assessment"`.
  - It creates the activity with that type and finds an existing one with `type = $3`.
  - It validates with `practicalBodyProblem(body, type)` and `validateQuestionEvidence(…, body, type)`.
  - It adds the optional `starting_database_file`, which must be in `activity_files`. It is checked with `readAccessDatabase` in the dry run (tables are listed in the output) and stored on the body.
  - Supplied images are refused in a database spec.
  - The `.sh` accepts specs in `scripts/powerpoint-assessments/` or `scripts/database-assessments/`, and installs `mdbtools` beside `poppler-utils`.
  - The header comments and `scripts/README.md` describe both.
  - The `--copy` path stays PowerPoint-only (it ignores database specs with a note).
- Create `scripts/database-assessments/palm-grove-vets.json`:
  - `lesson_id: "db8e7cd4-3088-413f-9ada-d5702f0cacc2"` and `title: "Hand in PALM GROVE VETS database and EVIDENCE"`.
  - Slots: `database` (accdb, label "PALM GROVE VETS database", required) and `evidence` (docx, label "EVIDENCE", required).
  - `data_activity_id: "ec3b183f-cb12-4d02-ab5c-cd4bca4f9752"`, `supplied_images: []`, `activity_files: ["PALM GROVE VETS.accdb","EVIDENCE.docx"]`, `evidence_template_file: "EVIDENCE.docx"`, `starting_database_file: "PALM GROVE VETS.accdb"`.
  - `question_paper: "lessons/db8e7cd4-…/activities/368ef993-4081-4806-a8fa-c1a21f08cbc6/6.2 DATABASES ASSESSMENT – PALM GROVE VETS.pdf"` and `mark_scheme: "lessons/db8e7cd4-…/6.2 DATABASES ASSESSMENT – PALM GROVE VETS MARK SCHEME.pdf"`. Check both against the dev `files/` tree; the prod-mirror paths above are where they were seen.
  - **68 questions, one per mark scheme row, 1 mark each.** Labels as in the mark scheme: `1a`–`1k`, `2(1)`, `2(2)`, `3(1)`, `3(2)`, `4`, `5(1)`–`5(3)`, `6(1)`–`6(6)`, `7(1)`–`7(6)`, `8a`–`8k`, `9(1)`–`9(3)`, `B1(a)`, `B1(b)`, `B2(1)`, `B2(2)`, `B3(1)`, `B3(2)`, `B4(a)(1)`, `B4(a)(2)`, `B4(b)`, `B5(a)`–`B5(c)`, `B6(a)`, `B6(b)(1)`, `B6(b)(2)`, `B7(a)`, `B7(b)`, `B7(c)(1)`, `B7(c)(2)`, `B7(d)`, `B8(a)`, `B8(b)(1)`, `B8(b)(2)`. That is 45 + 23.
  - `question_text`: the task instruction from the question paper. `mark_scheme`: "Award the mark for: … \nCheck / do not accept: …" from the mark scheme row, plus the "Expected results" facts where they apply (6(5), 7(*), 4, 9(3)).
  - Evidence per row. Every `evidence_section` source sets an explicit `heading`, because the labels differ from the headings:

    | Rows | Evidence |
    |---|---|
    | 1a–1k | `evidence_section heading "1" want screenshots required` + `database ["objects"]` |
    | 2(1) | `database ["changes"]` + `evidence_section "2" screenshots` (not required) |
    | 2(2) | `evidence_section "2" screenshots required` + `database ["changes","lookups"]` |
    | 3(1) | `database ["changes"]` + `evidence_section "3" screenshots` |
    | 3(2) | `evidence_section "3" screenshots required` + `database ["changes"]` |
    | 4 | `database ["table-sort","records:OWNERS"]` + `evidence_section "4" screenshots` |
    | 5(1)–5(3) | `evidence_section "5" screenshots required` + `database ["objects"]` |
    | 6(*) | `database ["queries"]` + `evidence_section "6" screenshots` |
    | 7(*) | `database ["queries"]` + `evidence_section "7" screenshots` |
    | 8a–8k | `evidence_section "8" screenshots required` + `database ["objects","queries"]` |
    | 9(*) | `evidence_section "9" screenshots required` + `database ["objects","queries"]` |
    | B1–B8 rows | `evidence_section heading "B<n>" want text required` |

  - `marking`: `ai_check` for the exact-measurement and fine-property rows `1b`, `1e`, `1f`, `1g`, `1h`, `5(3)`, `8h`; `ai` for the rest.
  - `success_criteria_id` per row from the lesson's LOs. Look them up on dev, read-only:
    ```
    docker exec dino_postgres sh -c 'psql -U "$POSTGRES_USER" -d dino -At -c "…"'
    ```
    on `lesson_success_criteria` for the lesson, plus the LO1/LO2/LO4 criteria found by LO title. Map Task 1 house-style rows to the form SCs (title/header, headings, field width/alignment, logo/date/button); 2/3 to `d0ce2746…`; 4 to `10570466…`; 6/7 to the query SCs (single criterion, multi-table, AND/OR, relational/Yes-No, dates, fields shown); sort rows to `08e3dd90…`; 8/9 to the report SCs; B1 to the primary/foreign key SCs; B2 to the relationship type SC; B3 to the relational-advantage SC; B4 to the referential integrity SC; B5 to the data type/size SCs; B6–B7 to validation; B8 to the query SCs. The dry run fails on an unknown id.
- Run, dry run only, then apply on **dev**:
  ```
  bash scripts/setup-powerpoint-assessment.sh scripts/database-assessments/palm-grove-vets.json
  bash scripts/setup-powerpoint-assessment.sh scripts/database-assessments/palm-grove-vets.json --apply
  ```
  Never use `--copy` or `--hand-in`.

**Checks**
- The dry run reports no problems: template headings 1–9 and B1–B8 all found, 68 questions, 68 marks, starting database read (3 tables).
- After `--apply`, read-only queries confirm: the activity exists with `max_marks = 68`, 68 questions, every non-B question with a database or screenshot source, and the activity files present.
- A second `--apply` changes nothing.
- Re-run `run-check.sh tests/powerpoint-assessment/questions.check.ts` (shared validation) and typecheck.

**Done when** Palm Grove Vets is set up on dev and the re-run is idempotent.

---

## Task 13: Documentation

**Files to modify**
- `CLAUDE.md`:
  - Add a "Database assessments" section after "PowerPoint assessments" (same shape: slots, the reader, sections, the starting database, the blank rules, the marking text, privacy, views, MCP, migration 146, setup, tests).
  - In the PowerPoint section, replace the "Spreadsheets, databases … separate activity types" sentence with how practical types share the machinery (the registry, `isPracticalAssessmentType`, slot-kind dispatch, field names kept as `powerpoint`).
  - In "Pupil feedback and per-question flags", note that it covers all three question-marked types.
  - Add mdbtools to the runtime tools note.
- `docs/MCP.md`, if not already complete from Task 9.
- `scripts/README.md`, if not already done in Task 12.

**Checks**
- Every file, function and test named in the docs exists (grep), and dates in examples are DD-MM-YYYY.

---

## Task 14: Full regression run, one dev rebuild and smoke check

1. Run every check in one go:
   ```
   run-check.sh tests/database-assessment/*.check.ts tests/powerpoint-assessment/*.check.ts tests/pptx/inspect.check.ts tests/assessment-paper/question-flags.check.ts tests/assessment-paper/class-feedback.check.ts tests/assessment-paper/question-marks-mcp.check.ts tests/assessment-paper/mark-scheme-split.check.ts tests/upload-file/ai-marking.check.ts
   ```
   Typecheck.
2. Run `bash scripts/migrate.sh --check`; nothing is pending.
3. **Rebuild the dev app once:** `docker compose build dino-app && docker compose up -d dino-app`. Nothing else may build at the same time. Then:
   - `docker compose exec -T dino-app sh -c 'mdb-ver --version; pdfinfo -v'` shows mdbtools present;
   - the app answers on :3000.
4. Smoke test as a teacher in the browser, if the parent has a browser tool. Otherwise use HTTP plus read-only SQL.
   - The lesson page shows the Palm Grove activity in Page and Slides views.
   - The editor shows the slots, the starting database check and the database evidence sources.
   - Upload the model answer files **as a teacher for a test pupil** with *Hand in left alone*. The read is not triggered by upload, and nothing calls a model.
   - The pupil view shows the slots and downloads.
   - **Do not hand in in the live app.** That queues a real model call. The read and mark paths are covered by the checks.
   - Remove the test pupil's files afterwards (`removePracticalFile` through the UI's remove).

**Done when** everything is green and the rebuilt app is serving.

---

## Task 15 (optional, can be deferred): Phase 2 rule checks as data

**Design only, unless the teacher asks for it:**
- Add `activity_questions.checks jsonb DEFAULT '[]'` in a new migration. Each element is a rule over the database report, for example:
  - `{ kind: "query_outputs", query, equals: [...] }`
  - `{ kind: "query_hidden", query, field }`
  - `{ kind: "query_criteria", query, field, anyOf: ["<#1/1/2020#","<=#12/31/2019#"] }`
  - `{ kind: "query_sort", query, field, direction }`
  - `{ kind: "query_tables", query, equals }`
  - `{ kind: "record_added", table, values: {...} }`
  - `{ kind: "table_sort", table, orderBy, direction }`
  - `{ kind: "lookup", table, field, limitToList }`
- The rules are validated like evidence, and nothing in code knows Palm Grove. They are evaluated at the read (pure functions in `src/lib/accdb/rules.ts`, on normalised expressions), stored with the answer, and given to the marker as "CHECK RESULTS (exact)". A disagreement between the model and a rule flags the question *Check*.
- They never award marks without the model in this phase.
- Checks: a rules unit check against the model answer (all pass) and doctored snapshots (each fails with a clear reason).

## Task 16 (later): Al Noor and Gulf Star specs; copying old uploads

- Add `scripts/database-assessments/al-noor-*.json` and `gulf-star-*.json` once their lessons, mark schemes and model answers exist, then do the same dry run and apply.
- Optionally generalise `scripts/copy-uploads-to-powerpoint-assessment.{sh,ts}` to practical types (by extension `.accdb`/`.docx`), so pupils' work already in the lesson's two Upload File activities ("Upload PALM GROVE VETS database", "Upload EVIDENCE") can fill the new slots. This depends on open question 2.

---

## Open questions for the teacher

1. **`.mdb` refusal.** Pupils who save in the old `.mdb` format are told to save again as `.accdb`. Is that right, or do some school machines produce `.mdb`?
2. **Existing uploads.** The Palm Grove lesson already has two Upload File activities. Should pupils' files there be copied into the new activity (Task 16), or will pupils hand in again?
3. **Which rows need a teacher's Check.** The plan sends `1b`, `1e`, `1f`, `1g`, `1h`, `5(3)` and `8h` to Check. Should any others be added, for example `8k` (one side of A4)?

---

### Critical Files for Implementation
- /home/leroy/planner-004/src/lib/powerpoint-assessment/reading.ts
- /home/leroy/planner-004/src/lib/powerpoint-assessment/files.ts
- /home/leroy/planner-004/src/lib/powerpoint-assessment/evidence-spec.ts
- /home/leroy/planner-004/src/lib/powerpoint-assessment/marking.ts
- /home/leroy/planner-004/src/lib/ai/marking-queue.ts

New core files the plan creates: /home/leroy/planner-004/src/lib/accdb/{mdbtools,read,describe,diff,section-selectors,errors,check,types}.ts, /home/leroy/planner-004/src/lib/practical-assessment/types.ts, /home/leroy/planner-004/src/lib/database-assessment/marking-text.ts, /home/leroy/planner-004/src/migrations/146-database-assessment.sql, /home/leroy/planner-004/scripts/database-assessments/palm-grove-vets.json, /home/leroy/planner-004/tests/database-assessment/*.check.ts, /home/leroy/planner-004/tests/fixtures/database/*.

Exploration notes for the parent:
- **mdbtools re-check.** I re-ran mdbtools 1.0 in a throwaway `debian:bookworm-slim` container with the fixtures mounted read-only.
  - `mdb-json` exists and supports `-D`/`-T` strftime date formats, so dates come out directly as `22-03-2027`.
  - Without `-T`, dates come out with two-digit years (`03/22/27`), so the format must be set.
  - Booleans come out as `1`/`0` and currency as `450.0000`.
  - The MSysQueries attributes match the spike. The hidden `DATE OF BIRTH` is in attribute 11 but not attribute 6.
  - `mdb-schema` printed no primary keys or indexes.
  - A truncated file makes `mdb-tables` exit 1 with "File does not appear to be an Access database"; garbage makes `mdb-ver` exit 1.
- **Row counts.** Start file: OWNERS 25, APPOINTMENTS 60. Model answer: 26 and 61.
- **Constraint to change.** `practical_submission_evidence.kind` has a CHECK (`'presentation','pdf','evidence_doc'`), so migration 146 must widen it. That is easy to miss.
- **Success criteria.** The Palm Grove lesson exists on dev with 21 lesson success criteria. The LO1, LO2 and LO4 criteria also exist (found by LO title).