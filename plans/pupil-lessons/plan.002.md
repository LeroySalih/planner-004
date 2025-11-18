# Plan: Pupil lessons feedback toggle

## Goal
Add pupil-facing feedback visibility controls per assignment (default hidden) and live updates over Supabase Realtime without changing existing lesson layout rules.

## Steps
1) Inventory current pupil-lessons and results flows: trace server actions and client components that fetch pupil lesson data, assignment results, and feedback visibility flags; confirm schemas in `src/types` and existing RPCs.
2) Define data contract: extend Zod schemas and Supabase queries to include a boolean feedback visibility field scoped to assignment, defaulting to hidden; document how it is toggled.
3) Build teacher-side toggle: add a switch on `/results/assignments/[id]` wired to a server action that updates the visibility flag and emits telemetry; ensure optimistic UI and immediate toast feedback.
4) Enable Realtime broadcast: publish visibility changes via the existing assignments/results channel and subscribe on pupil lessons/results views to reactively show/hide feedback without refresh.
5) Update pupil lessons/results UI: conditionally render feedback sections in both views only when enabled; keep lessons list-only (no activities) with homework flag, LO/SC, and collapse per lesson intact.
6) Tests and verification: add/adjust Playwright coverage for default-hidden behavior, toggle behavior, and live updates; document any new env/config needs.
