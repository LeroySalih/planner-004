
# Change Log:
2025-11-18 Added the feedback section
2025-11-10 Removed the requirement to display activities of lessons.  Added need to highlight whether the lesson includes homework as a flag in the title.  Also added the need to display LO and SC for lessons instead of activities.

# Description
The purpose of the pupil-lesosns pages are to provide the lesson, homework and activity data to pupils.


## Page Layout
The page should just ne a list of Lessons, no need to surface Homework or Units.  Any tab displays can be removed.

The title row of a lesson will display whether the lesson contains homework (a simple “homework set” flag, no counts).

The lesson will include the LO and SC for the lesson. Only learning objectives and success criteria explicitly linked to that lesson should display (do not surface unit-wide items that were not attached to the lesson).

To keep long lists manageable, only individual lessons may collapse/expand (e.g., to show or hide their LO/SC). Weeks and subjects should remain fully expanded for quick scanning.

## Page hierachy
- The main grouping on the page is the week issued (and week due).  This should be a major heading.  
- Within the week shoudl be a list of subjects. 
- Within each subject should be a list of lessons
- ~~With in each lesson should be a list of activities.~~

## Feedback.
-- By default, pupils will not see the feedback (either auto, AI generated or overriden by teacher).
-- A switch will be palced on the /results/assignments/id that will either show or hide the feedback for the pupil activities on this assignment.
-- USe the Supabase RT api to update the value that controls whether feedback is visible so that feedback can be seen without the pupil refreshign the page, when enabled by the teacher.
