# Group Items Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new scorable lesson activity type, "group-items", where a teacher defines 2-4 groups and 2-12 items (each with a correct group), and pupils drag items from a shuffled "item bank" into group boxes; scored as the fraction of items placed in their correct group.

**Architecture:** Follow the matcher activity's conventions throughout: Zod schemas in `src/types/index.ts`, scorable-type registration in `src/dino.config.ts`, `getGroupItemsBody`/`createDefaultGroupItemsBody` helpers in `activity-view/utils.ts`, edit/present rendering branches in `activity-view/index.tsx`, a `group-items` branch in `extractScoreFromSubmission`, an editor section in `lesson-activities-manager.tsx`, an `upsertGroupItemsSubmissionAction` server action mirroring `upsertMatcherSubmissionAction`, and a new `PupilGroupItemsActivity` component using `@dnd-kit/core` wired into the pupil lesson page. Unlike matcher, the pupil page must NOT pass the raw activity (which contains the answer-key `groupId` per item) to the client component — it computes sanitized `groups`/`items` props server-side instead.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zod, PostgreSQL (`pg`), Tailwind, Radix UI (`Select`, `Button`), `@dnd-kit/core` (new dependency).

**Data model decisions (from approved design spec, `docs/superpowers/specs/2026-06-14-group-items-activity-design.md`):**
- Scoring: partial credit. `score = (count of items where placements[item.id] === item.groupId) / items.length`, clamped `[0,1]`. `is_correct = (score === 1)`.
- No new SQL migration needed — `compute_submission_base_score`'s catch-all `else` branch already reads `body->>'score'`, which the submission body populates directly.
- `imageUrl` is `z.string().nullable().optional()` (no `.url()` constraint), matching the existing unused `McqOptionBody.imageUrl` pattern.
- Layout: groups in a row across the top (Option A), item bank strip below. Each group box and the bank are `@dnd-kit` droppable zones; each item is a draggable chip.
- `itemOrder` is generated client-side on first render (shuffle) if no valid saved order exists, then persisted on first save.
- No early correctness reveal to pupils (matches the matcher fix in commit `0936e16`) — footer shows only a saving/saved indicator.

---

### Task 1: Add Zod schemas and register "group-items" as scorable

**Files:**
- Modify: `src/types/index.ts` (insert after `MatcherSubmissionBody` type, line 673, before `PupilActivityFeedbackRowSchema` at line 675)
- Modify: `src/dino.config.ts` (lines 1-12)

- [ ] **Step 1: Add group-items schemas to `src/types/index.ts`**

Insert immediately after line 673 (`export type MatcherSubmissionBody = z.infer<typeof MatcherSubmissionBodySchema>;`) and before line 675 (`export const PupilActivityFeedbackRowSchema = ...`):

```ts
export const GroupItemsGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
});

export const GroupItemsItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200),
  imageUrl: z.string().nullable().optional(),
  groupId: z.string().min(1),
});

export const GroupItemsActivityBodySchema = z
  .object({
    groups: z.array(GroupItemsGroupSchema).min(2).max(4),
    items: z.array(GroupItemsItemSchema).min(2).max(12),
  })
  .passthrough();

export const GroupItemsSubmissionBodySchema = z
  .object({
    itemOrder: z.array(z.string()).default([]),
    placements: z.record(z.string(), z.string().nullable()).default({}),
    score: z.number().min(0).max(1).nullable().default(null),
    is_correct: z.boolean().default(false),
    teacher_override_score: z.number().min(0).max(1).nullable().optional(),
    teacher_feedback: z.string().nullable().optional(),
    success_criteria_scores: z
      .record(z.string(), z.number().min(0).max(1).nullable())
      .default({}),
  })
  .passthrough();

export type GroupItemsGroup = z.infer<typeof GroupItemsGroupSchema>;
export type GroupItemsItem = z.infer<typeof GroupItemsItemSchema>;
export type GroupItemsActivityBody = z.infer<typeof GroupItemsActivityBodySchema>;
export type GroupItemsSubmissionBody = z.infer<typeof GroupItemsSubmissionBodySchema>;
```

- [ ] **Step 2: Register "group-items" as a scorable activity type in `src/dino.config.ts`**

Change the `SCORABLE_ACTIVITY_TYPES` array (currently lines 1-12):

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
  "group-items",
]);
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "types/index\|dino.config"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/dino.config.ts
git commit -m "feat(group-items): add group-items activity schemas and register as scorable"
```

---

### Task 2: Verify SQL scoring fallback handles group-items (no migration needed)

**Files:** none (verification only)

- [ ] **Step 1: Confirm the catch-all branch reads `score`**

`compute_submission_base_score(body jsonb, activity_type text)` in `src/migrations/schema.sql` has a final `else` branch:

```sql
  else
    auto_score := safe_numeric(coalesce(body->>'score', body->>'auto_score'));
  end if;
```

Since `activity_type = 'group-items'` does not match any earlier branch (`multiple-choice-question`/`matcher`, `short-text-question`), it falls into this `else` branch, which reads `body->>'score'` — exactly the field `GroupItemsSubmissionBodySchema` populates. No new migration or `schema.sql` edit is required.

- [ ] **Step 2: Verify against the running dev database**

Run:
```bash
cd /Users/leroysalih/nodejs/planner-004 && set -a && source .env && set +a
psql "$DATABASE_URL" -c "select compute_submission_base_score('{\"score\": 0.75}'::jsonb, 'group-items');"
psql "$DATABASE_URL" -c "select compute_submission_base_score('{\"score\": 0.75, \"teacher_override_score\": 1}'::jsonb, 'group-items');"
```
Expected: first query returns `0.75`, second returns `1` (teacher override takes priority).

- [ ] **Step 3: No commit needed for this task**

This task makes no code changes — proceed directly to Task 3.

---

### Task 3: `getGroupItemsBody` helper and default-body builder

**Files:**
- Modify: `src/components/lessons/activity-view/utils.ts`

- [ ] **Step 1: Add `GroupItemsBody` types and helpers**

Add to `src/components/lessons/activity-view/utils.ts`, immediately after the `getMatcherBody` function ends (after line 265, before `export function getShortTextBody` at line 267):

```ts
export interface GroupItemsGroupBody {
  id: string;
  name: string;
}

