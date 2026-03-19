# Mobile Unit Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-only unit `<select>` dropdown below the subject dropdown on `/pupil-lessons/[pupilId]`, and remove "All Subjects" from the subject dropdown so a subject is always selected.

**Architecture:** All changes are confined to a single client component file. The subject dropdown loses its "All Subjects" option and always shows the first subject on load. A new native `<select>` rendered below it (hidden at `md:` breakpoint) mirrors the desktop sidebar's unit selection for mobile users. State resets are handled inline in the subject `onChange` handler using direct `detail.subjects` lookups (since memos haven't re-run at handler time).

**Tech Stack:** React 19, Next.js 15 App Router, Tailwind CSS v4, Playwright (E2E tests)

---

## Files

- Modify: `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx`
- Create: `tests/navigation/pupil-units-mobile.spec.ts`

---

### Task 1: Write the failing Playwright test

**Files:**
- Create: `tests/navigation/pupil-units-mobile.spec.ts`

- [ ] **Step 1: Create the test file**

```ts
import { expect, test } from "@playwright/test"

test.describe("pupil units page — mobile unit dropdown", () => {
  test.beforeEach(async ({ page }) => {
    // Use a mobile viewport so md:hidden elements are visible and md:block elements are hidden
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto("/")
    await page.getByRole("link", { name: "Sign in" }).click()
    await page.getByLabel("Email address").fill("p1@bisak.org")
    await page.getByLabel("Password").fill("bisak123")
    await page.getByRole("button", { name: "Sign in" }).click()

    // Navigate to My Units page
    await page.getByRole("link", { name: "My Units" }).click()
    await page.waitForURL(/\/pupil-lessons\/.+/)
  })

  test("subject dropdown does not contain 'All Subjects'", async ({ page }) => {
    const subjectSelect = page.locator("#subject-select")
    await expect(subjectSelect).toBeVisible()
    const options = await subjectSelect.locator("option").allTextContents()
    expect(options).not.toContain("All Subjects")
    expect(options.length).toBeGreaterThan(0)
  })

  test("unit dropdown is visible on mobile", async ({ page }) => {
    const unitSelect = page.locator("#unit-select")
    await expect(unitSelect).toBeVisible()
  })

  test("unit dropdown is hidden on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const unitSelect = page.locator("#unit-select")
    await expect(unitSelect).toBeHidden()
  })

  test("unit dropdown repopulates when subject changes", async ({ page }) => {
    const subjectSelect = page.locator("#subject-select")
    const unitSelect = page.locator("#unit-select")

    // Get initial unit options
    const initialOptions = await unitSelect.locator("option").allTextContents()

    // Get all subject options
    const subjectOptions = await subjectSelect.locator("option").allTextContents()

    if (subjectOptions.length < 2) {
      // Only one subject — can't test repopulation, skip
      test.skip()
      return
    }

    // Pick the second subject
    const secondSubject = subjectOptions[1]
    await subjectSelect.selectOption({ label: secondSubject })

    // Unit options should have updated
    const newOptions = await unitSelect.locator("option").allTextContents()
    // They may differ from initial, and there should be at least one
    expect(newOptions.length).toBeGreaterThan(0)
    // The unit dropdown should now reflect the new subject's units, not a stale mix
    // (We verify the dropdown still has a valid selected value by checking no "No units" placeholder when units exist)
    const selectedUnitValue = await unitSelect.inputValue()
    expect(selectedUnitValue).not.toBe("")
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/add-a-menu
npx playwright test tests/navigation/pupil-units-mobile.spec.ts --reporter=line
```

Expected: Tests FAIL — `#unit-select` not found, "All Subjects" is present in subject options.

---

### Task 2: Implement the changes in `pupil-units-view.tsx`

**Files:**
- Modify: `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx`

- [ ] **Step 1: Remove "All Subjects" from subjects array and update default**

Replace the `subjects` memo and `selectedSubject` state initialisation.

Current code (lines 77–85):
```ts
const [selectedSubject, setSelectedSubject] = useState("All Subjects")

const subjects = useMemo(() => {
  const subjectList = detail.subjects
    .map((s) => s.subject ?? "Subject not set")
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort()
  return ["All Subjects", ...subjectList]
}, [detail])
```

Replace with:
```ts
const subjectList = useMemo(() =>
  detail.subjects
    .map((s) => s.subject ?? "Subject not set")
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort(),
  [detail]
)

const [selectedSubject, setSelectedSubject] = useState(() => subjectList[0] ?? "")
```

- [ ] **Step 2: Update `filteredSubjects` memo — remove "All Subjects" branch**

Current code (lines 87–92):
```ts
const filteredSubjects = useMemo(() => {
  if (selectedSubject === "All Subjects") {
    return detail.subjects
  }
  return detail.subjects.filter((s) => (s.subject ?? "Subject not set") === selectedSubject)
}, [detail, selectedSubject])
```

