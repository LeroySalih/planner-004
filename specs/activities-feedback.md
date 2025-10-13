# Feedback Specifications
This file contains the specifications for the feedback activity

# Change Log.
25-10-11 10:17 Present mode - added requirement to update score when a pupil edits the activities.
25-10-11 10:17 Present mode - chnaged the average score to be average for all submission activities and shown at the head of the activity card.

## Feedback Activity.

The purpose of this activity is to allow the pupil to see the results of any activity that has a submissiom in the current lesson.  Teachers will decide whether or to add this activity depending on whether the teacher wants the pupil to see the resutls.  The teacher can also enable or disable the activity for each assigned class, once the activity  been added to the lesson.

### Short Mode.
In short mode, the status of is enabled, or not is shown in the display.  

### Present Mode.
In Present Mode, if enabled, the component will display data for each activity in the current lesson that has a submission.  

If the teacdher has enabled Show Score for the activity, then the scores are presented, with a average (mean) score at the end.

If the teacher has enabled Show Correct Answer, then the correct answer is shown.  The correct answer is only shown when the teacher has enabled Show Correct Answer.

If a pupil updates the activities, by answering a question, the feedback panel should be updated with the new correct score.  

The average score should be the average for all activities in the lesson.  It should be displayed once at the head of the activity.

### Edit Mode.

In edit mode, the teacher has the ability to set Is enabled, Show Scores and Show Correct Answers for each group that the lesson is assigned to.

Is Enabled, which is a boolean and controls whether the data is displayed or not.  If not enabled, a messge of "Not enabled" si displayed.  This property overrides the Shwo Score and Show correct answers property
Show Score, which is a numebr and controls whether the score score is displayed
Show Correct Answers

The UI will be a grid of the groups that the lesson has been assigned to, Is enabled, Show Score and Show Correct Answers

#### UI Improvements


## submissions
There are no submissions for this activity.

## Assignment Results Dashboard
- Route: `/results/assignments/{group_id}__{lesson_id}` builds the teacher-facing matrix using existing submissions and lesson/group context.
- Grid: columns list only scorable activities (MCQ, short text, any submission with numeric score). Rows list pupils in the assigned group with sticky headers.
- Colour bands: >0.7 green, 0.3–0.7 amber, <0.3 red, and grey for unmarked/null scores.
- Sidebar: clicking any cell opens a drawer showing the submission timestamp, current score, and controls to set a 0–1 override or optional feedback. Save/reset buttons stay disabled if no submission exists yet.
- Overrides persist by updating the submission record (`teacher_override_score`, `teacher_feedback`), and the dashboard refreshes optimistically then revalidates the route.
