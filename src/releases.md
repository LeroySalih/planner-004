# Dino
## Releases 
### Release 0.0.21
- Auth flow now auto-creates a placeholder row in `profiles` the moment an authenticated session is detected, preventing new sign-ups from getting stuck without a profile record.
- Allow Upload File activities to be marked as assessments by treating `"upload-file"` as a scorable activity type in `src/dino.config.ts`.

### Release 0.0.20
- `/reports`: Landing view now links group chips directly to the new cohort matrix and trims pupil cards to subject/unit summaries with activities, assessment, and Level 4L-style labels.
- `/reports/[pupilId]/units/[unitId]`: Added a dedicated unit report showing unit totals plus a detailed learning objective and success criteria table for the selected pupil.
- `/reports/groups/[groupId]`: Introduced a sticky-header cohort matrix (pupils × units) displaying assessment percentages and derived levels; removed the legacy pupil-group print/export routes.

### Release 0.0.18
- `/results/assignments/[assignmentId]`: Converted the header cards into collapsible detail panels, surfaced the overall average inline, and tightened missing-submission counts with email fallbacks when pupil names are absent.
- Assignment results pipeline now enriches each pupil with Supabase Auth emails (using the service role key) and extends the shared Zod schema so UI can display them safely.
- `/groups/[groupId]`: Added per-pupil remove buttons backed by a new server action that detaches group membership without deleting learner profiles; list and detail pages revalidate after each removal.

### Release 0.0.19
- Replaced assignment grid feedback colours with lesson score gradients: server now aggregates lesson scores via `readLessonAssignmentScoreSummariesAction`, the grid renders green/red bands driven by totals, and the `/assignments` page no longer loads feedback summaries.
- Centralised scorable activity rules in `src/dino.config.ts`, refactoring scoring/intake paths to reuse `isScorableActivityType` and disallow summative flags on non-scorable types through validation and UI safeguards.
- Added level calculations driven by `specs/calc-levels.md`; `src/lib/levels/index.ts` exposes reusable helpers that feed pupil reports, which now display the calculated level alongside summative percentages in both the web view and PDF export.

### Release 0.0.17
- Results sidebar now lets teachers override scores and feedback even when no learner submission exists by creating a teacher-authored submission on save.
- Override flow updates submissions in Supabase and adjusts MCQ/short-text payloads, including neutral handling of placeholder answers.
- UI clarifies the new behaviour with guidance copy, optimistic state updates, and continued access to resets once overrides are in place.

### Release 0.0.16
- Working on github test flows.

### Release 0.0.15
- Reworked assignment results scoring to persist scores per success criterion, added normalization helpers, and updated build/test scripts accordingly.
- MCQ and short-text submissions now fan out auto and override scores across linked criteria, with per-criterion overrides and averages reflected everywhere the data is consumed.
- Results dashboard sidebar shows each criterion’s editable score plus the original question, correct answer, and pupil response for quick teacher review.

### Release 0.0.14

- `/results/assignments/[assignmentId]`: Added an assignment results dashboard that builds a pupil × activity matrix on the server, surfaces colour-banded score cells, sticky headers, and lesson/group context cards.
- Results sidebar lets teachers review submission history, apply 0–1 overrides, and attach feedback; overrides reuse existing submission rows and support instant optimistic updates.
- Assignment Manager lesson cards now expose a `Results` shortcut that jumps straight into the dashboard for the selected group/lesson pairing.

### Release 0.0.13 

- Shifted activity/lesson data to the shared lesson_success_criteria link: new types and server actions load/update those rows, every lesson query now hydrates success criteria (plus inferred learning objectives) from that table, and activity editors use it when selecting criteria.

- Revamped Curriculum Mapper & lesson detail flows: mapper exposes nested success-criterion toggles per lesson (objective rows are read-only), lesson detail and unit curriculum panels display the linked criteria, and activity short/present views badge them for teachers/pupils.

- Feedback lesson workspace now draws its objective/criterion columns from lesson-level links instead of unit assignments, keeping the matrix accurate even when only success criteria are mapped.