export interface GroupItemsItemBody {
  id: string;
  text: string;
  imageUrl: string | null;
  groupId: string;
}

export interface GroupItemsBody {
  groups: GroupItemsGroupBody[];
  items: GroupItemsItemBody[];
}

export function createGroupItemsGroupId(used: Set<string>): string {
  let index = 1;
  let candidate = `group-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `group-${index}`;
  }
  return candidate;
}

export function createGroupItemsItemId(used: Set<string>): string {
  let index = 1;
  let candidate = `item-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `item-${index}`;
  }
  return candidate;
}

export function createDefaultGroupItemsBody(): GroupItemsBody {
  return {
    groups: [
      { id: "group-1", name: "" },
      { id: "group-2", name: "" },
    ],
    items: [
      { id: "item-1", text: "", imageUrl: null, groupId: "group-1" },
      { id: "item-2", text: "", imageUrl: null, groupId: "group-2" },
    ],
  };
}

export function getGroupItemsBody(activity: LessonActivity): GroupItemsBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return createDefaultGroupItemsBody();
  }

  const record = activity.body_data as Record<string, unknown>;
  const rawGroups = Array.isArray(record.groups) ? record.groups : [];
  const rawItems = Array.isArray(record.items) ? record.items : [];

  const usedGroupIds = new Set<string>();
  const groups = rawGroups
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const group = entry as Record<string, unknown>;
      let id = typeof group.id === "string" && group.id.trim() !== "" ? group.id.trim() : "";
      if (!id || usedGroupIds.has(id)) {
        id = createGroupItemsGroupId(usedGroupIds);
      }
      usedGroupIds.add(id);
      const name = typeof group.name === "string" ? group.name : "";
      return { id, name };
    })
    .filter((group): group is GroupItemsGroupBody => group !== null);

  if (groups.length === 0) {
    return createDefaultGroupItemsBody();
  }

  const groupIds = new Set(groups.map((group) => group.id));
  const usedItemIds = new Set<string>();
  const items = rawItems
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      let id = typeof item.id === "string" && item.id.trim() !== "" ? item.id.trim() : "";
      if (!id || usedItemIds.has(id)) {
        id = createGroupItemsItemId(usedItemIds);
      }
      usedItemIds.add(id);
      const text = typeof item.text === "string" ? item.text : "";
      const imageUrl = typeof item.imageUrl === "string" && item.imageUrl.trim() !== ""
        ? item.imageUrl
        : null;
      const rawGroupId = typeof item.groupId === "string" ? item.groupId : "";
      const groupId = groupIds.has(rawGroupId) ? rawGroupId : groups[0].id;
      return { id, text, imageUrl, groupId };
    })
    .filter((item): item is GroupItemsItemBody => item !== null);

  return items.length > 0 ? { groups, items } : createDefaultGroupItemsBody();
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "activity-view/utils"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/lessons/activity-view/utils.ts
git commit -m "feat(group-items): add getGroupItemsBody helper"
```

---

### Task 4: `group-items` branch in `extractScoreFromSubmission`

**Files:**
- Modify: `src/lib/scoring/activity-scores.ts`

- [ ] **Step 1: Import `GroupItemsSubmissionBodySchema`**

Change the import block at the top of `src/lib/scoring/activity-scores.ts` (lines 1-8):

```ts
import {
  LegacyMcqSubmissionBodySchema,
  LongTextSubmissionBodySchema,
  MatcherSubmissionBodySchema,
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
  UploadUrlSubmissionBodySchema,
} from "@/types";
```

to:

```ts
import {
  GroupItemsSubmissionBodySchema,
  LegacyMcqSubmissionBodySchema,
  LongTextSubmissionBodySchema,
  MatcherSubmissionBodySchema,
  McqSubmissionBodySchema,
  ShortTextSubmissionBodySchema,
  UploadUrlSubmissionBodySchema,
} from "@/types";
```

- [ ] **Step 2: Add the `group-items` branch**

Insert a new branch immediately after the `matcher` branch ends (after line 192, the closing `}` of the `if (activityType === "matcher")` block, before `if (activityType === "short-text-question")` at line 194):

```ts
  if (activityType === "group-items") {
    const parsed = GroupItemsSubmissionBodySchema.safeParse(submissionBody);
    if (parsed.success) {
      const override = typeof parsed.data.teacher_override_score === "number"
        ? parsed.data.teacher_override_score
        : null;
      const auto = parsed.data.score ?? 0;
      const successCriteriaScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        existingScores: parsed.data.success_criteria_scores,
        fillValue: override ?? auto,
      });
      const overrideScores = typeof override === "number"
        ? normaliseSuccessCriteriaScores({
          successCriteriaIds,
          fillValue: override,
        })
        : null;
      const autoScores = normaliseSuccessCriteriaScores({
        successCriteriaIds,
        fillValue: auto,
      });
      const feedback = typeof parsed.data.teacher_feedback === "string" &&
          parsed.data.teacher_feedback.trim().length > 0
        ? parsed.data.teacher_feedback.trim()
        : null;
      return {
        autoScore: auto,
        overrideScore: override,
        effectiveScore: override ?? auto,
        autoSuccessCriteriaScores: autoScores,
        overrideSuccessCriteriaScores: overrideScores,
        successCriteriaScores,
        feedback,
        autoFeedback: null,
        question: metadata.question,
        correctAnswer: metadata.correctAnswer,
        pupilAnswer: null,
      };
    }

    const fallbackScores = normaliseSuccessCriteriaScores({
      successCriteriaIds,
      fillValue: 0,
    });

    return {
      autoScore: null,
      overrideScore: null,
      effectiveScore: null,
      autoSuccessCriteriaScores: fallbackScores,
      overrideSuccessCriteriaScores: null,
      successCriteriaScores: fallbackScores,
      question: metadata.question,
      correctAnswer: metadata.correctAnswer,
      pupilAnswer: null,
      feedback: null,
      autoFeedback: null,
    };
  }
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "activity-scores"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scoring/activity-scores.ts
git commit -m "feat(group-items): score group-items submissions in extractScoreFromSubmission"
```

---

### Task 5: Add `@dnd-kit/core` dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install the package**

Run: `cd /Users/leroysalih/nodejs/planner-004 && pnpm add @dnd-kit/core`
Expected: `package.json` gains a `@dnd-kit/core` entry under `dependencies`, `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify the install**

