# /profile/groups

## ChangeLog
2025-10-31 15:18 Requesting that components are pure server components.
2025-10-31 19:16 Add useActionState to allow the user to know that the Join Group and Leav Group buttons are being processed.

## Purpose
The purpose of this page is to allow teachers and pupils to add and remove themselves from groups.

## Page Components
1. Join Group Panel.
- the join group panel allows teachers and pupils to joint groups.
- If the user clicks the Join Group button, add a spinner to the button to show that the process is running.
- users will enter the join code in the Enter Code text box.
- The users will then click Join group.
    - If the group exists, the user will be added to the group.
    - If the group does not exist, the user will be notified that the group does not exist.

2. Group Membership Panel.
- List the groups the the current suer is a member of.
- Each group will have a leave group butto,
- if the user clicks the leave join button, the user is removed from the group.
- All data for the user and group remains in place.
- If the user leaves the group and rejoins, all of the existing data is still applicable.
- If the user clicks the Leave Group button, add a spinner to the button to show that the process is running.

## General Guidance.
Where possible, components should be pure server components.

