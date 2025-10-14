# Short Answer Activities Specifications
This file contains the specifications for all activities

# Change Log.
25-10-13 15:56 Added Activity Scoring Section

## Description.

A lesson has multiple acivities of various types.
An activity can be linked to multiple success criteria.  This relationship is stored in the activity_succes_criteria table.

## Activity Scoring

Each actvity can record a score against each success criteria that has been associated with the activity.  This means that an activity with 2 success criteria, with have 2 scores, ranging from 0 to 1.

When an activity score is calculted, as in the Multiple Choice Question or Short Text score, the same score is applied to all success criteria linked to the acitvity.

A teacher has the abiity to override the individual scores for each success criteria through the edit side bar. 

Null or empty scores are counted as 0 for the purposed of average calculations.

### Data and Keys


### Short Mode.

The success criteria for the current activity are selected.

### Present Mode.


### Edit Mode.
In edit mode, all activities have a title, and a select check box of the success criteria that are linked to the current lesson.  The teacher is able to select multiple success criteria for an activity.



#### UI Improvements
none yet.

## submissions