Run: `cd /Users/leroysalih/nodejs/planner-004 && grep "@dnd-kit/core" package.json`
Expected: one line showing the new dependency and version.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(group-items): add @dnd-kit/core dependency"
```

---

### Task 6: Teacher editor UI for group-items (groups + items)

**Files:**
- Modify: `src/components/lessons/lesson-activities-manager.tsx`

- [ ] **Step 1: Add "group-items" to the activity type dropdown**

In `ACTIVITY_TYPES` (lines 74-93), add a new entry right after the `matcher` entry (line 90):

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
  { value: "group-items", label: "Group Items" },
  { value: "short-text-question", label: "Short text question" },
  { value: "feedback", label: "Feedback" },
  { value: "text-question", label: "Text question" },
  { value: "voice", label: "Voice recording" },
  { value: "sketch-render", label: "Render Sketch" },
  { value: "share-my-work", label: "Share my work" },
  { value: "review-others' work", label: "Review others' work" },
] as const
```

Note: only the `matcher`/`group-items` lines actually change — leave every other entry exactly as it is (the `review-others' work` line above is a typo illustration; in the real file it reads `{ value: "review-others-work", label: "Review others' work" }` — do not change it).

- [ ] **Step 2: Import group-items helpers and types**

Change the `@/components/lessons/activity-view/utils` import block (lines 35-54) from:

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

to:

```ts
import {
  getImageBody,
  computeSectionIndexMap,
  getFeedbackBody,
  getDisplaySectionBody,
  getGroupItemsBody,
  getMatcherBody,
  getMcqBody,
  getShortTextBody,
  getVoiceBody,
  getYouTubeThumbnailUrl,
  isAbsoluteUrl,
  createDefaultGroupItemsBody,
  createDefaultMatcherBody,
  createGroupItemsGroupId,
  createGroupItemsItemId,
  createMatcherPairId,
  type GroupItemsBody,
  type ImageBody,
  type MatcherBody,
  type McqBody,
  type ShortTextBody,
  type VoiceBody,
} from "@/components/lessons/activity-view/utils"
```

- [ ] **Step 3: Add `groupItemsBody` state**

Immediately after the `matcherBody` state declaration (line 1826):

```ts
  const [matcherBody, setMatcherBody] = useState<MatcherBody>(() => createDefaultMatcherBody())
  const [groupItemsBody, setGroupItemsBody] = useState<GroupItemsBody>(() => createDefaultGroupItemsBody())
```

- [ ] **Step 4: Add normalize/validate/prepare functions**

Add these functions at the very end of the file, after `prepareMatcherBodyForSave` (after line 4468, the closing `}` of that function):

```ts

function normalizeGroupItemsBody(body: GroupItemsBody): GroupItemsBody {
  const usedGroupIds = new Set<string>()
  let groups = (body.groups ?? []).slice(0, 4).map((group) => {
    let id = typeof group.id === "string" && group.id.trim().length > 0 ? group.id.trim() : ""
    if (!id || usedGroupIds.has(id)) {
      id = createGroupItemsGroupId(usedGroupIds)
    }
    usedGroupIds.add(id)
    return { id, name: typeof group.name === "string" ? group.name : "" }
  })

  if (groups.length === 0) {
    return createDefaultGroupItemsBody()
  }

  while (groups.length < 2) {
    const id = createGroupItemsGroupId(usedGroupIds)
    usedGroupIds.add(id)
    groups.push({ id, name: "" })
  }

  const groupIds = new Set(groups.map((group) => group.id))
  const usedItemIds = new Set<string>()
  let items = (body.items ?? []).slice(0, 12).map((item) => {
    let id = typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : ""
    if (!id || usedItemIds.has(id)) {
      id = createGroupItemsItemId(usedItemIds)
    }
    usedItemIds.add(id)
    const text = typeof item.text === "string" ? item.text : ""
    const imageUrl = typeof item.imageUrl === "string" && item.imageUrl.trim().length > 0
      ? item.imageUrl
      : null
    const groupId = groupIds.has(item.groupId) ? item.groupId : groups[0].id
    return { id, text, imageUrl, groupId }
  })

  while (items.length < 2) {
    const id = createGroupItemsItemId(usedItemIds)
    usedItemIds.add(id)
    items.push({ id, text: "", imageUrl: null, groupId: groups[0].id })
  }

  return { groups, items }
}

function validateGroupItemsBody(body: GroupItemsBody): string | null {
  const normalized = normalizeGroupItemsBody(body)

  if (normalized.groups.length < 2) {
    return "Add at least two groups."
  }

  const emptyGroupName = normalized.groups.some((group) => group.name.trim().length === 0)
  if (emptyGroupName) {
    return "Every group needs a name."
  }

  if (normalized.items.length < 2) {
    return "Add at least two items."
  }

  const groupIds = new Set(normalized.groups.map((group) => group.id))
  const invalidItem = normalized.items.some(
    (item) => item.text.trim().length === 0 || !groupIds.has(item.groupId),
  )
  if (invalidItem) {
    return "Every item needs text and a correct group."
  }

  return null
}

function prepareGroupItemsBodyForSave(body: GroupItemsBody): { bodyData: GroupItemsBody; error: string | null } {
  const normalized = normalizeGroupItemsBody(body)
  const validation = validateGroupItemsBody(normalized)
  if (validation) {
    return { bodyData: normalized, error: validation }
  }
  return { bodyData: normalized, error: null }
}
```

- [ ] **Step 5: Add group-items change handlers**