Replace with:
```ts
const filteredSubjects = useMemo(
  () => detail.subjects.filter((s) => (s.subject ?? "Subject not set") === selectedSubject),
  [detail, selectedSubject]
)
```

- [ ] **Step 3: Update `selectedUnitId` initialiser**

Current code (line 96):
```ts
const [selectedUnitId, setSelectedUnitId] = useState<string | null>(() => allUnits[0]?.unitId ?? null)
```

Replace with a direct filter from `detail.subjects` (memos have not computed at `useState` initialiser time):
```ts
const [selectedUnitId, setSelectedUnitId] = useState<string | null>(() =>
  detail.subjects
    .find((s) => (s.subject ?? "Subject not set") === (subjectList[0] ?? ""))
    ?.units[0]?.unitId ?? null
)
```

Note: `subjectList` is now a plain `useMemo`, computed during the same render pass, so it is available as a reference here. However to be safe, compute `subjectList` as a plain variable before the hooks if needed. Actually since `useMemo` runs during render and `useState` lazy initialisers also run during the first render, `subjectList` from `useMemo` is NOT available during `useState`. Compute the subject list inline:

```ts
const [selectedUnitId, setSelectedUnitId] = useState<string | null>(() => {
  const firstSubject = detail.subjects
    .map((s) => s.subject ?? "Subject not set")
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort()[0] ?? ""
  return detail.subjects
    .find((s) => (s.subject ?? "Subject not set") === firstSubject)
    ?.units[0]?.unitId ?? null
})
```

- [ ] **Step 4: Update the subject `onChange` handler to reset unit selection**

Find the subject `<select>` element (around line 117). Currently it has:
```tsx
onChange={(event) => setSelectedSubject(event.target.value)}
```

Replace with an inline handler that also resets the unit:
```tsx
onChange={(event) => {
  const newSubject = event.target.value
  setSelectedSubject(newSubject)
  const firstUnit = detail.subjects
    .find((s) => (s.subject ?? "Subject not set") === newSubject)
    ?.units[0]?.unitId ?? null
  setSelectedUnitId(firstUnit)
}}
```

- [ ] **Step 5: Update the subject `<select>` to use `subjectList` instead of `subjects`**

The `<select>` currently maps over `subjects`. After the rename, map over `subjectList`:
```tsx
{subjectList.map((subject) => (
  <option key={subject} value={subject}>
    {subject}
  </option>
))}
```

- [ ] **Step 6: Add the mobile unit dropdown**

Add the following block immediately after the closing `</div>` of the subject dropdown wrapper (the `<div className="relative flex w-fit items-center">` that wraps the subject `<select>`), and before the `<div className="grid ...">`:

```tsx
{/* Mobile unit selector — hidden on desktop where sidebar handles unit selection */}
<div className="relative flex w-fit items-center md:hidden">
  <select
    id="unit-select"
    value={selectedUnitId ?? ""}
    onChange={(event) => setSelectedUnitId(event.target.value || null)}
    className="cursor-pointer appearance-none bg-transparent pr-8 text-xl font-semibold text-foreground focus:outline-none"
  >
    {allUnits.length === 0 ? (
      <option value="" disabled>No units</option>
    ) : (
      allUnits.map((unit) => (
        <option key={unit.unitId} value={unit.unitId}>
          {unit.unitTitle}
        </option>
      ))
    )}
  </select>
  <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
</div>
```

Also add `id="subject-select"` to the subject `<select>` if not already present (it already is at line 118 — no change needed).

---

### Task 3: Run the tests

- [ ] **Step 1: Run the Playwright tests**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/add-a-menu
npx playwright test tests/navigation/pupil-units-mobile.spec.ts --reporter=line
```

Expected: All tests PASS.

- [ ] **Step 2: Run lint**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/add-a-menu
pnpm lint
```

Expected: No errors.

- [ ] **Step 3: Visually verify in browser at mobile viewport**

Open `http://localhost:3000`, sign in as a pupil, navigate to My Units. In browser DevTools, set viewport to 390×844 (iPhone 14). Verify:
- Subject dropdown shows a subject (not "All Subjects")
- Unit dropdown appears below it
- Changing subject updates the unit dropdown
- On desktop viewport (1280px+), the unit dropdown disappears and the sidebar appears

---

### Task 4: Commit

- [ ] **Step 1: Commit**

```bash
cd /Users/leroysalih/nodejs/planner-004/.worktrees/add-a-menu
git add src/app/pupil-lessons/\[pupilId\]/pupil-units-view.tsx tests/navigation/pupil-units-mobile.spec.ts
git commit -m "feat: add mobile unit dropdown to pupil units page"
```
