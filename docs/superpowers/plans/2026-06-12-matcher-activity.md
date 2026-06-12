# Matcher Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new scorable lesson activity type, "matcher", where pupils match key terms to definitions via a table of rows, each row showing one side fixed and the other side as a dropdown of all possible answers; scored all-or-nothing.

**Architecture:** Follow the existing multiple-choice-question (MCQ) conventions throughout: Zod schemas in `src/types/index.ts`, scorable-type registration in `src/dino.config.ts`, a `getMatcherBody` helper in `activity-view/utils.ts`, edit/present rendering branches in `activity-view/index.tsx`, an editor section in `lesson-activities-manager.tsx`, a SQL scoring branch in `compute_submission_base_score`, an `upsertMatcherSubmissionAction` server action mirroring `upsertMcqSubmissionAction`, and a new `PupilMatcherActivity` component wired into the pupil lesson page exactly like `PupilMcqActivity`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zod, PostgreSQL (`pg`), Tailwind, Radix UI (`Select`, `Button`, `Badge`).

**Data model decisions (from user clarification):**
- Scoring: all-or-nothing. `is_correct = true` only if every row's selection matches its pair.
- Per row, whether the term or the definition is the fixed "prompt" and which side has the dropdown is **randomized per row**, generated **once per pupil submission** and persisted in the submission body (`layout`).
- Dropdown options for a row = all values from the *other* column across the whole activity (shuffled client-side).
- Up to 8 pairs per activity (min 2), edited via an add/remove pair list (not a fixed slot grid).
- Teachers get a "Reveal answer" toggle in present mode (matches MCQ's green-highlight pattern) showing the correct pairing for every row.

---

### Task 1: Add Zod schemas and register "matcher" as scorable

**Files:**
- Modify: `src/types/index.ts` (insert after `SketchRenderSubmissionBody` types, around line 638)
- Modify: `src/dino.config.ts` (lines 1-11)

- [ ] **Step 1: Add matcher schemas to `src/types/index.ts`**

Insert immediately after the `SketchRenderSubmissionBody` type export (after line 638):

```ts
export const MatcherPairSchema = z.object({
    id: z.string().min(1),
    term: z.string().min(1).max(500),
    definition: z.string().min(1).max(1000),
});

export const MatcherActivityBodySchema = z
    .object({
        pairs: z.array(MatcherPairSchema).min(2).max(8),
    })
    .passthrough();

export const MatcherLayoutEntrySchema = z.object({
    pairId: z.string().min(1),
    promptSide: z.enum(["term", "definition"]),
});

export const MatcherSubmissionBodySchema = z
    .object({
        layout: z.array(MatcherLayoutEntrySchema).default([]),
        answers: z.record(z.string(), z.string().nullable()).default({}),
        is_correct: z.boolean().default(false),
        teacher_override_score: z.number().min(0).max(1).nullable().optional(),
        teacher_feedback: z.string().nullable().optional(),
        success_criteria_scores: z
            .record(z.string(), z.number().min(0).max(1).nullable())
            .default({}),
    })
    .passthrough();

export type MatcherPair = z.infer<typeof MatcherPairSchema>;
export type MatcherActivityBody = z.infer<typeof MatcherActivityBodySchema>;
export type MatcherLayoutEntry = z.infer<typeof MatcherLayoutEntrySchema>;
export type MatcherSubmissionBody = z.infer<typeof MatcherSubmissionBodySchema>;
```

- [ ] **Step 2: Register "matcher" as a scorable activity type in `src/dino.config.ts`**

Change lines 1-11 from:

```ts
export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "feedback",
  "sketch-render",
  "do-flashcards",
]);
```

to:

```ts
export const SCORABLE_ACTIVITY_TYPES = Object.freeze([
  "multiple-choice-question",
  "short-text-question",
  "text-question",
  "long-text-question",
  "upload-file",
  "upload-url",
  "feedback",
  "sketch-render",
  "do-flashcards",
  "matcher",
]);
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "types/index\|dino.config"`
Expected: no output (no new errors referencing these files).

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/dino.config.ts
git commit -m "feat(matcher): add matcher activity schemas and register as scorable"
```

---

### Task 2: SQL scoring support for matcher

**Files:**
- Create: `src/migrations/074-matcher-activity-score.sql`
- Modify: `src/migrations/schema.sql` (the `compute_submission_base_score(jsonb, text)` function, lines ~138-185)

- [ ] **Step 1: Create the migration file**

Create `src/migrations/074-matcher-activity-score.sql`:

```sql
-- Score "matcher" activities the same way as multiple-choice-question:
-- all-or-nothing based on the submission body's is_correct flag.

CREATE OR REPLACE FUNCTION public.compute_submission_base_score(body jsonb, activity_type text) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
declare
  override numeric;
  auto_score numeric;
  normalized_type text := lower(coalesce(activity_type, ''));
  bool_value boolean;
begin
  if body is null then
    return null;
  end if;

  override := safe_numeric(
    coalesce(body->>'teacher_override_score', body->>'override_score')
  );

  if override is not null then
    return clamp_score(override);
  end if;

  if normalized_type = 'multiple-choice-question' or normalized_type = 'matcher' then
    begin
      bool_value := (body->>'is_correct')::boolean;
    exception when others then
      bool_value := null;
    end;

    if bool_value is not null then
      auto_score := case when bool_value then 1 else 0 end;
    else
      auto_score := safe_numeric(coalesce(body->>'score', body->>'auto_score'));
    end if;
  elsif normalized_type = 'short-text-question' then
    auto_score := safe_numeric(
      coalesce(body->>'teacher_ai_score', body->>'ai_model_score', body->>'score', body->>'auto_score')
    );
  else
    auto_score := safe_numeric(coalesce(body->>'score', body->>'auto_score'));
  end if;

  if auto_score is not null then
    return clamp_score(auto_score);
  end if;

  return null;
end;
$$;
```

- [ ] **Step 2: Apply the migration to the dev database**

Run: `cd /Users/leroysalih/nodejs/planner-004 && set -a && source .env && set +a && psql "$DATABASE_URL" -f src/migrations/074-matcher-activity-score.sql`
Expected: `CREATE FUNCTION` (via `CREATE OR REPLACE FUNCTION`), no errors.

- [ ] **Step 3: Verify the function behaves correctly**

Run:
```bash
psql "$DATABASE_URL" -c "select compute_submission_base_score('{\"is_correct\": true}'::jsonb, 'matcher');"
psql "$DATABASE_URL" -c "select compute_submission_base_score('{\"is_correct\": false}'::jsonb, 'matcher');"
```
Expected: first returns `1`, second returns `0`.

- [ ] **Step 4: Update `src/migrations/schema.sql` to match (keep the schema dump in sync)**

In `src/migrations/schema.sql`, find the `CREATE FUNCTION public.compute_submission_base_score(body jsonb, activity_type text)` block (around line 138). Change the condition on line 159:

```sql
  if normalized_type = 'multiple-choice-question' then
```

to:

```sql
  if normalized_type = 'multiple-choice-question' or normalized_type = 'matcher' then
```

- [ ] **Step 5: Commit**

```bash
git add src/migrations/074-matcher-activity-score.sql src/migrations/schema.sql
git commit -m "feat(matcher): score matcher submissions all-or-nothing via is_correct"
```

---

### Task 3: `getMatcherBody` helper and default-body builder

**Files:**
- Modify: `src/components/lessons/activity-view/utils.ts`

- [ ] **Step 1: Add `MatcherBody` types and `getMatcherBody`/`createDefaultMatcherBody`/`createMatcherPairId` helpers**

Add to `src/components/lessons/activity-view/utils.ts`, after the `getMcqBody` function (after line 209):

```ts
export interface MatcherPairBody {
  id: string;
  term: string;
  definition: string;
}

export interface MatcherBody {
  pairs: MatcherPairBody[];
}

export function createMatcherPairId(used: Set<string>): string {
  let index = 1;
  let candidate = `pair-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `pair-${index}`;
  }
  return candidate;
}

export function createDefaultMatcherBody(): MatcherBody {
  return {
    pairs: [
      { id: "pair-1", term: "", definition: "" },
      { id: "pair-2", term: "", definition: "" },
    ],
  };
}

export function getMatcherBody(activity: LessonActivity): MatcherBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return createDefaultMatcherBody();
  }

  const record = activity.body_data as Record<string, unknown>;
  const rawPairs = Array.isArray(record.pairs) ? record.pairs : [];

  const used = new Set<string>();
  const pairs = rawPairs
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const pair = item as Record<string, unknown>;
      let id = typeof pair.id === "string" && pair.id.trim() !== "" ? pair.id.trim() : "";
      if (!id || used.has(id)) {
        id = createMatcherPairId(used);
      }
      used.add(id);
      const term = typeof pair.term === "string" ? pair.term : "";
      const definition = typeof pair.definition === "string" ? pair.definition : "";
      return { id, term, definition };
    })
    .filter((pair): pair is MatcherPairBody => pair !== null);

  return pairs.length > 0 ? { pairs } : createDefaultMatcherBody();
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "activity-view/utils"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/lessons/activity-view/utils.ts
git commit -m "feat(matcher): add getMatcherBody helper"
```

---

### Task 4: Render matcher in the activity edit view (teacher activity list)

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx`

- [ ] **Step 1: Import `getMatcherBody`**

In `src/components/lessons/activity-view/index.tsx`, add `getMatcherBody` to the existing import from `@/components/lessons/activity-view/utils` (around line 24, alphabetically near `getMcqBody`):

```ts
import {
  getActivityFileUrlValue,
  getActivityTextValue,
  getDisplaySectionBody,
  getFeedbackBody,
  getImageBody,
  getFlashcardsText,
  getLongTextBody,
  getMatcherBody,
  getMcqBody,
  getShortTextBody,
  getRichTextMarkup,
  getUploadUrlBody,
  getVoiceBody,
  isAbsoluteUrl,
} from "@/components/lessons/activity-view/utils"
```

- [ ] **Step 2: Add the matcher branch to `ActivityEditView`**

In `ActivityEditView` (function starting at line 1206), add a new branch right after the `multiple-choice-question` branch ends (after line 1305, before the `short-text-question` branch):

```tsx
  if (activity.type === "matcher") {
    const matcher = getMatcherBody(activity)

    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Term &amp; definition pairs
        </p>
        <ul className="space-y-2">
          {matcher.pairs.map((pair, index) => (
            <li key={pair.id} className="rounded-md border border-border/60 bg-muted/30 p-2">
              <p className="font-medium text-foreground">
                {pair.term.trim() || `Term ${index + 1}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {pair.definition.trim() || "No definition provided"}
              </p>
            </li>
          ))}
        </ul>
      </div>
    )
  }
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "activity-view"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/lessons/activity-view/index.tsx
git commit -m "feat(matcher): render matcher pairs in activity edit view"
```

---

### Task 5: Teacher presentation view with reveal toggle

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx`

- [ ] **Step 1: Add `XCircle` to the lucide-react import**

Change line 39 from:

```ts
import { CheckCircle2, Download, Eye, EyeOff, Loader2, Pencil } from "lucide-react"
```

to:

```ts
import { CheckCircle2, Download, Eye, EyeOff, Loader2, Pencil, XCircle } from "lucide-react"
```

- [ ] **Step 2: Add a `MatcherPresentView` component**

Add this new component just before `ActivityPresentView` (before line 843, i.e. right after the closing brace of `McqPresentView`):

```tsx
function MatcherPresentView({
  activity,
  canReveal = false,
}: {
  activity: LessonActivity
  canReveal?: boolean
}) {
  const matcher = getMatcherBody(activity)
  const [isRevealed, setIsRevealed] = useState(false)

  useEffect(() => {
    setIsRevealed(false)
  }, [activity.activity_id])

  const revealEnabled = canReveal && isRevealed

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
        <h3 className="text-2xl font-semibold text-foreground">
          {activity.title?.trim() || "Match the key terms to their definitions"}
        </h3>
        {canReveal ? (
          <Button
            type="button"
            size="sm"
            variant={revealEnabled ? "default" : "outline"}
            onClick={() => setIsRevealed((previous) => !previous)}
            aria-pressed={revealEnabled}
            className={cn("shrink-0", revealEnabled && "bg-green-600 text-white hover:bg-green-700")}
          >
            {revealEnabled ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
                Hide answers
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                Reveal answers
              </>
            )}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Pupils match each term to its definition on their devices. Use reveal when you are ready to discuss the answers.
      </p>

      <ul className="space-y-3">
        {matcher.pairs.map((pair, index) => (
          <li
            key={pair.id}
            className={cn(
              "grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2",
              revealEnabled && "border-green-600 bg-green-50 dark:bg-green-950/30",
            )}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Term {index + 1}
              </p>
              <p className="text-sm font-medium text-foreground">
                {pair.term.trim() || `Term ${index + 1}`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Definition
              </p>
              <p className="text-sm text-foreground">
                {pair.definition.trim() || "No definition provided"}
              </p>
            </div>
            {revealEnabled ? (
              <span className="col-span-full inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-green-600">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Correct match
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Note: `XCircle` is imported for use by `PupilMatcherActivity` in Task 8 (which lives in a different file and imports lucide-react independently) — actually remove that import from this file if unused here. Re-check: this component does not use `XCircle`. **Skip Step 1** (do not add `XCircle` to this file's import) — it is only needed in the new pupil component file created in Task 8, which has its own imports.

- [ ] **Step 3: Wire the matcher type into `ActivityPresentView`**

In `ActivityPresentView` (around line 1133-1141), add a new branch right after the `multiple-choice-question` branch:

```tsx
  if (activity.type === "multiple-choice-question") {
    return wrap(
      <McqPresentView
        activity={activity}
        fetchActivityFileUrl={fetchActivityFileUrl}
        canReveal={previewMode ? false : viewerCanReveal}
      />
    )
  }

  if (activity.type === "matcher") {
    return wrap(
      <MatcherPresentView
        activity={activity}
        canReveal={previewMode ? false : viewerCanReveal}
      />
    )
  }
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "activity-view"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/lessons/activity-view/index.tsx
git commit -m "feat(matcher): add teacher present view with reveal-answers toggle"
```

---

### Task 6: Editor sidebar UI for matcher (create/edit pairs)

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`

- [ ] **Step 1: Add "matcher" to the activity type dropdown**

Change line 85 area — insert a new entry right after `multiple-choice-question` in `ACTIVITY_TYPES` (lines 74-93):

```ts
const ACTIVITY_TYPES = [
  { value: "text", label: "Text" },
  { value: "long-text-question", label: "Long text question" },
  { value: "file-download", label: "File download" },
  { value: "upload-file", label: "Upload file" },
  { value: "upload-url", label: "Upload URL" },
  { value: "display-image", label: "Display image" },
  { value: "display-flashcards", label: "Flashcards" },
  { value: "display-section", label: "Display Section" },
  { value: "do-flashcards", label: "Do Flashcards" },
  { value: "show-video", label: "Show video" },
  { value: "multiple-choice-question", label: "Multiple choice question" },
  { value: "matcher", label: "Matcher" },
  { value: "short-text-question", label: "Short text question" },
  { value: "feedback", label: "Feedback" },
  { value: "text-question", label: "Text question" },
  { value: "voice", label: "Voice recording" },
  { value: "sketch-render", label: "Render Sketch" },
  { value: "share-my-work", label: "Share my work" },
  { value: "review-others-work", label: "Review others' work" },
] as const
```

- [ ] **Step 2: Import `getMatcherBody`, `createDefaultMatcherBody`, `createMatcherPairId`, and `MatcherBody`**

Change the `@/components/lessons/activity-view/utils` import (lines 35-49) to add the matcher helpers:

```ts
import {
  getImageBody,
  computeSectionIndexMap,
  getFeedbackBody,
  getDisplaySectionBody,
  getMatcherBody,
  getMcqBody,
  getShortTextBody,
  getVoiceBody,
  getYouTubeThumbnailUrl,
  isAbsoluteUrl,
  createDefaultMatcherBody,
  createMatcherPairId,
  type ImageBody,
  type MatcherBody,
  type McqBody,
  type ShortTextBody,
  type VoiceBody,
} from "@/components/lessons/activity-view/utils"
```

- [ ] **Step 3: Add `matcherBody` state**

Near the `mcqBody` state declaration (line 1820), add:

```ts
  const [matcherBody, setMatcherBody] = useState<MatcherBody>(() => createDefaultMatcherBody())
```

- [ ] **Step 4: Add matcher validation and helper functions**

Add these functions near the other MCQ helper functions at the bottom of the file (after `prepareMcqBodyForSave`, which ends around line 4262 — place these directly after that function):

```ts
function normalizeMatcherBody(body: MatcherBody): MatcherBody {
  const used = new Set<string>()
  const pairs = (body.pairs ?? []).slice(0, 8).map((pair) => {
    let id = typeof pair.id === "string" && pair.id.trim().length > 0 ? pair.id.trim() : ""
    if (!id || used.has(id)) {
      id = createMatcherPairId(used)
    }
    used.add(id)
    return {
      id,
      term: typeof pair.term === "string" ? pair.term : "",
      definition: typeof pair.definition === "string" ? pair.definition : "",
    }
  })

  if (pairs.length === 0) {
    return createDefaultMatcherBody()
  }

  return { pairs }
}

function validateMatcherBody(body: MatcherBody): string | null {
  const normalized = normalizeMatcherBody(body)

  if (normalized.pairs.length < 2) {
    return "Add at least two term/definition pairs."
  }

  const incomplete = normalized.pairs.some(
    (pair) => pair.term.trim().length === 0 || pair.definition.trim().length === 0,
  )
  if (incomplete) {
    return "Every pair needs both a term and a definition."
  }

  return null
}

function prepareMatcherBodyForSave(body: MatcherBody): { bodyData: MatcherBody; error: string | null } {
  const normalized = normalizeMatcherBody(body)
  const validation = validateMatcherBody(normalized)
  if (validation) {
    return { bodyData: normalized, error: validation }
  }
  return { bodyData: normalized, error: null }
}
```

- [ ] **Step 5: Add matcher change handlers**

Add these handlers near `handleMcqOptionTextChange`/`handleMcqCorrectOptionChange` (after line 1965):

```ts
  const matcherValidationMessage = useMemo(() => validateMatcherBody(matcherBody), [matcherBody])

  const updateMatcherBody = useCallback((updater: (current: MatcherBody) => MatcherBody) => {
    setMatcherBody((previous) => normalizeMatcherBody(updater(normalizeMatcherBody(previous))))
  }, [])

  const handleMatcherTermChange = useCallback((pairId: string, value: string) => {
    updateMatcherBody((current) => ({
      ...current,
      pairs: current.pairs.map((pair) => (pair.id === pairId ? { ...pair, term: value } : pair)),
    }))
  }, [updateMatcherBody])

  const handleMatcherDefinitionChange = useCallback((pairId: string, value: string) => {
    updateMatcherBody((current) => ({
      ...current,
      pairs: current.pairs.map((pair) => (pair.id === pairId ? { ...pair, definition: value } : pair)),
    }))
  }, [updateMatcherBody])

  const handleMatcherAddPair = useCallback(() => {
    updateMatcherBody((current) => {
      if (current.pairs.length >= 8) {
        toast.error("You can add up to 8 pairs.")
        return current
      }
      const used = new Set(current.pairs.map((pair) => pair.id))
      const id = createMatcherPairId(used)
      return { ...current, pairs: [...current.pairs, { id, term: "", definition: "" }] }
    })
  }, [updateMatcherBody])

  const handleMatcherRemovePair = useCallback((pairId: string) => {
    updateMatcherBody((current) => {
      if (current.pairs.length <= 2) {
        toast.error("Keep at least 2 pairs.")
        return current
      }
      return { ...current, pairs: current.pairs.filter((pair) => pair.id !== pairId) }
    })
  }, [updateMatcherBody])
```

- [ ] **Step 6: Initialize/reset `matcherBody` alongside `mcqBody`**

There are three places `mcqBody` is reset based on activity type — mirror each with `matcherBody`:

a) In the create-mode reset block (around line 2475), change:

```ts
      setMcqBody(createDefaultMcqBody())
      setShortTextBody(createDefaultShortTextBody())
```

to:

```ts
      setMcqBody(createDefaultMcqBody())
      setMatcherBody(createDefaultMatcherBody())
      setShortTextBody(createDefaultShortTextBody())
```

b) In the edit-mode load block (around lines 2517-2521), change:

```ts
      if (ensuredType === "multiple-choice-question") {
        setMcqBody(normalizeMcqBody(getMcqBody(activity)))
      } else {
        setMcqBody(createDefaultMcqBody())
      }
```

to:

```ts
      if (ensuredType === "multiple-choice-question") {
        setMcqBody(normalizeMcqBody(getMcqBody(activity)))
      } else {
        setMcqBody(createDefaultMcqBody())
      }
      if (ensuredType === "matcher") {
        setMatcherBody(normalizeMatcherBody(getMatcherBody(activity)))
      } else {
        setMatcherBody(createDefaultMatcherBody())
      }
```

c) In the sheet-close reset block (around line 2581), change:

```ts
      setMcqBody(createDefaultMcqBody())
      setShortTextBody(createDefaultShortTextBody())
```

to:

```ts
      setMcqBody(createDefaultMcqBody())
      setMatcherBody(createDefaultMatcherBody())
      setShortTextBody(createDefaultShortTextBody())
```

d) In the type-change effect (around lines 2813-2820), add a new block right after the `multiple-choice-question` block:

```ts
    if (type === "multiple-choice-question") {
      if (activity) {
        setMcqBody(normalizeMcqBody(getMcqBody(activity)))
      } else {
        setMcqBody(createDefaultMcqBody())
      }
      return
    }

    if (type === "matcher") {
      if (activity) {
        setMatcherBody(normalizeMatcherBody(getMatcherBody(activity)))
      } else {
        setMatcherBody(createDefaultMatcherBody())
      }
      return
    }
```

- [ ] **Step 7: Hook matcher into the save handler**

In the save handler's type branching (around line 3215), add a new branch right after the `multiple-choice-question` branch:

```ts
    } else if (type === "multiple-choice-question") {
      const { bodyData: preparedMcqBody, error } = prepareMcqBodyForSave(mcqBody)
      if (error) {
        toast.error(error)
        return
      }
      bodyData = preparedMcqBody
    } else if (type === "matcher") {
      const { bodyData: preparedMatcherBody, error } = prepareMatcherBodyForSave(matcherBody)
      if (error) {
        toast.error(error)
        return
      }
      bodyData = preparedMatcherBody
    } else if (type === "short-text-question") {
```

- [ ] **Step 8: Disable save when matcher is invalid**

In `disableSave` (around line 3305-3311), add the matcher check:

```ts
  const disableSave =
    isPending ||
    isProcessing ||
    isRecording ||
    (type !== "voice" && rawBodyError !== null) ||
    (type === "multiple-choice-question" && mcqValidationMessage !== null) ||
    (type === "matcher" && matcherValidationMessage !== null) ||
    (type === "short-text-question" && shortTextValidationMessage !== null)
```

- [ ] **Step 9: Add the matcher editor form**

In the JSX, add a new block right after the `multiple-choice-question` editor block closes (after line 3628, before the `short-text-question` block):

```tsx
          {type === "matcher" ? (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground">
                  Term &amp; definition pairs
                </Label>
                <div className="space-y-3">
                  {matcherBody.pairs.map((pair, index) => (
                    <div key={pair.id} className="space-y-2 rounded-md border border-border bg-background p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Pair {index + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleMatcherRemovePair(pair.id)}
                          disabled={isPending || matcherBody.pairs.length <= 2}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground" htmlFor={`matcher-term-${pair.id}`}>
                          Term
                        </Label>
                        <Input
                          id={`matcher-term-${pair.id}`}
                          value={pair.term}
                          onChange={(event) => handleMatcherTermChange(pair.id, event.target.value)}
                          placeholder="Key term"
                          disabled={isPending}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground" htmlFor={`matcher-definition-${pair.id}`}>
                          Definition
                        </Label>
                        <Textarea
                          id={`matcher-definition-${pair.id}`}
                          value={pair.definition}
                          onChange={(event) => handleMatcherDefinitionChange(pair.id, event.target.value)}
                          placeholder="Definition for this term"
                          disabled={isPending}
                          rows={2}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleMatcherAddPair}
                  disabled={isPending || matcherBody.pairs.length >= 8}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add pair
                </Button>
              </div>

              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>Add between 2 and 8 pairs. Every pair needs both a term and a definition.</p>
                {matcherValidationMessage ? (
                  <p className="text-destructive">{matcherValidationMessage}</p>
                ) : null}
              </div>
            </div>
          ) : null}
```

- [ ] **Step 10: Verify types compile and lint**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "lesson-activities-manager"`
Expected: no output.

Run: `pnpm lint 2>&1 | grep -i "lesson-activities-manager"`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add src/components/lessons/lesson-activities-manager.tsx
git commit -m "feat(matcher): add teacher editor UI for matcher pairs"
```

---

### Task 7: `upsertMatcherSubmissionAction` server action

**Files:**
- Modify: `src/lib/server-actions/submissions.ts`
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Import matcher schemas**

In `src/lib/server-actions/submissions.ts`, add to the existing import from `@/types` (near `McqActivityBodySchema`, `McqSubmissionBodySchema` around line 7-8):

```ts
  MatcherActivityBodySchema,
  MatcherSubmissionBodySchema,
```

- [ ] **Step 2: Add `MatcherSubmissionInputSchema`**

Add near `McqSubmissionInputSchema` (after line 36):

```ts
const MatcherSubmissionInputSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1),
  layout: z.array(
    z.object({
      pairId: z.string().min(1),
      promptSide: z.enum(["term", "definition"]),
    }),
  ).min(1),
  answers: z.record(z.string(), z.string().nullable()),
});
```

- [ ] **Step 3: Add `upsertMatcherSubmissionAction`**

Add this function right after `upsertMcqSubmissionAction` ends (after the function's closing brace and its trailing `catch` block, i.e. after the block ending around line 845 — locate the end of `upsertMcqSubmissionAction` by finding its matching closing `}` for the outer `try`/return, then insert after it):

```ts
export async function upsertMatcherSubmissionAction(
  input: z.infer<typeof MatcherSubmissionInputSchema>,
) {
  const payload = MatcherSubmissionInputSchema.parse(input);
  let activity: { body_data: unknown; lesson_id: string | null } | null = null;
  try {
    const { rows } = await query<
      { body_data: unknown; lesson_id: string | null }
    >(
      "select body_data, lesson_id from activities where activity_id = $1 limit 1",
      [payload.activityId],
    );
    activity = rows[0] ?? null;
  } catch (error) {
    console.error(
      "[submissions] Failed to load activity for matcher submission:",
      error,
    );
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : "Unable to load activity.",
      data: null as Submission | null,
    };
  }

  if (!activity) {
    return {
      success: false,
      error: "Activity not found for submission.",
      data: null as Submission | null,
    };
  }

  const parsedActivity = MatcherActivityBodySchema.safeParse(activity.body_data);
  if (!parsedActivity.success) {
    console.error(
      "[submissions] Invalid matcher activity body:",
      parsedActivity.error,
    );
    return {
      success: false,
      error: "Activity is not configured correctly.",
      data: null as Submission | null,
    };
  }
  const lessonId = activity.lesson_id ??
    (await getActivityLessonId(payload.activityId));

  const matcherBody = parsedActivity.data;
  const pairIds = new Set(matcherBody.pairs.map((pair) => pair.id));

  const layoutCoversAllPairs = matcherBody.pairs.every((pair) =>
    payload.layout.some((entry) => entry.pairId === pair.id),
  );
  if (!layoutCoversAllPairs) {
    return {
      success: false,
      error: "Activity layout is no longer valid for this submission.",
      data: null as Submission | null,
    };
  }

  const isCorrect = matcherBody.pairs.every(
    (pair) => payload.answers[pair.id] === pair.id,
  );

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
    payload.activityId,
  );
  const successCriteriaScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: isCorrect ? 1 : 0,
  });

  const sanitizedAnswers: Record<string, string | null> = {};
  for (const [pairId, value] of Object.entries(payload.answers)) {
    if (pairIds.has(pairId)) {
      sanitizedAnswers[pairId] = typeof value === "string" && pairIds.has(value) ? value : null;
    }
  }

  const submissionBody = MatcherSubmissionBodySchema.parse({
    layout: payload.layout,
    answers: sanitizedAnswers,
    is_correct: isCorrect,
    success_criteria_scores: successCriteriaScores,
    teacher_override_score: null,
    teacher_feedback: null,
  });

  let existingSubmissionId: string | null = null;
  try {
    const { rows } = await query(
      `
        select submission_id
        from submissions
        where activity_id = $1
          and user_id = $2
        order by submitted_at desc nulls last
        limit 1
      `,
      [payload.activityId, payload.userId],
    );
    const existingRow = rows?.[0] ?? null;
    existingSubmissionId =
      existingRow && typeof existingRow.submission_id === "string"
        ? existingRow.submission_id
        : null;
  } catch (existingError) {
    console.error(
      "[submissions] Failed to check existing matcher submission:",
      existingError,
    );
    const message = existingError instanceof Error
      ? existingError.message
      : "Unable to load submission.";
    return { success: false, error: message, data: null as Submission | null };
  }

  const timestamp = new Date().toISOString();

  if (existingSubmissionId) {
    try {
      const { rows } = await query(
        `
          update submissions
          set body = $1, submitted_at = $2, is_flagged = false, resubmit_requested = false, resubmit_note = NULL
          where submission_id = $3
          returning *
        `,
        [submissionBody, timestamp, existingSubmissionId],
      );

      const parsed = SubmissionSchema.safeParse(rows?.[0]);
      if (!parsed.success) {
        console.error(
          "[submissions] Failed to parse updated matcher submission:",
          parsed.error,
        );
        return {
          success: false,
          error: "Invalid submission data.",
          data: null as Submission | null,
        };
      }

      await logActivitySubmissionEvent({
        submissionId: parsed.data.submission_id,
        activityId: payload.activityId,
        lessonId,
        pupilId: payload.userId,
        fileName: null,
        submittedAt: parsed.data.submitted_at ?? timestamp,
      });

      void emitSubmissionEvent("submission.updated", {
        submissionId: parsed.data.submission_id,
        activityId: payload.activityId,
        pupilId: payload.userId,
        submittedAt: parsed.data.submitted_at ?? timestamp,
        submissionStatus: "inprogress",
        isFlagged: false,
      });

      return { success: true, error: null, data: parsed.data };
    } catch (error) {
      console.error("[submissions] Failed to update matcher submission:", error);
      const message = error instanceof Error
        ? error.message
        : "Unable to update submission.";
      return {
        success: false,
        error: message,
        data: null as Submission | null,
      };
    }
  }

  try {
    const { rows } = await query(
      `
        insert into submissions (activity_id, user_id, body)
        values ($1, $2, $3)
        returning *
      `,
      [payload.activityId, payload.userId, submissionBody],
    );

    const parsed = SubmissionSchema.safeParse(rows?.[0]);
    if (!parsed.success) {
      console.error(
        "[submissions] Failed to parse inserted matcher submission:",
        parsed.error,
      );
      return {
        success: false,
        error: "Invalid submission data.",
        data: null as Submission | null,
      };
    }

    await logActivitySubmissionEvent({
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      lessonId,
      pupilId: payload.userId,
      fileName: null,
      submittedAt: parsed.data.submitted_at ?? timestamp,
    });

    void emitSubmissionEvent("submission.updated", {
      submissionId: parsed.data.submission_id,
      activityId: payload.activityId,
      pupilId: payload.userId,
      submittedAt: parsed.data.submitted_at ?? timestamp,
      submissionStatus: "inprogress",
      isFlagged: false,
    });

    return { success: true, error: null, data: parsed.data };
  } catch (error) {
    console.error("[submissions] Failed to insert matcher submission:", error);
    const message = error instanceof Error
      ? error.message
      : "Unable to insert submission.";
    return {
      success: false,
      error: message,
      data: null as Submission | null,
    };
  }
}
```

- [ ] **Step 4: Re-export from `src/lib/server-updates.ts`**

In `src/lib/server-updates.ts`, add `upsertMatcherSubmissionAction` to the export list from `./server-actions/submissions` (next to `upsertMcqSubmissionAction`, around line 173):

```ts
  upsertMatcherSubmissionAction,
  upsertMcqSubmissionAction,
} from "./server-actions/submissions";
```

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "submissions\|server-updates"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server-actions/submissions.ts src/lib/server-updates.ts
git commit -m "feat(matcher): add upsertMatcherSubmissionAction"
```

---

### Task 8: `PupilMatcherActivity` component

**Files:**
- Create: `src/components/pupil/pupil-matcher-activity.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/pupil/pupil-matcher-activity.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

import type { LessonActivity, MatcherLayoutEntry } from "@/types"
import {
  getMatcherBody,
} from "@/components/lessons/activity-view/utils"
import { upsertMatcherSubmissionAction } from "@/lib/server-updates"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface PupilMatcherActivityProps {
  lessonId: string
  activity: LessonActivity
  pupilId: string
  canAnswer: boolean
  initialLayout: MatcherLayoutEntry[]
  initialAnswers: Record<string, string | null>
  initialIsCorrect: boolean
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function buildLayout(pairIds: string[]): MatcherLayoutEntry[] {
  return pairIds.map((pairId) => ({
    pairId,
    promptSide: Math.random() < 0.5 ? "term" : "definition",
  }))
}

export function PupilMatcherActivity({
  lessonId,
  activity,
  pupilId,
  canAnswer,
  initialLayout,
  initialAnswers,
  initialIsCorrect,
}: PupilMatcherActivityProps) {
  const matcherBody = useMemo(() => getMatcherBody(activity), [activity])
  const pairById = useMemo(
    () => new Map(matcherBody.pairs.map((pair) => [pair.id, pair])),
    [matcherBody.pairs],
  )
  const pairIds = useMemo(() => matcherBody.pairs.map((pair) => pair.id), [matcherBody.pairs])

  const layout = useMemo<MatcherLayoutEntry[]>(() => {
    const hasValidLayout =
      initialLayout.length === pairIds.length &&
      pairIds.every((id) => initialLayout.some((entry) => entry.pairId === id))
    return hasValidLayout ? initialLayout : buildLayout(pairIds)
  }, [initialLayout, pairIds])

  const [answers, setAnswers] = useState<Record<string, string | null>>(() => {
    const next: Record<string, string | null> = {}
    pairIds.forEach((id) => {
      next[id] = initialAnswers[id] ?? null
    })
    return next
  })
  const [isCorrect, setIsCorrect] = useState(initialIsCorrect)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const next: Record<string, string | null> = {}
    pairIds.forEach((id) => {
      next[id] = initialAnswers[id] ?? null
    })
    setAnswers(next)
    setIsCorrect(initialIsCorrect)
  }, [activity.activity_id, initialAnswers, initialIsCorrect, pairIds])

  const optionsBySide = useMemo(() => {
    const terms = shuffle(matcherBody.pairs.map((pair) => ({ id: pair.id, label: pair.term })))
    const definitions = shuffle(matcherBody.pairs.map((pair) => ({ id: pair.id, label: pair.definition })))
    return { term: terms, definition: definitions }
  }, [matcherBody.pairs])

  const handleAnswerChange = useCallback(
    (pairId: string, selectedPairId: string) => {
      if (!canAnswer) return

      const nextAnswers = { ...answers, [pairId]: selectedPairId }
      setAnswers(nextAnswers)

      startTransition(async () => {
        const result = await upsertMatcherSubmissionAction({
          activityId: activity.activity_id,
          userId: pupilId,
          layout,
          answers: nextAnswers,
        })

        if (!result.success) {
          toast.error("Unable to save your answer", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        const body = result.data?.body as { is_correct?: boolean } | null
        setIsCorrect(Boolean(body?.is_correct))
        triggerFeedbackRefresh(lessonId)
      })
    },
    [activity.activity_id, answers, canAnswer, layout, lessonId, pupilId],
  )

  const allAnswered = pairIds.every((id) => Boolean(answers[id]))

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <h4 className="text-lg font-semibold text-foreground">
          {activity.title || "Match the key terms to their definitions"}
        </h4>
        {!canAnswer ? (
          <p className="text-xs text-muted-foreground">
            You can review this activity, but only pupils can select answers.
          </p>
        ) : null}
      </header>

      <ul className="space-y-3">
        {layout.map(({ pairId, promptSide }) => {
          const pair = pairById.get(pairId)
          if (!pair) return null
          const promptText = promptSide === "term" ? pair.term : pair.definition
          const answerSide = promptSide === "term" ? "definition" : "term"
          const options = optionsBySide[answerSide]
          const selected = answers[pairId] ?? ""

          return (
            <li key={pairId} className="space-y-2 rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-medium text-foreground">
                {promptText.trim() || "(missing text)"}
              </p>
              <Select
                value={selected}
                onValueChange={(value) => handleAnswerChange(pairId, value)}
                disabled={!canAnswer || isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Choose a ${answerSide}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label.trim() || "(missing text)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>

      <footer className="flex flex-wrap items-center gap-2 text-xs">
        {isPending ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Saving your answer…
          </span>
        ) : allAnswered ? (
          <Badge
            variant={isCorrect ? "default" : "destructive"}
            className="inline-flex items-center gap-2"
          >
            {isCorrect ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isCorrect ? "All matches correct" : "Some matches are incorrect"}
          </Badge>
        ) : null}
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "pupil-matcher"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/pupil/pupil-matcher-activity.tsx
git commit -m "feat(matcher): add PupilMatcherActivity component"
```

---

### Task 9: Wire `PupilMatcherActivity` into the pupil lesson page

**Files:**
- Modify: `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`

- [ ] **Step 1: Import the new component and schema**

Add to the imports near `PupilMcqActivity` (around line 40):

```ts
import { PupilMatcherActivity } from "@/components/pupil/pupil-matcher-activity"
```

Add `MatcherSubmissionBodySchema` to the `@/types` import block (near `McqSubmissionBodySchema`, around lines 6-12):

```ts
  MatcherSubmissionBodySchema,
```

- [ ] **Step 2: Load matcher submissions**

After the `mcqSelectionMap` block (after line 489), add:

```ts
  const matcherActivities = activities.filter((activity) => activity.type === "matcher")

  const matcherSubmissionEntries = await Promise.all(
    matcherActivities.map(async (activity) => {
      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return {
          activityId: activity.activity_id,
          layout: [] as { pairId: string; promptSide: "term" | "definition" }[],
          answers: {} as Record<string, string | null>,
          isCorrect: false,
        }
      }

      const parsedBody = MatcherSubmissionBodySchema.safeParse(result.data.body)
      if (!parsedBody.success) {
        console.warn("[pupil-lessons] Ignoring malformed matcher submission body", parsedBody.error)
        return {
          activityId: activity.activity_id,
          layout: [] as { pairId: string; promptSide: "term" | "definition" }[],
          answers: {} as Record<string, string | null>,
          isCorrect: false,
        }
      }

      return {
        activityId: activity.activity_id,
        layout: parsedBody.data.layout,
        answers: parsedBody.data.answers,
        isCorrect: parsedBody.data.is_correct,
      }
    }),
  )

  const matcherDataMap = new Map(matcherSubmissionEntries.map((entry) => [entry.activityId, entry]))
```

- [ ] **Step 3: Render `PupilMatcherActivity`**

In the activity list rendering (around line 931, right after the `do-flashcards` branch closes), add a new branch:

```tsx
                      ) : activity.type === "do-flashcards" ? (
                        <PupilDoFlashcardsActivity
                          activity={activity}
                          pupilId={pupilId}
                          initialScore={rawScore ?? null}
                        />
                      ) : activity.type === "matcher" ? (
                        <PupilMatcherActivity
                          lessonId={lesson.lesson_id}
                          activity={activity}
                          pupilId={pupilId}
                          canAnswer={isPupilViewer}
                          initialLayout={matcherDataMap.get(activity.activity_id)?.layout ?? []}
                          initialAnswers={matcherDataMap.get(activity.activity_id)?.answers ?? {}}
                          initialIsCorrect={matcherDataMap.get(activity.activity_id)?.isCorrect ?? false}
                        />
                      ) : activity.type === "feedback" ? (
```

(Adjust so the existing `feedback` branch's leading `) : activity.type === "feedback" ? (` is replaced by the inserted branch followed by the original `feedback` branch — do not duplicate the `feedback` branch.)

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "pupil-lessons"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add "src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx"
git commit -m "feat(matcher): wire PupilMatcherActivity into pupil lesson page"
```

---

### Task 10: End-to-end manual verification

**Files:** none (manual/browser verification only)

- [ ] **Step 1: Create a matcher activity**

In the running dev server, open a lesson's activity manager, create a new activity, select type "Matcher", add 3-4 term/definition pairs, save.

- [ ] **Step 2: Verify edit-mode and present-mode rendering**

On the activities overview page, confirm the new activity shows the pairs list. Open the lesson presentation and confirm the "Reveal answers" toggle highlights all rows green when active.

- [ ] **Step 3: Verify pupil interaction**

As a pupil (or via the pupil lesson page for a test pupil), open the lesson, confirm each row shows either a term or a definition with a dropdown of the opposite values, select answers for every row, and confirm the "All matches correct" / "Some matches are incorrect" badge appears after the last selection.

- [ ] **Step 4: Verify scoring**

In the teacher view (assignment results / submission summary), confirm the matcher activity shows a score of 100% when all matches are correct and 0% if any match is wrong, consistent with `compute_submission_base_score`.

---

## Spec Coverage Checklist

- Table of key terms/definitions, dropdown per row → Tasks 1, 6, 8
- Scorable, all-or-nothing → Tasks 1, 2, 7
- Randomized per-row dropdown side, fixed once per submission → Task 8 (`layout`, generated once and persisted via Task 7)
- Dropdown options = all values from the opposite column, shuffled → Task 8 (`optionsBySide`)
- Reveal answers in present mode (teacher) → Task 5
- Editable sidebar for teachers to add/remove pairs (up to 8, min 2) → Task 6