Add these handlers immediately after the matcher handlers block ends (after line 2013, the closing `}, [updateMatcherBody])` of `handleMatcherRemovePair`):

```ts

  const groupItemsValidationMessage = useMemo(() => validateGroupItemsBody(groupItemsBody), [groupItemsBody])

  const updateGroupItemsBody = useCallback((updater: (current: GroupItemsBody) => GroupItemsBody) => {
    setGroupItemsBody((previous) => normalizeGroupItemsBody(updater(normalizeGroupItemsBody(previous))))
  }, [])

  const handleGroupItemsGroupNameChange = useCallback((groupId: string, value: string) => {
    updateGroupItemsBody((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.id === groupId ? { ...group, name: value } : group)),
    }))
  }, [updateGroupItemsBody])

  const handleGroupItemsAddGroup = useCallback(() => {
    updateGroupItemsBody((current) => {
      if (current.groups.length >= 4) {
        toast.error("You can add up to 4 groups.")
        return current
      }
      const used = new Set(current.groups.map((group) => group.id))
      const id = createGroupItemsGroupId(used)
      return { ...current, groups: [...current.groups, { id, name: "" }] }
    })
  }, [updateGroupItemsBody])

  const handleGroupItemsRemoveGroup = useCallback((groupId: string) => {
    updateGroupItemsBody((current) => {
      if (current.groups.length <= 2) {
        toast.error("Keep at least 2 groups.")
        return current
      }
      const groups = current.groups.filter((group) => group.id !== groupId)
      const fallbackGroupId = groups[0].id
      const items = current.items.map((item) =>
        item.groupId === groupId ? { ...item, groupId: fallbackGroupId } : item,
      )
      return { groups, items }
    })
  }, [updateGroupItemsBody])

  const handleGroupItemsItemTextChange = useCallback((itemId: string, value: string) => {
    updateGroupItemsBody((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, text: value } : item)),
    }))
  }, [updateGroupItemsBody])

  const handleGroupItemsItemImageUrlChange = useCallback((itemId: string, value: string) => {
    updateGroupItemsBody((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? { ...item, imageUrl: value.trim().length > 0 ? value : null } : item,
      ),
    }))
  }, [updateGroupItemsBody])

  const handleGroupItemsItemGroupChange = useCallback((itemId: string, groupId: string) => {
    updateGroupItemsBody((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, groupId } : item)),
    }))
  }, [updateGroupItemsBody])

  const handleGroupItemsAddItem = useCallback(() => {
    updateGroupItemsBody((current) => {
      if (current.items.length >= 12) {
        toast.error("You can add up to 12 items.")
        return current
      }
      const used = new Set(current.items.map((item) => item.id))
      const id = createGroupItemsItemId(used)
      return {
        ...current,
        items: [...current.items, { id, text: "", imageUrl: null, groupId: current.groups[0].id }],
      }
    })
  }, [updateGroupItemsBody])

  const handleGroupItemsRemoveItem = useCallback((itemId: string) => {
    updateGroupItemsBody((current) => {
      if (current.items.length <= 2) {
        toast.error("Keep at least 2 items.")
        return current
      }
      return { ...current, items: current.items.filter((item) => item.id !== itemId) }
    })
  }, [updateGroupItemsBody])
```

- [ ] **Step 6: Initialize/reset `groupItemsBody` alongside `matcherBody`**

There are four places `matcherBody` is reset based on activity type — mirror each with `groupItemsBody`.

a) Create-mode reset block (line 2524), change:

```ts
      setMcqBody(createDefaultMcqBody())
      setMatcherBody(createDefaultMatcherBody())
      setShortTextBody(createDefaultShortTextBody())
```

to:

```ts
      setMcqBody(createDefaultMcqBody())
      setMatcherBody(createDefaultMatcherBody())
      setGroupItemsBody(createDefaultGroupItemsBody())
      setShortTextBody(createDefaultShortTextBody())
```

b) Edit-mode load block (lines 2571-2575), change:

```ts
      if (ensuredType === "matcher") {
        setMatcherBody(normalizeMatcherBody(getMatcherBody(activity)))
      } else {
        setMatcherBody(createDefaultMatcherBody())
      }
```

to:

```ts
      if (ensuredType === "matcher") {
        setMatcherBody(normalizeMatcherBody(getMatcherBody(activity)))
      } else {
        setMatcherBody(createDefaultMatcherBody())
      }
      if (ensuredType === "group-items") {
        setGroupItemsBody(normalizeGroupItemsBody(getGroupItemsBody(activity)))
      } else {
        setGroupItemsBody(createDefaultGroupItemsBody())
      }
```

c) Sheet-close reset block (line 2636), change:

```ts
      setMcqBody(createDefaultMcqBody())
      setMatcherBody(createDefaultMatcherBody())
      setShortTextBody(createDefaultShortTextBody())
```

to:

```ts
      setMcqBody(createDefaultMcqBody())
      setMatcherBody(createDefaultMatcherBody())
      setGroupItemsBody(createDefaultGroupItemsBody())
      setShortTextBody(createDefaultShortTextBody())
```

d) Type-change effect (lines 2877-2884), add a new block right after the `matcher` block:

```ts
    if (type === "matcher") {
      if (activity) {
        setMatcherBody(normalizeMatcherBody(getMatcherBody(activity)))
      } else {
        setMatcherBody(createDefaultMatcherBody())
      }
      return
    }

    if (type === "group-items") {
      if (activity) {
        setGroupItemsBody(normalizeGroupItemsBody(getGroupItemsBody(activity)))
      } else {
        setGroupItemsBody(createDefaultGroupItemsBody())
      }
      return
    }
```

- [ ] **Step 7: Hook group-items into the save handler**

In the save handler's type branching (around line 3286), add a new branch right after the `matcher` branch:

```ts
    } else if (type === "matcher") {
      const { bodyData: preparedMatcherBody, error } = prepareMatcherBodyForSave(matcherBody)
      if (error) {
        toast.error(error)
        return
      }
      bodyData = preparedMatcherBody
    } else if (type === "group-items") {
      const { bodyData: preparedGroupItemsBody, error } = prepareGroupItemsBodyForSave(groupItemsBody)
      if (error) {
        toast.error(error)
        return
      }
      bodyData = preparedGroupItemsBody
    } else if (type === "short-text-question") {
```