### Release 0.0.12
- Feedback activity now refreshes automatically when pupils submit answers, showing a single lesson-wide average based on the signed-in pupil’s scores while keeping per-activity breakdowns informational.
- Lesson feedback presenter listens for client-side refresh events, fetches pupil-specific aggregates, and drops redundant per-activity average rows to keep the card focused on the new lesson average banner.
- Pupil MCQ cards streamline their header by removing the “Multiple choice question” subtitle.

### Release 0.0.11
- Multiple choice questions now store structured submissions (`answer_chosen`/`is_correct`) with new server actions powering pupil experiences and reveal controls.
- Pupil lessons load saved MCQ selections, while presentation mode keeps answers hidden until teachers reveal them.
- Lesson activity editor replaces the MCQ JSON block with a compact rich-text question editor and inline answer list, validating at least two options before save.

### Release 0.0.10
- Activities: Added a multiple choice question flow covering teacher authoring, lesson presentation, and pupil answering with submission tracking.
- Activities: MCQ authoring now supports rich-text questions, four answer slots with inline correct-answer selection, and a teacher-only reveal control during presentation.
- `/pupil-lessons/[pupilId]/lessons/[lessonId]`: Upload activity submissions now save to `lessons/<lessonId>/activities/<activityId>/<pupilId>/<fileName>`, keeping multiple upload steps isolated per lesson.


### Release 0.0.9
- `/curriculum/[curriculumId]`: Replaced the inline “saving changes” banner with toast notifications so teachers get unobtrusive feedback on curriculum edits.
- `/curriculum/[curriculumId]`: Curriculum Mapper tab now shows a sticky learning-objective column with lesson columns only, including full-cell toggles, loading spinners, and green highlights when lessons are linked.
- `/curriculum/[curriculumId]`: Unit filter relocated into the mapper header and success-criteria pills/columns removed for a cleaner grid layout.

### Release 0.0.8
- `/lessons/[lessonId]/activities/activity/[activityId]`: Display Image activities now load their stored files or external URLs and present them with a zoomable overlay plus a close control for full-screen viewing.
- Components: Added an `ActivityImagePreview` utility to handle image zoom overlays inside lesson presentation flows.

### Release 0.0.7
- `/lessons/[lessonId]/activities`: Introduced a dedicated overview with blue hero header, inline learning objective summary, and rich previews (step number, text, images) for every activity.
- `/lessons/[lessonId]/activities/activity/[activityId]`: Added deep-linked presentation view mirroring the lesson presenter with next/previous navigation and resource downloads.
- Activity launchers: Updated all “Show activities” controls across lessons, units, and feedback tools to route into the new activities experience.

### Release 0.0.6
- `/pupil-lessons/[pupilId]`: Replaced the legacy timeline with homework and lessons tabs, added subject/date/unit filtering, and refreshed the hero styling for consistency with lesson detail pages.
- `/pupil-lessons/[pupilId]`: Homework cards now surface “week due” and “week issued” dates (planned week + 1 week) to clarify deadlines.
- `/pupil-lessons/[pupilId]`: Introduced a Units tab listing every subject, assigned unit, and associated learning objectives (with success criteria) for the signed-in pupil.
- `/pupil-lessons/[pupilId]/lessons/[lessonId]`: Highlight homework activities with a red “Homework” pill across both standard and upload steps.
- Navigation: Pupils now see a top-level Dashboard link to `/reports/<pupil_id>` and the three-dot user menu no longer duplicates the destination.
- `/lessons/[lessonId]`: Learning Objectives now respect unit links, only showing the success criteria assigned to the unit instead of every criterion on the objective.

### Release 0.0.5
- Added a dedicated loading screen for `/lessons/[lessonId]`, keeping route transitions consistent with other app sections.
- Introduced a `Show Activities` launcher beside the `Add Activity` control on lesson detail, opening the presentation overlay with lesson files, links, and downloads wired up.

### Release 0.0.4
- Added seeding helpers for Supabase profiles and group membership so teacher/pupil fixtures populate consistently.
- Introduced the "Upload file" lesson activity: teachers can configure instructions and resources, pupils get drag-and-drop uploads tied to their account, and show mode/presentation view now renders the new workflow.
- Optimised lesson management UI: Show activities control moved beside Edit (renamed to Details), the default edit sidebar now focuses on title/objectives only, while dedicated sidebars handle activities/resources.
- Refined upload behaviour for pupils—single file enforced with replacement, optimistic previews, and immediate feedback without refreshing.
- Updated the header profile button to react in real time when users save new name details, with a Playwright regression test covering the flow.

