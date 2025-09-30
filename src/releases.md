# Dino
## Releases 

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
