# MCQ Activities Specifications
This file contains the specifications for the activities

# Change Log.
25-01-11-07:15: Added the UI Improvements section to the Edit Mode of MCQ
25-10-11-06:17: Changed the Multiple Choice Question Present Mode section to discuss showing the correct answer.
25-10-11-06:15: Changed the Multiple Choice Question Edit Mode section to add details to how theteacher will injteract with the MCQ activity.

## Description.

The purpose of this activity is to allwo the teacher to specify a question, 4 possible answers, and a correct answer.  When in present mode, the pupil is able to select a answer, which is recorded in the body field of the submissions table.  The pupil is not given feedback on whether the quesiton is correct or not.

### Short Mode.
In short mode, the Question Text is shown inthe display.

### Present Mode.
In Present Mode, the quesiton, 4 answers are shown.  
The correct answer should not be shown in either pupil of teacher mode.
If the current user is a teacher, there will be a reveal button, that when pressed, will show the correct answer.

### Edit Mode.
In edit mode, the user is able to specify the following
- question text (mandatory)
- image file (optional)
- at least 2 answers
- the correct answer (which must be one of the provided answers )

In edit mode, the teacher is presented with a rich text box to enter the question.  The rich text box will include a bold, justify, italics and code button.

In edit mode that the teacher will be presented with 4 text boxes to speciy the answer.  On the same line, ahead of the text box is a radio button to speciy the correct answer.

#### UI Improvements
1. Compress the UI for the MCQ Edit Side Side Bar
2. Remove the term "option 1", etc, from each answer.
3. Remove the "Set the radio button to mark this answer as correct."
4. Remove the card fo rthe answer, the answers can all belong in the same card
5. Move the validation text "Provide up to four answers and make sure at least two contain text before saving."


## submissions
The submission is stored in the submission table, 
- activity_id
- user_id
- created_at
- body JSON field {answer_chosen, is_correct}

