# Sidebar Layout Design

Date: 2026-03-05

## Overview

Redesign the site layout from a top navigation bar with dropdown menus to a slim top bar (logo + sign in/out) plus an always-visible left sidebar with collapsible navigation sections. Content becomes full-width.

## Layout Structure

```
┌─────────────────────────────────────────── full width ──┐
│ TopBar (sticky 80px): [Logo/Dino] .......... [UserNav]  │
├──────────┬──────────────────────────────────────────────┤
│ SideNav  │ <main> full-width                            │
│  w-60    │                                              │
│ ▾ Planning                                              │
│   Specs  │                                              │
│   Curric │                                              │
│   SoW    │                                              │
│ ▾ Resources                                             │
│   Units  │                                              │
│ ▾ Feedback                                              │
│   ...    │                                              │
│ ▾ Admin  │                                              │
│   ...    │                                              │
└──────────┴──────────────────────────────────────────────┘
```

Mobile: TopBar shows `☰` button → Sheet slides in from left containing all nav sections.

## Components

### `src/app/layout.tsx` (modified)
- Change body area from `flex-col` to `flex-row`
- TopBar stays above; below it is `flex-row` of `<SideNav>` + `<main>`
- Remove any `max-w-*` constraint from layout

### `src/components/navigation/top-bar.tsx` (modified)
- Remove `TeacherNavLinks` (moved to sidebar)
- Keep logo + `UserNav`
- Add mobile `☰` hamburger button that opens sidebar Sheet
- Remove `max-w-6xl` container constraint — goes full-width

### `src/components/navigation/side-nav.tsx` (new)
- Desktop: always-visible `w-60` sidebar, sticky, `h-[calc(100vh-80px)]`, overflow-y-auto
- Sections use Radix `Accordion` (all expanded by default)
- Session fetch client-side, same pattern as existing `TeacherNavLinks`
- Renders nav sections conditionally by role (teacher, pupil, admin, technician)
- Mobile: rendered inside a `Sheet` triggered by TopBar hamburger

### `src/components/navigation/teacher-links.tsx` (deleted)
- Logic migrated into `SideNav` — no longer needed

## Nav Sections

### Teacher
- **Planning**: Specs, Curriculum, SoW
- **Resources**: Units
- **Feedback**: Dashboards, Reports, Unit Progress, LO Progress, Peer Review, Flashcard Monitor

### Admin / Technician
- **Admin**: Admin, Groups, AI Queue, Safety Logs, Queue

### Pupil
- Flat links (no group): My Units, My Tasks, Flashcards, Specs, My Reports

## Key Decisions

- Sidebar width: `w-60` (240px)
- All accordion sections start expanded
- Mobile breakpoint: `md` (768px) — below this, sidebar hidden, hamburger shown
- No `max-w-*` on content — true full-width
- TopBar height stays 80px; sidebar height is `calc(100vh - 80px)`
