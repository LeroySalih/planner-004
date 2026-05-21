# Public Lessons — Design Spec

**Date:** 2026-05-21
**Status:** Approved

---

## Overview

Allow teachers to mark individual lessons as public. Public lessons are visible to unauthenticated visitors in two ways:

1. **Sign-in page browser** — the `/signin` page gains a left-hand public content browser alongside the existing sign-in form.
2. **Direct link** — any public lesson is accessible at its canonical `/lessons/[id]` URL without authentication.

In both cases, only static content (text, images, video) is rendered. Scorable activities (MCQ, STQ, file uploads, and any other scorable type) are completely hidden.

---

## Database Changes

### New column on `lessons`

```sql
ALTER TABLE public.lessons
  ADD COLUMN is_public boolean DEFAULT false NOT NULL;
```

- Default `false` — existing lessons remain private.
- Independent of `active`: a lesson can be in any combination of active/inactive × public/private.
- Only lessons where `active = true AND is_public = true` appear in the public browser and are viewable without authentication.

### Migration file

Add a new migration in `src/migrations/applied/` following the existing naming convention.

---

## Server Actions

### `readPublicLessonsAction()` — no auth required

Returns all active public lessons joined with their unit and curriculum:

```ts
type PublicLesson = {
  curriculumId: string
  curriculumTitle: string
  unitId: string
  unitTitle: string
  lessonId: string
  lessonTitle: string
}
```

Used by the sign-in page left panel. No authentication guard — this is intentionally public data.

### `readPublicLessonActivitiesAction(lessonId: string)` — no auth required

Fetches the full activity list for a single active public lesson. Called by `PublicLessonBrowser` on-demand when a visitor clicks a lesson in State 1. Returns `{ data: Activity[], error }`. Validates that the lesson is `active = true AND is_public = true` before returning — returns an error if not.

### `toggleLessonPublicAction(lessonId: string, isPublic: boolean)` — teacher only

Updates `is_public` on a single lesson. Guarded with `requireRole('teacher')`. Returns `{ data, error }` in the standard shape.

---

## Sign-in Page Redesign (`/signin`)

### Layout

Two-column layout across the full viewport height:

- **Left panel** (flex: ~60%) — public content browser. Scrollable unit cards, fixed header and filter chips.
- **Right panel** (fixed width ~320px) — sign-in form or sign-in button depending on state. Never scrolls.

The page is a server component that pre-fetches public lessons via `readPublicLessonsAction()` and passes the data to a client component for interactivity.

### Left panel — State 1: Curriculum browser (default)

- **Header:** "Browse Lessons" title + subtitle (fixed, does not scroll)
- **Filter chips:** one chip per curriculum, plus an "All" chip (fixed, does not scroll)
  - Selecting a chip filters the unit cards below to that curriculum
  - "All" is selected by default
- **Unit cards:** one card per unit that has at least one active public lesson (scrollable)
  - Card header: unit title + curriculum name label
  - Card body: list of lesson links — clicking a lesson transitions to State 2

### Left panel — State 2: Inline lesson view

When a lesson is selected from State 1:

- **Back link:** "← Back to lessons" at top — returns to State 1
- **Breadcrumb:** `Curriculum title › Unit title`
- **Lesson title**
- **Lesson content:** static activities only (text, images, video). Scorable activities are completely invisible — not replaced with placeholders, not mentioned.
- Left panel is scrollable; right panel stays fixed.

### Right panel — State 1

Full sign-in form (email, password, submit button). Unchanged from current design.

### Right panel — State 2

Simplified to:
- Heading: "Want to do more?"
- Subtitle: "Sign in to attempt activities, track your progress, and access all lessons."
- Single "Sign in →" button — links to `/signin` (reloads to State 1, restoring the full form)

### Client state management

The left panel and right panel state is managed in a single client component (`PublicLessonBrowser`). No URL changes occur when navigating within the sign-in page — all transitions are in-memory React state.

When a visitor clicks a lesson, `PublicLessonBrowser` calls `readPublicLessonActivitiesAction(lessonId)` to fetch the lesson's activities on-demand, then transitions to State 2 and passes the activities to `PublicLessonView` as props.

---

## Public Lesson Page — Direct Link (`/lessons/[id]`)

### Auth-aware rendering in the existing lesson page

The `/lessons/[id]` server component already exists. It gains the following logic:

```
1. Try getAuthenticatedProfile()
2. If authenticated → existing full lesson render (no change)
3. If unauthenticated:
   a. Fetch lesson, check is_public and active
   b. If public + active → render public view (see below)
   c. If private or inactive → redirect to /signin?returnTo=/lessons/[id]
```

### Public view layout

Full-width, centred content column (max ~680px):

- **Top nav bar:** Dino logo on left, "Want to track your progress?" label + "Sign in" button on right.
- **Breadcrumb:** `Curriculum › Unit`
- **Lesson title**
- **Lesson content:** static activities only. Scorable activities are completely invisible.
- **Bottom nudge:** "Continue learning with Dino" card with a brief description and "Sign in →" button.

The existing `LessonDetailClient` component is not reused for the public view — a new `PublicLessonView` server component renders the filtered activity list directly, keeping the public rendering path simple and free of authenticated-only logic.

---

## Teacher Controls

### Lesson edit sidebar

A new `is_public` toggle is added to the lesson edit sidebar, following the same pattern as the active/inactive toggle on units introduced in the prior commit.

- Label: "Public lesson"
- Toggle calls `toggleLessonPublicAction` on change
- Guarded by teacher role — only visible to teachers
- Position: alongside the existing active toggle in the sidebar

---

## Activity Filtering — Scorable Types

The `SCORABLE_ACTIVITY_TYPES` constant in `src/dino.config.ts` is the source of truth. When rendering a public lesson, filter the activity list with `isScorableActivityType()` and omit those activities entirely. Do not render a placeholder or any indicator that activities were removed.

---

## Component Breakdown

| Component | Type | Location | Purpose |
|---|---|---|---|
| `PublicLessonBrowser` | Client | `src/components/public/PublicLessonBrowser.tsx` | Sign-in page left panel — state machine for browser ↔ lesson view, fetches activities on-demand |
| `PublicUnitCard` | Client | `src/components/public/PublicUnitCard.tsx` | Single unit card with lesson list |
| `PublicLessonView` | Shared | `src/components/public/PublicLessonView.tsx` | Presentational component — renders filtered activity list; used by both `PublicLessonBrowser` (inline) and the direct-link lesson page (server-rendered) |
| `PublicLessonNav` | Server | `src/components/public/PublicLessonNav.tsx` | Top nav bar for direct-link public lesson page |

---

## Routing & Auth Summary

| Route | Auth state | Lesson visibility | Result |
|---|---|---|---|
| `/signin` | Any | N/A | Split layout with public browser on left |
| `/lessons/[id]` | Authenticated | Any | Full lesson (existing behaviour) |
| `/lessons/[id]` | Unauthenticated | `is_public=true, active=true` | Public view (static content only) |
| `/lessons/[id]` | Unauthenticated | `is_public=false` or `active=false` | Redirect to `/signin?returnTo=/lessons/[id]` |

---

## Out of Scope

- Making curricula or units independently public (visibility is derived from lesson `is_public`)
- Search or full-text filtering within the public browser
- Public access to any route other than `/signin` and `/lessons/[id]`
- Analytics or view-count tracking for public lessons
- SEO / metadata for public lessons
