# /lessons/lessonId

## ChangeLog

## Purpose
The purpose of this page is to allow teachers to create and design lessons that contribute to units.

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
- The side bar will display all LO and SC for this curriculum (not just those tied to the lesson’s unit).
- Users can check the boxes at SC level to associate an individual SC with a lesson.
- users can click the LO to associate all SC with a lesson.
- remember that lessons are not directly associated with a LO, links are formed through SCs.
- When the side bar opens, any success criteria already linked to the lesson are preselected. Success criteria may be linked to multiple lessons.

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
