## Telemetry Coverage

### Configuration
- `TELEM_ENABLED=true` toggles logging globally.  
- `TELEM_PATH` accepts a comma-separated list of route tags (e.g. `units,lessons`) to limit instrumentation to matching prefixes. Leave unset to record all spans.

### Routes
- `/reports` (`src/app/reports/page.tsx`) – wraps `listPupilsWithGroupsAction` to trace the landing page load.
- `/reports/groups/[groupId]` (`src/app/reports/groups/[groupId]/page.tsx`) – instruments group, assignment, unit metadata, and pupil report hydration calls.
- `/api/MCP` (`src/app/api/MCP/route.ts`) – records the MCP tool discovery payload timing.
- `/api/MCP/curriculum` (`src/app/api/MCP/curriculum/route.ts`) – traces curriculum summary listing.
- `/api/MCP/curriculum/[curriculumId]` (`src/app/api/MCP/curriculum/[curriculumId]/route.ts`) – traces curriculum detail lookups.
- `/api/MCP/losc` (`src/app/api/MCP/losc/route.ts`) – tracks LOSC fetch latency and error paths.
- `/units` (`src/app/units/page.tsx`) – add telemetry around the units and subject lists returned to the index view.
- `/units/[unitId]` (`src/app/units/[unitId]/page.tsx`) – trace unit detail hydration across assignments, groups, subjects, objectives, lessons, and file listings.
- `/lessons` (`src/app/lessons/page.tsx`) – capture timing for the combined lessons, units, and subjects payload delivered to the list view.
- `/lessons/[lessonId]` (`src/app/lessons/[lessonId]/page.tsx`) – instrument lesson detail loading, including related curricula, learning objectives, files, activities, and sibling lesson navigation.

### Data Loaders
- `getPreparedReportData` (`src/app/reports/[pupilId]/report-data.ts`) – central pupil report aggregator.
- `getPreparedUnitReport` (`src/app/reports/[pupilId]/report-data.ts`) – derived unit-level export builder.
- `loadUnitLessonContext` (`src/app/reports/[pupilId]/report-data.ts`) – lesson context hydrator that feeds report assembly.
- `readUnitsAction` (`src/lib/server-actions/units.ts`) – full units listing shared by `/units` and `/lessons`.
- `readUnitAction` (`src/lib/server-actions/units.ts`) – single unit fetch used by both unit and lesson detail routes.
- `readSubjectsAction` (`src/lib/server-actions/subjects.ts`) – subject catalogue leveraged by units and lessons pages.
- `readAssignmentsAction` (`src/lib/server-actions/assignments.ts`) – unit detail assignment context.
- `readGroupsAction` (`src/lib/server-actions/groups.ts`) – group membership data surfaced in unit detail.
- `readLearningObjectivesByUnitAction` (`src/lib/server-actions/learning-objectives.ts`) – unit-level learning objective fetch for unit detail.
- `readLessonsByUnitAction` (`src/lib/server-actions/lessons.ts`) – shared unit lesson list referenced by unit and lesson detail views.
- `listUnitFilesAction` (`src/lib/server-actions/unit-files.ts`) – unit resource listings.
- `readLessonsAction` (`src/lib/server-actions/lessons.ts`) – global lessons listing that powers `/lessons`.
- `readLessonAction` (`src/lib/server-actions/lessons.ts`) – primary lesson fetch for the lesson detail route.
- `readAllLearningObjectivesAction` (`src/lib/server-actions/learning-objectives.ts`) – lesson detail learning objective picker.
- `readCurriculaAction` (`src/lib/server-actions/curriculum.ts`) – curricula catalogue shown on lesson detail.
- `readAssessmentObjectivesAction` (`src/lib/server-actions/assessment-objectives.ts`) – assessment objectives surfaced on lesson detail.
- `listLessonFilesAction` (`src/lib/server-actions/lesson-files.ts`) – lesson resource listings.
- `listLessonActivitiesAction` (`src/lib/server-actions/lesson-activities.ts`) – activity metadata required for lesson detail telemetry.

## Change Log
- 2025-11-06 – Documented planned telemetry coverage for `/units` and `/lessons` routes, including supporting data loaders.
- 2025-11-06 – Updated `TELEM_PATH` description to support comma-separated route filters.
