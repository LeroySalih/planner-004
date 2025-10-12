# Short Answer Activities Specifications
This file contains the specifications for the Short Answer activities

# Change Log.
25-10-12 00:58 Updated the description to evaluate all pupils together.
25-10-12 00:58 Updated the data section to make model answers mandatory.


## Description.

A short answer activity is a question that is posed to the pupil, where the expected answer is approx 1 to 5 words.  The answer will be given a score, where 0 is totally wrong and 1 is totally correct.  An answer with a score > 0.8 is considered acceptable as correct.

The score is evaluated by an AI model, but can also be overridden by a teacher.   A teacher can trigger the evaluation of all pupil answers with a mark button on the teacher feedback panel. When pressed, all student questions are submitted to the AI ina single call, the replay will allow you to apply in the individual scores for each student. The submission body field is then updated with the score.

The prompt to send to the CHAT-GPT is "Here is a question. <insert question>.  here is the model answer <insert model answer>.  Here is the pupil answer <insert pupil answer>.  Give the pupil answer a score on correctness between 0 and 1, where 0 is totally incorrect and 1 is totally correct",

### Data and Keys
- use the OPEN_AI_KEY key to get access to the open ai model.
- use the GPT 5 mini model to evaluate the answer.

### Short Mode.
In short mode, the Question Text is shown in the display.

### Present Mode.
In Present Mode, the quesiton, and answer. textbox are shown.  
When the pupil tabs out of the text box, use AI to evaluate the answer and updat ethe submission.
Display an progress bar beneath the window.  Do not show the pupil the results of the evaluation, only when it is completed.

### Edit Mode.
In edit mode, the user is able to specify the following
- question text (mandatory)
- model answer (madantory)


In edit mode, the teacher is presented with a rich text box to enter the question.  The rich text box will include a bold, justify, italics and code button.

In edit mode that the teacher will be presented with a single text box to enter the model answer.  

#### UI Improvements
none yet.

## submissions
The submission is stored in the submission table, 
- activity_id
- user_id
- created_at
- body JSON field {answer_chosen, is_correct, ai_model_score, teacher_override_score}

