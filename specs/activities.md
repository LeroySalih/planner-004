
# Assignment Results Dashboard – Clarifications

## Change 
25-10-17 03:24    Added is_summative property to activity
25-10-13 15:56    Added Activity Scoring Section


# Short Answer Activities Specifications
This file contains the specifications for all activities

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



## Description
1. **Data assembly**: Build the pupil × activity matrix in server actions using the existing Supabase queries/helpers; defer introducing database views until optimisation is required.
2. **Score bands**: Apply green styling for scores >0.7, red for scores <0.3, and yellow for all remaining values.
3. **Persistence**: Record manual score overrides using the current assignments tables; no new Supabase relations are required.
4. **Override range**: Teachers can override scores with any value between 0 and 1 inclusive.
5. **Audit metadata**: Tracking “last modified” data is not a priority for the initial release.
6. **Activity visibility**: Exclude activities that do not produce scores (e.g., text prompts, image displays) from the results matrix. Scorable activities without marks yet should render as grey cells.
7. **Performance envelope**: Target implementation now and revisit virtualization/pagination thresholds once we have clearer data on group sizes and activity counts.
8. **Common Meta Data** All activities will incldue the following meta properties
- is_homework: Boolean to indicate whether this acticvity is a homework and will appear on the pupils homework list.
- _is_summative: Boolean to indicate whether this acitvity is an assessment and their score should contribute to the unit score.  Add a switch to the short activity view to allow the user to edit and display the status of summative.