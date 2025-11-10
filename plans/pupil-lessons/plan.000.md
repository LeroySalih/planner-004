# Plan 000 – Simplify `/pupil-lessons`

## Goal
Reshape the `/pupil-lessons/[pupilId]` experience so it matches `specs/pupil-lessons/general.000.md`: a single lessons-first view grouped by week → subject → lesson → activities, with no homework/units tabs.

## Current Gaps
- `src/app/pupil-lessons/[pupilId]/pupil-lessons-detail-client.tsx` renders Homework / Lessons / Units tabs plus filters; it surfaces homework data separately instead of nesting activities under each lesson.
- `src/lib/pupil-lessons-data.ts` only exposes `weeks.subjects.lessons`, without the activities required under every lesson; the existing `homeworkActivities` payload lists activities but not grouped with lessons/weeks.
- The Supabase RPC and Zod schemas in `src/lib/server-actions/pupil-lessons.ts` don’t expose lesson activity metadata, so the UI can’t render the requested hierarchy without multiple follow-up queries.

## Implementation Outline
1. **Extend the data contract**  
   - Update `pupil_lessons_detail_bootstrap` (Supabase) to return, per lesson assignment, the activities that belong to that lesson along with key metadata (id, title, type, publish/order info, submission state).  
   - Mirror those changes in `src/lib/server-actions/pupil-lessons.ts` by expanding `DetailHomeworkActivitySchema` (or adding a dedicated `DetailLessonActivitySchema`) and the inferred TypeScript types. Ensure telemetry via `withTelemetry` remains intact.

2. **Reshape the server-side transformer**  
   - In `src/lib/pupil-lessons-data.ts`, introduce a `PupilLessonActivity` type and build a new `weeks[].subjects[].lessons[].activities[]` collection when normalising the bootstrap payload.  
   - Keep homework/unit data accessible for future use, but ensure the main detail export surfaces the new nested structure the UI can rely on.  
   - Add helper formatters (week labels, activity ordering) and keep the week → subject grouping logic aligned with the spec (week issued/due headings).

3. **Refactor the page shell**  
   - Simplify the page copy in `src/app/pupil-lessons/[pupilId]/page.tsx` to describe the new layout (lessons only, emphasise week headings).  
   - Pass the updated detail shape into the client component, ensuring teachers and pupils still pass through `requireAuthenticatedProfile()` as today.

4. **Rebuild the client UI**  
   - Replace the tabbed interface in `pupil-lessons-detail-client.tsx` with a single scrollable list.  
   - Render: `Week issued` / `Week due` heading → subjects → lessons (show title, group, unit, CTA to open the lesson view) → list of activity pills/cards showing activity title, type icon, submission status, and quick links (e.g., “Open activity”, “Upload work”).  
   - Introduce minimal affordances (optional filter or accordion) only if needed to keep navigation manageable, but avoid reintroducing tabs per the spec.  
   - Reuse existing pupil activity components where appropriate for rendering activity summaries to avoid divergent styling.

5. **Verify and polish**  
   - Manually test both pupil and teacher scenarios to confirm redirects still work and that weeks with/without lessons behave as expected.  
   - Confirm telemetry logging, Supabase RPC calls, and types compile.  
   - Update docs if any new conventions emerge (e.g., note the lessons-only layout in `plans/general.001.md` or similar once implementation ships).

## Open Questions / Follow-ups
- Do we still need to surface homework-only activities anywhere else, or can that dataset be deleted once lessons list activities directly?  
- Should we keep the existing lesson filter input for accessibility, or does the spec require an entirely static list?  
- Activity ordering: follow lesson activity `order_by`, or group by type? Need confirmation before coding.
