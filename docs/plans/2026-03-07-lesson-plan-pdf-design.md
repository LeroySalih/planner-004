# Lesson Plan PDF Download — Design

**Date**: 2026-03-07

## Overview

Allow teachers to download a lesson plan as a PDF from two places: the lesson list on a unit page, and the header of the lesson detail page. The PDF contains the unit title, lesson title, learning objectives with success criteria, and all activities (with question/answer content for MCQ and short-text activities, images, and YouTube thumbnails with QR codes).

## Approach

**Server-side PDF generation via Route Handler + @react-pdf/renderer.**

A `GET /api/lesson-plan/[lessonId]` route handler fetches lesson data, renders it using `@react-pdf/renderer` React components, and streams the result back as `application/pdf`. The client triggers the download via a plain `<a href="...">` link.

## Architecture

### Route Handler

`src/app/api/lesson-plan/[lessonId]/route.ts`

- Authenticates via `requireTeacherProfile()` — returns 401 if unauthenticated
- Calls `readLessonDetailBootstrapAction(lessonId)` — lesson, unit, activities
- Calls `readLessonReferenceDataAction(lessonId)` — curricula
- Calls `readAllLearningObjectivesAction(...)` — LOs + SCs filtered to lesson's curricula
- Fetches image URLs server-side using `fetch()` (absolute URL constructed from `request.headers`)
- Generates QR codes using the `qrcode` npm package (server-side, not `qrcode.react`)
- Returns `Response` with:
  - `Content-Type: application/pdf`
  - `Content-Disposition: attachment; filename="lesson-plan-<lesson-title>.pdf"`

### PDF Document Component

`src/components/pdf/lesson-plan-document.tsx`

Pure `@react-pdf/renderer` React components (no DOM, no Tailwind). Receives pre-fetched data including image buffers and QR code data URIs.

### Download Button

`src/components/pdf/lesson-plan-download-button.tsx`

A small client component rendering an `<a href="/api/lesson-plan/[lessonId]" download>` wrapped in a `Button`. Added to:
1. Each lesson row in `src/components/units/lessons-panel.tsx`
2. The lesson header area in `src/components/lessons/lesson-detail-client.tsx`

## PDF Content & Layout

**Format**: A4, 15mm margins, Helvetica, black/grey/white palette.

### Header block (dark grey background)
- Unit title — small, uppercase, light grey
- Lesson title — large, bold, white
- Generated date — small, right-aligned, light grey

### Learning Objectives section
- Section heading: "Learning Objectives"
- Each LO as a numbered block (bold title)
- Indented bullet list of Success Criteria linked to this lesson via `lesson_success_criteria`

### Activities section
- Section heading: "Activities"
- Each active activity rendered by type:
  - `multiple-choice-question` — question text, options list (correct option marked ✓), question image if present
  - `short-text-question` — question text, then "Model Answer" in a grey box
  - `display-image` — image rendered inline
  - `show-video` — YouTube thumbnail (fetched server-side) + QR code to the video URL, side by side
  - `text` — plain text content
  - All other types — activity title only

## Error Handling

| Scenario | Behaviour |
|---|---|
| Unauthenticated | 401 response |
| Lesson not found | 404 response |
| Image fetch failure | Activity renders without image, no PDF failure |
| Invalid YouTube URL | QR code and thumbnail omitted, title shown |
| Large lessons | Continuous pages, natural page breaks via react-pdf |

## Dependencies

- `@react-pdf/renderer` — new dependency to add
- `qrcode` — server-side QR code generation (add; `qrcode.react` is client-only)
- `@types/qrcode` — dev dependency

All other required packages (`pg`, auth, server actions) already exist.
