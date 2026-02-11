# Pupil Lesson Launch Buttons Design

**Date**: 2026-02-11
**Status**: Approved
**Target**: `/pupil-lessons/[pupilId]` page

## Overview

Add action buttons at the bottom of each lesson card in the pupil lessons list view to improve lesson navigation and revision access. The buttons will allow pupils to quickly launch lessons or start revision sessions, with score information displayed beneath for progress tracking.

## User Requirements

1. Add "Launch Lesson" button - always visible, navigates to lesson detail page
2. Add "Launch Revision" button - visible only when pupil has made at least one submission
3. Display previous scores beneath the buttons when available
4. Remove existing compact revision button from top-right area

## Current State

**File**: `src/app/pupil-lessons/[pupilId]/pupil-units-view.tsx`

Currently each lesson displays:
- Lesson title (clickable link to detail page)
- Learning objectives
- Due date in top-right
- Lesson score badge in top-right (if available)
- Revision score badge in top-right (if available)
- Compact `StartRevisionButton` icon in top-right (line 242)
- `LessonMedia` component showing images and files

## Proposed Changes

### 1. Remove Existing Revision Button

**Location**: Line 242
**Action**: Remove `<StartRevisionButton lessonId={lesson.lessonId} compact />`

This compact icon-only button will be replaced with a full-text button at the bottom.

### 2. Add Button Section

**Location**: After `<LessonMedia>` component (after line 253, inside the lesson container)

Add a new section containing:
- Two action buttons in a horizontal row
- Score display area beneath buttons

### 3. Button Specifications

#### Launch Lesson Button
- **Always visible** for enrolled lessons
- Links to: `/pupil-lessons/{pupilId}/lessons/{lessonId}`
- Style: Primary button (filled blue background)
- Icon: Book or Play icon from lucide-react
- Text: "Launch Lesson"

#### Launch Revision Button
- **Conditionally visible** when: `lesson.lessonScore !== null`
- Uses existing `StartRevisionButton` component (non-compact mode)
- Style: Outline button (border only, no fill)
- Icon: RefreshCw icon (from component)
- Text: "Practise Revision" (from component)

**Rationale for visibility**: A lesson score of `null` means no submissions have been made. A score of `0` or any number means at least one submission exists, warranting revision practice.

### 4. Score Display Specifications

Display beneath buttons when data is available:

#### Lesson Score
- **Condition**: `lesson.lessonScore !== null && lesson.lessonMaxScore !== null && lesson.lessonMaxScore > 0`
- **Format**: "Lesson Score: X.X/Y (Z%)"
- **Style**: Blue badge or colored text
- **Example**: "Lesson Score: 8.5/10 (85%)"

#### Revision Score
- **Condition**: `lesson.revisionScore !== null && lesson.revisionMaxScore !== null && lesson.revisionMaxScore > 0`
- **Format**: "Revision Score: X.X/Y (Z%)"
- **Additional**: Include revision date if `lesson.revisionDate` exists
- **Style**: Color-coded badge based on recency (using existing `getRevisionBadgeColor` function)
  - Green: Revised within last month
  - Amber: Revised 1-2 months ago
  - Red: Revised 2+ months ago
- **Example**: "Revision: 9/10 (90%) • Last revised: 15-01-2026"

### 5. Score Display in Top-Right Area

**Decision**: Keep existing score badges in top-right area (lines 222-243)

This provides quick visual reference at a glance, while the detailed display at bottom gives context alongside action buttons.

## Visual Layout

```
┌─────────────────────────────────────────────────┐
│ Lesson #                                        │
│                                                 │
│ [Lesson Title - clickable]         Due: Date   │
│ LO: Learning objectives...         Score badge │
│                                    Rev badge [▶]│ ← Remove icon
│                                                 │
│ [Lesson Media/Images if available]             │
│                                                 │
│ ┌────────────────┐ ┌──────────────────┐       │ ← New section
│ │ Launch Lesson  │ │ Launch Revision  │       │
│ └────────────────┘ └──────────────────┘       │
│                                                 │
│ Lesson Score: 8.5/10 (85%)                    │
│ Revision: 9/10 (90%) • Last revised: 15-01-26 │
└─────────────────────────────────────────────────┘
```

## Responsive Behavior

- **Desktop**: Buttons displayed side-by-side with gap between
- **Mobile**: Buttons stack vertically for better touch targets
- **Breakpoint**: Use Tailwind `sm:` prefix (640px)

## Component Dependencies

- `Button` from `@/components/ui/button` - for Launch Lesson
- `StartRevisionButton` from `@/components/revisions/start-revision-button` - for Launch Revision
- `Link` from `next/link` - for Launch Lesson navigation
- Icons from `lucide-react` - for button icons

## Data Requirements

All data already available in `lesson: PupilUnitLesson`:
- `lesson.lessonId` - for routing and revision
- `lesson.lessonScore` - for visibility check and display
- `lesson.lessonMaxScore` - for score display
- `lesson.revisionScore` - for display
- `lesson.revisionMaxScore` - for display
- `lesson.revisionDate` - for display and color coding
- `lesson.isEnrolled` - for Launch Lesson button visibility
- `detail.pupilId` - for routing

## Implementation Notes

1. The Launch Revision button reuses the existing `StartRevisionButton` component, ensuring consistent behavior with other revision entry points
2. Score display logic matches existing patterns used in lines 222-243
3. The `getRevisionBadgeColor` helper function (lines 51-68) will be reused for revision score styling
4. Button section should have proper spacing (mt-3 or mt-4) from LessonMedia component above

## Testing Considerations

Test scenarios:
1. Lesson with no submissions (`lessonScore === null`) - only Launch Lesson visible
2. Lesson with 0 score (`lessonScore === 0`) - both buttons visible
3. Lesson with score but no revision - Launch Revision visible, only lesson score shown
4. Lesson with both scores - both buttons and both scores visible
5. Mobile viewport - buttons stack vertically
6. Non-enrolled lesson - no Launch Lesson button (follow existing isEnrolled check)

## Success Criteria

- Launch Lesson button navigates to correct lesson detail page
- Launch Revision button starts revision session (existing functionality)
- Launch Revision only appears when pupil has made submissions
- Scores display correctly with proper formatting
- Layout is responsive and accessible
- No regression in existing functionality