- [ ] **Step 8: Disable save when group-items is invalid**

In `disableSave` (around line 3376-3382), add the group-items check:

```ts
  const disableSave =
    isPending ||
    isProcessing ||
    isRecording ||
    (type !== "voice" && rawBodyError !== null) ||
    (type === "multiple-choice-question" && mcqValidationMessage !== null) ||
    (type === "matcher" && matcherValidationMessage !== null) ||
    (type === "group-items" && groupItemsValidationMessage !== null) ||
    (type === "short-text-question" && shortTextValidationMessage !== null)
```

- [ ] **Step 9: Add the group-items editor form**

In the JSX, add a new block right after the matcher editor block closes (after line 3772, `) : null}`, before the `short-text-question` block at line 3774):

```tsx
          {type === "group-items" ? (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-4">
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground">Groups</Label>
                <div className="space-y-2">
                  {groupItemsBody.groups.map((group, index) => (
                    <div key={group.id} className="flex items-center gap-2">
                      <Input
                        value={group.name}
                        onChange={(event) => handleGroupItemsGroupNameChange(group.id, event.target.value)}
                        placeholder={`Group ${index + 1} name`}
                        disabled={isPending}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleGroupItemsRemoveGroup(group.id)}
                        disabled={isPending || groupItemsBody.groups.length <= 2}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGroupItemsAddGroup}
                  disabled={isPending || groupItemsBody.groups.length >= 4}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add group
                </Button>
              </div>

              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground">Items</Label>
                <div className="space-y-3">
                  {groupItemsBody.items.map((item, index) => (
                    <div key={item.id} className="space-y-2 rounded-md border border-border bg-background p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Item {index + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleGroupItemsRemoveItem(item.id)}
                          disabled={isPending || groupItemsBody.items.length <= 2}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground" htmlFor={`group-items-text-${item.id}`}>
                          Text
                        </Label>
                        <Input
                          id={`group-items-text-${item.id}`}
                          value={item.text}
                          onChange={(event) => handleGroupItemsItemTextChange(item.id, event.target.value)}
                          placeholder="Item text"
                          disabled={isPending}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground" htmlFor={`group-items-image-${item.id}`}>
                          Image URL (optional)
                        </Label>
                        <Input
                          id={`group-items-image-${item.id}`}
                          value={item.imageUrl ?? ""}
                          onChange={(event) => handleGroupItemsItemImageUrlChange(item.id, event.target.value)}
                          placeholder="https://example.com/image.png"
                          disabled={isPending}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground" htmlFor={`group-items-group-${item.id}`}>
                          Correct group
                        </Label>
                        <Select
                          value={item.groupId}
                          onValueChange={(value) => handleGroupItemsItemGroupChange(item.id, value)}
                          disabled={isPending}
                        >
                          <SelectTrigger id={`group-items-group-${item.id}`} className="w-full">
                            <SelectValue placeholder="Choose a group" />
                          </SelectTrigger>
                          <SelectContent>
                            {groupItemsBody.groups.map((group, groupIndex) => (
                              <SelectItem key={group.id} value={group.id}>
                                {group.name.trim() || `Group ${groupIndex + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGroupItemsAddItem}
                  disabled={isPending || groupItemsBody.items.length >= 12}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add item
                </Button>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Add 2-4 groups and 2-12 items. Every group needs a name and every item needs text and a correct group.</p>
                {groupItemsValidationMessage ? (
                  <p className="text-destructive">{groupItemsValidationMessage}</p>
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
git commit -m "feat(group-items): add teacher editor UI for groups and items"
```

---

### Task 7: Activity view wiring (edit summary + teacher present view)

**Files:**
- Modify: `src/components/lessons/activity-view/index.tsx`

- [ ] **Step 1: Import `getGroupItemsBody`**

Add `getGroupItemsBody` to the existing import from `@/components/lessons/activity-view/utils` (around line 24, alphabetically near `getFlashcardsText`/`getMatcherBody`):

```ts
import {
  getActivityFileUrlValue,
  getActivityTextValue,
  getDisplaySectionBody,
  getFeedbackBody,
  getImageBody,
  getFlashcardsText,
  getGroupItemsBody,
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

- [ ] **Step 2: Add a `GroupItemsPresentView` component**

Add this new component immediately after `MatcherPresentView` ends (after line 930, the closing `}` and blank line before `function ActivityPresentView` / whatever follows):

```tsx
function GroupItemsPresentView({ activity }: { activity: LessonActivity }) {
  const groupItems = getGroupItemsBody(activity)

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold text-foreground">
        {activity.title?.trim() || "Group the items"}
      </h3>
      <p className="text-sm text-muted-foreground">
        Pupils drag each item into the group they think it belongs to. This preview shows the correct groupings.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groupItems.groups.map((group, index) => (
          <div key={group.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
            <p className="text-sm font-semibold text-foreground">
              {group.name.trim() || `Group ${index + 1}`}
            </p>
            <ul className="space-y-1">
              {groupItems.items
                .filter((item) => item.groupId === group.id)
                .map((item) => (
                  <li
                    key={item.id}
                    className="rounded-md border border-border/60 bg-muted/30 p-2 text-sm text-foreground"
                  >
                    {item.text.trim() || "(missing text)"}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the group-items type into `ActivityPresentView`**

In `ActivityPresentView`, add a new branch right after the `matcher` branch (after line 1239, before the `sketch-render` branch at line 1241):

```tsx
  if (activity.type === "matcher") {
    return wrap(
      <MatcherPresentView
        activity={activity}
        canReveal={previewMode ? false : viewerCanReveal}
      />
    )
  }

  if (activity.type === "group-items") {
    return wrap(<GroupItemsPresentView activity={activity} />)
  }
```

- [ ] **Step 4: Add the group-items branch to `ActivityEditView`**

In `ActivityEditView`, add a new branch right after the `matcher` branch ends (after line 1427, before the `short-text-question` branch at line 1429):

```tsx
  if (activity.type === "group-items") {
    const groupItems = getGroupItemsBody(activity)

    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Groups &amp; items
        </p>
        <ul className="space-y-2">
          {groupItems.groups.map((group, index) => (
            <li key={group.id} className="rounded-md border border-border/60 bg-muted/30 p-2">
              <p className="font-medium text-foreground">
                {group.name.trim() || `Group ${index + 1}`}
              </p>
              <ul className="mt-1 space-y-1 pl-3 text-xs text-muted-foreground">
                {groupItems.items
                  .filter((item) => item.groupId === group.id)
                  .map((item) => (
                    <li key={item.id}>{item.text.trim() || "(missing text)"}</li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    )
  }
```

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "activity-view"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/lessons/activity-view/index.tsx
git commit -m "feat(group-items): wire group-items into activity edit and present views"
```

---

### Task 8: `upsertGroupItemsSubmissionAction` server action

**Files:**
- Modify: `src/lib/server-actions/submissions.ts`
- Modify: `src/lib/server-updates.ts`

- [ ] **Step 1: Import group-items schemas**

In `src/lib/server-actions/submissions.ts`, add to the existing import from `@/types` (near `MatcherActivityBodySchema`, `MatcherSubmissionBodySchema`, lines 7-8):

```ts
import {
  GroupItemsActivityBodySchema,
  GroupItemsSubmissionBodySchema,
  MatcherActivityBodySchema,
  MatcherSubmissionBodySchema,
  ...
```

(Insert `GroupItemsActivityBodySchema,` and `GroupItemsSubmissionBodySchema,` as the first two entries of this import block, before `MatcherActivityBodySchema`, preserving every other existing import.)

- [ ] **Step 2: Add `GroupItemsSubmissionInputSchema`**

Add near `MatcherSubmissionInputSchema` (after line 46, its closing `});`):

```ts
const GroupItemsSubmissionInputSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1),
  itemOrder: z.array(z.string()).min(1),
  placements: z.record(z.string(), z.string().nullable()),
});
```

- [ ] **Step 3: Add `upsertGroupItemsSubmissionAction`**

Add this function right after `upsertMatcherSubmissionAction` ends (after line 1094, the closing `}` of that function, before `export async function readSubmissionByIdAction` at line 1096):

```ts
export async function upsertGroupItemsSubmissionAction(
  input: z.infer<typeof GroupItemsSubmissionInputSchema>,
) {
  const payload = GroupItemsSubmissionInputSchema.parse(input);
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
      "[submissions] Failed to load activity for group-items submission:",
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

  const parsedActivity = GroupItemsActivityBodySchema.safeParse(activity.body_data);
  if (!parsedActivity.success) {
    console.error(
      "[submissions] Invalid group-items activity body:",
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

  const groupItemsBody = parsedActivity.data;
  const itemIds = new Set(groupItemsBody.items.map((item) => item.id));
  const groupIds = new Set(groupItemsBody.groups.map((group) => group.id));

  const itemOrderCoversAllItems =
    payload.itemOrder.length === groupItemsBody.items.length &&
    groupItemsBody.items.every((item) =>
      payload.itemOrder.filter((id) => id === item.id).length === 1,
    );
  if (!itemOrderCoversAllItems) {
    return {
      success: false,
      error: "Activity layout is no longer valid for this submission.",
      data: null as Submission | null,
    };
  }

  const sanitizedPlacements: Record<string, string | null> = {};
  for (const item of groupItemsBody.items) {
    const placement = payload.placements[item.id];
    sanitizedPlacements[item.id] =
      typeof placement === "string" && groupIds.has(placement) ? placement : null;
  }

  const correctCount = groupItemsBody.items.filter(
    (item) => sanitizedPlacements[item.id] === item.groupId,
  ).length;
  const score = groupItemsBody.items.length > 0
    ? correctCount / groupItemsBody.items.length
    : 0;
  const isCorrect = score === 1;

  const successCriteriaIds = await fetchActivitySuccessCriteriaIds(
    payload.activityId,
  );
  const successCriteriaScores = normaliseSuccessCriteriaScores({
    successCriteriaIds,
    fillValue: score,
  });

  const submissionBody = GroupItemsSubmissionBodySchema.parse({
    itemOrder: payload.itemOrder,
    placements: sanitizedPlacements,
    score,
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
      "[submissions] Failed to check existing group-items submission:",
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
          "[submissions] Failed to parse updated group-items submission:",
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
      console.error("[submissions] Failed to update group-items submission:", error);
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
        "[submissions] Failed to parse inserted group-items submission:",
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
    console.error("[submissions] Failed to insert group-items submission:", error);
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

In `src/lib/server-updates.ts`, the submissions export block currently reads (lines 169-175):

```ts
export {
  getLatestSubmissionForActivityAction,
  readLessonSubmissionSummariesAction,
  readSubmissionByIdAction,
  upsertMatcherSubmissionAction,
  upsertMcqSubmissionAction,
} from "./server-actions/submissions";
```

Change it to:

```ts
export {
  getLatestSubmissionForActivityAction,
  readLessonSubmissionSummariesAction,
  readSubmissionByIdAction,
  upsertGroupItemsSubmissionAction,
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
git commit -m "feat(group-items): add upsertGroupItemsSubmissionAction"
```

---

### Task 9: `PupilGroupItemsActivity` component (drag-and-drop)

**Files:**
- Create: `src/components/pupil/pupil-group-items-activity.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/pupil/pupil-group-items-activity.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"

import { upsertGroupItemsSubmissionAction } from "@/lib/server-updates"
import { cn } from "@/lib/utils"
import { triggerFeedbackRefresh } from "@/lib/feedback-events"

interface GroupItemsGroupOption {
  id: string
  name: string
}

interface GroupItemsItemOption {
  id: string
  text: string
  imageUrl: string | null
}

interface PupilGroupItemsActivityProps {
  lessonId: string
  activityId: string
  title: string | null
  pupilId: string
  canAnswer: boolean
  groups: GroupItemsGroupOption[]
  items: GroupItemsItemOption[]
  initialItemOrder: string[]
  initialPlacements: Record<string, string | null>
}

const BANK_ID = "bank"

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function ItemChipContent({ item }: { item: GroupItemsItemOption }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
      ) : null}
      <span>{item.text}</span>
    </div>
  )
}

function ItemChip({
  item,
  canAnswer,
}: {
  item: GroupItemsItemOption
  canAnswer: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    disabled: !canAnswer,
  })

  return (
    <div
      ref={setNodeRef}
      {...(canAnswer ? listeners : {})}
      {...(canAnswer ? attributes : {})}
      className={cn(
        canAnswer ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default",
        isDragging && "opacity-30",
      )}
    >
      <ItemChipContent item={item} />
    </div>
  )
}

function DropZone({
  id,
  label,
  itemIds,
  itemsById,
  canAnswer,
}: {
  id: string
  label: string
  itemIds: string[]
  itemsById: Map<string, GroupItemsItemOption>
  canAnswer: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[100px] flex-1 space-y-2 rounded-lg border-2 border-dashed border-border bg-muted/20 p-3",
        isOver && "border-primary bg-primary/10",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {itemIds.map((itemId) => {
          const item = itemsById.get(itemId)
          if (!item) return null
          return <ItemChip key={itemId} item={item} canAnswer={canAnswer} />
        })}
      </div>
    </div>
  )
}

export function PupilGroupItemsActivity({
  lessonId,
  activityId,
  title,
  pupilId,
  canAnswer,
  groups,
  items,
  initialItemOrder,
  initialPlacements,
}: PupilGroupItemsActivityProps) {
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const itemIds = useMemo(() => items.map((item) => item.id), [items])

  const itemOrder = useMemo(() => {
    const hasValidOrder =
      initialItemOrder.length === itemIds.length &&
      itemIds.every((id) => initialItemOrder.includes(id))
    return hasValidOrder ? initialItemOrder : shuffle(itemIds)
  }, [initialItemOrder, itemIds])

  const [placements, setPlacements] = useState<Record<string, string | null>>(() => {
    const next: Record<string, string | null> = {}
    itemIds.forEach((id) => {
      next[id] = initialPlacements[id] ?? null
    })
    return next
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [hasSaved, setHasSaved] = useState(false)

  useEffect(() => {
    const next: Record<string, string | null> = {}
    itemIds.forEach((id) => {
      next[id] = initialPlacements[id] ?? null
    })
    setPlacements(next)
  }, [activityId, initialPlacements, itemIds])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const groupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null)
      if (!canAnswer) return

      const { active, over } = event
      if (!over) return

      const itemId = String(active.id)
      const targetId = String(over.id)
      const nextGroupId = targetId !== BANK_ID && groupIds.has(targetId) ? targetId : null

      if (placements[itemId] === nextGroupId) return

      const nextPlacements = { ...placements, [itemId]: nextGroupId }
      setPlacements(nextPlacements)

      startTransition(async () => {
        const result = await upsertGroupItemsSubmissionAction({
          activityId,
          userId: pupilId,
          itemOrder,
          placements: nextPlacements,
        })

        if (!result.success) {
          toast.error("Unable to save your answer", {
            description: result.error ?? "Please try again later.",
          })
          return
        }

        setHasSaved(true)
        triggerFeedbackRefresh(lessonId)
      })
    },
    [activityId, canAnswer, groupIds, itemOrder, lessonId, placements, pupilId],
  )

  const bankItemIds = itemOrder.filter((id) => !placements[id])
  const activeItem = activeId ? itemsById.get(activeId) ?? null : null

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-col gap-2">
        <h4 className="text-lg font-semibold text-foreground">
          {title || "Drag each item into the correct group"}
        </h4>
        {!canAnswer ? (
          <p className="text-xs text-muted-foreground">
            You can review this activity, but only pupils can move items.
          </p>
        ) : null}
      </header>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-col gap-3 sm:flex-row">
          {groups.map((group) => (
            <DropZone
              key={group.id}
              id={group.id}
              label={group.name}
              itemIds={itemOrder.filter((id) => placements[id] === group.id)}
              itemsById={itemsById}
              canAnswer={canAnswer}
            />
          ))}
        </div>

        <DropZone
          id={BANK_ID}
          label="Item bank"
          itemIds={bankItemIds}
          itemsById={itemsById}
          canAnswer={canAnswer}
        />

        <DragOverlay>
          {activeItem ? <ItemChipContent item={activeItem} /> : null}
        </DragOverlay>
      </DndContext>

      <footer className="flex flex-wrap items-center gap-2 text-xs">
        {isPending ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Saving…
          </span>
        ) : hasSaved ? (
          <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">Saved</span>
        ) : null}
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "pupil-group-items"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/pupil/pupil-group-items-activity.tsx
git commit -m "feat(group-items): add PupilGroupItemsActivity component"
```

---

### Task 10: Wire `PupilGroupItemsActivity` into the pupil lesson page (with answer-key stripping)

**Files:**
- Modify: `src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx`

- [ ] **Step 1: Import the new component and schemas**

Add to the imports near `PupilMatcherActivity` (line 41):

```ts
import { PupilMatcherActivity } from "@/components/pupil/pupil-matcher-activity"
import { PupilGroupItemsActivity } from "@/components/pupil/pupil-group-items-activity"
```

Add `GroupItemsActivityBodySchema` and `GroupItemsSubmissionBodySchema` to the `@/types` import block (near `MatcherSubmissionBodySchema`, line 55):

```ts
  GroupItemsActivityBodySchema,
  GroupItemsSubmissionBodySchema,
  MatcherSubmissionBodySchema,
```

- [ ] **Step 2: Load group-items activities, sanitize answer keys, and load submissions**

After the `matcherDataMap` block (after line 524), add:

```ts
  const groupItemsActivities = activities.filter((activity) => activity.type === "group-items")

  const groupItemsSubmissionEntries = await Promise.all(
    groupItemsActivities.map(async (activity) => {
      const parsedActivityBody = GroupItemsActivityBodySchema.safeParse(activity.body_data)
      const groups = parsedActivityBody.success
        ? parsedActivityBody.data.groups.map((group) => ({ id: group.id, name: group.name }))
        : []
      const items = parsedActivityBody.success
        ? parsedActivityBody.data.items.map((item) => ({
            id: item.id,
            text: item.text,
            imageUrl: item.imageUrl ?? null,
          }))
        : []

      const result = await getLatestSubmissionForActivityAction(activity.activity_id, pupilId)
      if (result.error || !result.data) {
        return {
          activityId: activity.activity_id,
          groups,
          items,
          itemOrder: [] as string[],
          placements: {} as Record<string, string | null>,
        }
      }

      const parsedBody = GroupItemsSubmissionBodySchema.safeParse(result.data.body)
      if (!parsedBody.success) {
        console.warn("[pupil-lessons] Ignoring malformed group-items submission body", parsedBody.error)
        return {
          activityId: activity.activity_id,
          groups,
          items,
          itemOrder: [] as string[],
          placements: {} as Record<string, string | null>,
        }
      }

      return {
        activityId: activity.activity_id,
        groups,
        items,
        itemOrder: parsedBody.data.itemOrder,
        placements: parsedBody.data.placements,
      }
    }),
  )

  const groupItemsDataMap = new Map(groupItemsSubmissionEntries.map((entry) => [entry.activityId, entry]))
```

This computes `groups`/`items` from `GroupItemsActivityBodySchema` but only forwards `id`/`name` (groups) and `id`/`text`/`imageUrl` (items) — the answer-key field `item.groupId` is never included in `groupItemsDataMap`, so it cannot leak into the client component's RSC payload.

- [ ] **Step 3: Render `PupilGroupItemsActivity`**

In the activity list rendering, add a new branch right after the `matcher` branch closes (after line 980, before `) : activity.type === "feedback" ? (` at line 981):

```tsx
                      ) : activity.type === "matcher" ? (
                        <PupilMatcherActivity
                          lessonId={lesson.lesson_id}
                          activity={activity}
                          pupilId={pupilId}
                          canAnswer={isPupilViewer}
                          initialLayout={matcherDataMap.get(activity.activity_id)?.layout ?? []}
                          initialAnswers={matcherDataMap.get(activity.activity_id)?.answers ?? {}}
                        />
                      ) : activity.type === "group-items" ? (
                        <PupilGroupItemsActivity
                          lessonId={lesson.lesson_id}
                          activityId={activity.activity_id}
                          title={activity.title}
                          pupilId={pupilId}
                          canAnswer={isPupilViewer}
                          groups={groupItemsDataMap.get(activity.activity_id)?.groups ?? []}
                          items={groupItemsDataMap.get(activity.activity_id)?.items ?? []}
                          initialItemOrder={groupItemsDataMap.get(activity.activity_id)?.itemOrder ?? []}
                          initialPlacements={groupItemsDataMap.get(activity.activity_id)?.placements ?? {}}
                        />
                      ) : activity.type === "feedback" ? (
```

(Only the `matcher` branch's opening line and the new `group-items` branch are added — the existing `matcher` branch body and the `feedback` branch that follows are unchanged.)

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/leroysalih/nodejs/planner-004 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "pupil-lessons"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add "src/app/pupil-lessons/[pupilId]/lessons/[lessonId]/page.tsx"
git commit -m "feat(group-items): wire PupilGroupItemsActivity into pupil lesson page"
```

---

### Task 11: End-to-end manual verification

**Files:** none (manual/browser verification only)

- [ ] **Step 1: Create a group-items activity**

In the running dev server, open a lesson's activity manager, create a new activity, select type "Group Items", add 2-4 groups with names and 2-12 items (give at least one item an Image URL), assign each item's correct group, save.

- [ ] **Step 2: Verify edit-mode and present-mode rendering**

On the activities overview page, confirm the new activity shows the groups with their assigned items as text. Open the lesson presentation and confirm `GroupItemsPresentView` shows each group with its correct items (answer key visible to the teacher).

- [ ] **Step 3: Verify pupil drag-and-drop interaction**

As a pupil (or via the pupil lesson page for a test pupil), open the lesson and confirm:
- All items appear in the "Item bank" strip in a shuffled order on first load.
- Dragging an item into a group box moves it there (works with mouse; if testing on a touch device/emulator, confirm touch dragging works too).
- Dragging an item back to the item bank, or to a different group, moves it accordingly.
- No correctness feedback (colors, score) is shown to the pupil at any point — only a "Saving…"/"Saved" indicator in the footer.
- Reload the page and confirm placements and item order persist.

- [ ] **Step 4: Verify scoring**

In the teacher view (assignment results / submission summary), confirm the group-items activity shows a percentage score equal to `(correctly placed items) / (total items)`, consistent with `compute_submission_base_score`'s catch-all `score` fallback (verified in Task 2).

---

## Spec Coverage Checklist

- Teacher defines 2-4 groups and 2-12 items, each item assigned a correct group → Tasks 1, 6
- Pupils see groups as boxes in a row, items shuffled in an item bank below (Option A layout) → Task 9
- Drag items into groups, back to bank, or between groups (mouse + touch via `@dnd-kit/core` `PointerSensor`) → Tasks 5, 9
- Scorable, partial credit = correct placements / total items → Tasks 1, 2, 4, 8
- `itemOrder` shuffled once client-side, persisted on first save → Task 9 (`upsertGroupItemsSubmissionAction` called on every drop)
- Optional `imageUrl` per item, rendered as a small thumbnail → Tasks 1, 3, 6, 9
- No early correctness reveal to pupils → Task 9 (footer shows only saving/saved state)
- Read-only mode when `canAnswer = false` → Task 9 (`useDraggable({ disabled: !canAnswer })`)
- Teacher present view shows groups + correct items (answer key) → Tasks 3, 7
- Activity type registered in dropdown and as scorable → Tasks 1, 6
- Answer key (`item.groupId`) never sent to pupil-facing client component → Task 10
