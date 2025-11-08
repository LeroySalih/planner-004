# /lessons/lessonId

## ChangeLog

2025-10-20 - Document `useActionState` + telemetry-backed flows for creating learning objectives and success criteria.

## Purpose
The purpose of this page is to allow teachers to create and design lessons that contribute to units.

## Data Retrieval Flow

- All lesson detail data is now fetched through the Supabase RPC `lesson_detail_bootstrap(lesson_id uuid)` which returns lesson core data, unit metadata, sibling lessons for navigation, learning objectives (with embedded success criteria), and lesson activities (with their success criteria and summative flags) as a single JSON payload.
- `LessonDetailPage` remains a server component: it calls `readLessonDetailBootstrapAction`, which invokes the RPC once, normalizes the JSON, and passes the resulting object into `LessonDetailClient`. No browser-side Supabase access occurs.
- Static reference data (curricula, assessment objectives) is fetched via `readLessonReferenceDataAction`, a dedicated RPC-backed server action that returns cached JSON blobs scoped to the lesson’s own curricula; the lesson page awaits that action server-side before render, avoiding client fetch waterfalls.
- Lesson files are fetched inside the same RPC, which surfaces storage metadata (name, path, timestamps, size) alongside the other lesson payload so the client receives everything via one server action.
- Telemetry (`withTelemetry`) wraps the single RPC call, logging the function name, parameters, and timing deltas to `logs/telem_<timestamp>.log` when `TELEM_ENABLED=true`, keeping parity with other routes.

## Page Components

### Page header

- The page header will be the standard format currently used on this route.
- the page header will include a link to the owning unit.
- The page header will include a pill denoting the status (active / inactive)
- The page header will include a select drop downdown that lists the other lessons in the unit, and allows the user to quickly navigate between lessons by selecting from the dropdown. This replaces any previous/next shortcut links.

## Learning Objectives

- The learning objectives panel is a list of learning objectives that are associated with the lesson through the lesson-success criteria link table. 
- Only success criteria that the lesson is associated with will appear on the panel.
- The LO and SC are displayed as a hirachical display with SC for each LO indented.
- There is an edit button, to allow teachers to edit the LO and Success criteria that are associated with this lesson. 

### Edit Lesson Objectives Side Bar
- The side bar will display all LO and SC for a selected curriculum (not just those tied to the lesson’s unit).
- A curriculum selector sits above the filter box. It defaults to the lesson’s owning curriculum but can be changed to any curriculum the teacher can access. Changing the selection refreshes the LO/SC list so only objectives from that curriculum are shown.
- Users can check the boxes at SC level to associate an individual SC with a lesson.
- users can click the LO to associate all SC with a lesson.
- remember that lessons are not directly associated with a LO, links are formed through SCs.
- When the side bar opens, any success criteria already linked to the lesson are preselected. Success criteria may be linked to multiple lessons.
- This side bar will inlcude a filter text box. Text that is entered will filter learning objective labels first; when an LO matches, all of its success criteria remain visible, otherwise only the matching success criteria are shown beneath that LO.
- The side bar will include an Add LO button. This opens a dialog that asks the user to pick a curriculum, then an assessment objective within that curriculum, before entering the LO title, spec ref, and the first success criterion (description and level). The new LO is linked to the chosen curriculum (not scoped to the unit until success criteria are assigned).
- When editing the Lesson LO's through the sidebar, i the user selects to add a new LO, the user is shown the Add Learning Objective Dialog.  This allwows the user to enter Curriculum, Title, Spec Ref (optional), Assessment Objective.  The user can 
- Add LO uses `useActionState` with `createLessonLearningObjectiveFormAction`. Submissions immediately reflect “queued” state in the UI, show a loader in the primary button, and surface success/failure through `sonner` toasts. The server action wraps work in `withTelemetry`, validating input with the shared Zod schema, writing timing data to `logs/telem_*.log` when telemetry is enabled, and returning the newly created LO plus its default SC so the sidebar can optimistically select them.
- When a new LO is created through this dialog, the LO and its default success criterion are automatically linked to the current lesson and preselected so they appear immediately in the sidebar.
- Each LO will have a New SC button that opens a second sidebar to allow the user to add a new SC to the LO. This sidebar enforces the numeric level range of 1–9.
- Add SC uses `useActionState` with `createLessonSuccessCriterionFormAction`, mirroring the Add LO behaviour (pending button state, toast feedback, telemetry instrumentation via `withTelemetry`). The action returns the created success criterion so the lesson sidebar can include it without a full refetch.

### Lesson Activities Side Bar
- This panel shows 2 buttons, Show Activities, and Add Activity, presented in the main content column above the activities list.
- Add Activity opens the Add Activity Side bar and allows users to add activities to the lesson.
- Show activities, presents the acitviites for the lesson, in full screen mode.
- Activities can be reordered by drag and drop.
- Each activity card retains advanced management controls, including homework and summative toggles, group assignment visibility, media previews (voice, image, video, file actions), success-criterion tagging, and delete/edit affordances.
- Acitvities can be deleted from a button placed on the activity.


### Add/Edit Acticvity Side Bar
- Allows a user to create a new or edit an existing activity.

### Lesson Links
- This component is a managed list of links for the lesson, allowing users to add, edit or delete links.
- In the onBlur event for the url text box, fetch the title of the url, and populate the description, if a title is available. Only trigger this when the URL is valid and has changed; if the URL cannot be parsed, clear the field to prompt correction.

### Lesson Files.
This component allows the teacher to upload multiple files to the lesson. A progress bar should show the aggregate progress of the current upload batch.
