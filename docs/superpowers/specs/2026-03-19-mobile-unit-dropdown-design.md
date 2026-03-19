# Mobile Unit Dropdown — Design Spec

**Date:** 2026-03-19
**Page:** `/pupil-lessons/[pupilId]`
**File:** `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx`

## Summary

On mobile screens the existing desktop sidebar (unit list) is hidden. This adds a native `<select>` unit dropdown below the subject dropdown so mobile users can switch between units. The subject dropdown is also updated to remove the "All Subjects" option.

## Changes

### 1. Remove "All Subjects" from Subject Dropdown

- Remove `"All Subjects"` from the `subjects` array — it is no longer prepended
- Default `selectedSubject` to `subjectList[0] ?? ""`
- The `filteredSubjects` memo always filters by selected subject — remove the `"All Subjects"` early-return branch
- When `selectedSubject` is `""` (no subjects exist), `filteredSubjects` returns `[]` and `allUnits` is `[]`
- The subject `<select>` renders with zero `<option>` children when `subjects` is empty — no placeholder needed

**Null subject handling:** subjects with `s.subject === null` are stored as `"Subject not set"` (via `?? "Subject not set"`). The `filteredSubjects` filter must use the same expression: `(s.subject ?? "Subject not set") === selectedSubject`.

### 2. Update `selectedUnitId` Initialiser

Replace the lazy initialiser with a direct filter (same approach as the change handler — memos have not computed at initialiser time):

```
detail.subjects.find(s => (s.subject ?? "Subject not set") === (subjectList[0] ?? ""))?.units[0]?.unitId ?? null
```

`detail` is SSR-fetched server data passed as a prop; it does not change after mount.

### 3. Subject Change Handler — Reset Unit Selection

The subject `onChange` handler must:
1. Set `selectedSubject` to the new value
2. Compute the first unit of the new subject directly from `detail.subjects`: `detail.subjects.find(s => (s.subject ?? "Subject not set") === newSubject)?.units[0]?.unitId ?? null`
3. Set `selectedUnitId` to that value

### 4. Add Mobile Unit Dropdown

The unit dropdown is a sibling `div` placed immediately after the subject dropdown's wrapper `div`, inside the same `flex flex-col` container. Both sit inside the existing `<div className="flex flex-col gap-8 sm:gap-10">`.

Structure:
```jsx
<div className="flex flex-col gap-8 sm:gap-10">
  {/* existing subject dropdown wrapper */}
  <div className="relative flex w-fit items-center"> ... </div>

  {/* new unit dropdown — mobile only */}
  <div className="relative flex w-fit items-center md:hidden">
    <select
      value={selectedUnitId ?? ""}
      onChange={(e) => setSelectedUnitId(e.target.value || null)}
      className="cursor-pointer appearance-none bg-transparent pr-8 text-xl font-semibold text-foreground focus:outline-none"
    >
      {allUnits.length === 0
        ? <option value="" disabled>No units</option>
        : allUnits.map(u => <option key={u.unitId} value={u.unitId}>{u.unitTitle}</option>)
      }
    </select>
    <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
  </div>

  {/* existing grid */}
  <div className="grid grid-cols-1 gap-8 md:grid-cols-[250px_1fr]"> ... </div>
</div>
```

The `e.target.value || null` coercion handles the empty-string case defensively (only reachable if the disabled "No units" option is somehow activated).

### 5. Keep `selectedUnit` Memo Fallback

Retain `?? allUnits[0] ?? null` in the `selectedUnit` memo. Although the initialiser and change handler keep `selectedUnitId` in sync, this provides a defensive fallback in case `selectedUnitId` ever holds a stale ID (e.g., if a parent re-renders with updated `detail` data). The fallback renders the first available unit rather than showing "No units assigned yet" unexpectedly.

### 6. Desktop Sidebar — Side Effect on Subject Headings

The `<aside>` sidebar is functionally unchanged. Side effect: subject headings in the sidebar are only shown when `filteredSubjects.length > 1`. Since the subject dropdown now always selects exactly one subject, `filteredSubjects` is always length 1 — multi-subject users who previously saw headings when "All Subjects" was selected will no longer see them. This is acceptable since headings add no value when viewing a single subject.

## Behaviour

| Scenario | Result |
|---|---|
| Page loads | First subject selected; first unit of that subject selected |
| User changes subject | `selectedUnitId` resets to first unit of new subject; unit dropdown repopulates |
| User changes unit (mobile dropdown) | `selectedUnitId` updates; content panel shows selected unit |
| Subject has no units | Unit dropdown shows disabled "No units" option; content panel shows "No units assigned yet" |
| No subjects at all | Subject dropdown renders blank (no options); unit dropdown shows "No units"; content panel shows "No units assigned yet" |
| Desktop (md+) | Unit dropdown hidden (`md:hidden`); sidebar visible as before |

## Constraints

- Changes confined to `pupil-units-view.tsx`
- No new dependencies
- Follows existing native `<select>` + `ChevronDown` pattern from the subject dropdown
