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
