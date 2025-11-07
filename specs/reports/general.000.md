# Reports – Specifications

## Change List
25-10-20 18:04 Changed /reports/groups/group_id to allow pupil name to link to /reports/pupil_id

## Description.

This file describes the reports pages


### /reports
This page is a list of pupils and the groups that the pupil belongs to.
The page is primarily a navigation page to other paths.

The pupil name links to reports/pupil_id
Each group id links to reports/groups/group_id

There is a filter to allow the teacher to find either all pupils in a group, or a specific pupil by name.

### /reports/pupil_id

This page is an online report card for the specific pupil.  The page is a list of subjects for the pupil, within which is a list of units.

Each unit will display:
- Title (links to /reports/pupil_id/units/unit_id)
- Description
- Activities %
- Assessment % (if available)
- Level (If Avialable)

There should not be any 

### /reports/pupil_id/units/unit_id

This page gives the details of a pupils total and assessment score for a given unit.

The page will list the learning objectives and success criteria that are linked to a unit.
The pupil specific total and assessment scores will be shown for each success criteria (where available)

### /reports/groups/group_id

This page will list all pupils as rows, where the columns are the assessment score and level for each unit of work that has been linked with a group through the assignments table.

The pupils names and scores rows and columns will be  fixed so that they can be easily scrolled.

Pupils shoudl be sorted by last name.

The pupil name in the grid should link to reports/pupil_id