### Release 0.0.3
- `/reports`: Restyled the hero header with white/grey copy and relocated the export controls into the gradient banner.
- `/reports/[pupilId]`: Opened all subject accordions by default, swapped feedback captions for icon-only indicators, linked unit headings to their detail pages, and removed the back-to-assignments link.
- `/reports/[pupilId]`: Added a server-backed "Export PDF" workflow powered by pdfkit, colour-coding success criteria by feedback in the generated document, and exposing both export and print actions from the header.

### Release 0.0.2
- Updated the user menu Dashboard link to route to `/reports/<pupil_id>` for the signed-in user.
- Let pupils open `/reports/<pupil_id>` while redirecting them back to their own report if they try to view another pupil.
- Hid the Dashboards item from the pupil top navigation while keeping it in the three-dot user menu.

### Release 0.0.1
- `/`: Centers the Planner hero graphic as a simple branded landing page.
- `/signin`: Email-password sign-in form with welcome messaging and home navigation.
- `/signup`: Account registration form guiding new users into Planner with home shortcut.
- `/profile`: Onboarding profile form for entering name details with return-to-home link.
- `/profiles`: Alternate route to the profile form plus quick access to group management.
- `/profile/groups`: Group membership manager for joining via codes, viewing memberships, and returning to profile.
- `/profiles/groups`: Same membership manager surfaced from the /profiles flow.
- `/profiles/[profileId]`: Profile detail editor for a specific user, showing teacher status and links to dashboard/group tools.
- `/profile/dashboard/[profileId]`: Pupil dashboard summarising group memberships, calculating working levels from feedback, and deep-linking to reports.
- `/assignments`: Teacher-only Assignment Manager grid loading groups, units, lessons, feedback; supports creating/editing assignments, managing lesson schedules, and opening sidebars.
- `/curriculum`: Teacher curriculum index with filtering, inactive toggles, creation sheet, edit controls, and spreadsheet export for curricula.
- `/curriculum/[curriculumId]`: Full curriculum editor to manage assessment objectives, lesson objectives, success criteria, unit alignment, and bulk updates with live feedback.
- `/units`: Units overview with subject filters, search, inactive toggle, create-unit sidebar, and navigation into detail cards.
- `/units/[unitId]`: Unit detail workspace showing metadata, curriculum alignment, related assignments/groups/lessons, file manager, and edit sidebar.
- `/lessons`: Lessons catalogue filtering by subject/status, supporting wildcard search, and linking to lesson detail.
- `/lessons/[lessonId]`: Lesson detail manager with objective summaries, editable objectives sidebar, links manager, file uploads, and unit context.
- `/groups`: Group directory with wildcard filter, join-code sharing, create/edit flows, and links into group detail.
- `/groups/[groupId]`: Group detail page listing subject info and pupil members with report shortcuts and membership error messaging.
- `/feedback/groups/[groupId]/lessons/[lessonId]`: Feedback workspace combining lesson details, activities, resources, success-criteria matrix, pupil ratings table, and previous/next lesson navigation.
- `/pupil-lessons`: Teacher landing listing every pupil’s scheduled lessons with filters and links; non-teachers redirect to their own view.
- `/pupil-lessons/[pupilId]`: Pupil-specific lesson timeline grouping assignments by date and group, accessible to teachers or the pupil.
- `/pupil-lessons/[pupilId]/lessons/[lessonId]`: Student-friendly lesson detail page with assignment context, schedule, activities, downloads/audio, and back navigation.
- `/reports`: Teacher report index aggregating pupils from all groups, providing wildcard filtering, and linking into detailed reports.
- `/reports/[pupilId]`: Comprehensive pupil report grouped by unit/subject, highlighting assignments, success criteria, and latest feedback status.
- `/reports/[pupilId]/groups/[groupId]`: Group-scoped pupil report reusing the full analysis constrained to a single class.
- `/reports/[pupilId]/groups/[groupId]/print`: Print-optimised version of the group report for distribution.
