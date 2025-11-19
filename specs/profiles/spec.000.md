# /profile

## ChangeLog

## Purpose
The purpose of this page is to allow teachers and pupils to provide data about their profiles.

## Page Components

### Profile Data Panel
The profile data panel will have the following fields:
- Email
- First Name
- Last Name
- Teacher Account (read only), displays whether the profile is linked to a teacher or not.
- Save changes Button.  When the user clicks the save changes button, the button should display a spinner to show the process in running.  The button and the fields should be disabled while the update process is running.
- If the update process is sucessful, notify the user using a toast.
- If an error occures, notify the user using an error toast.

### Password Panel
- Renders two password inputs (new password, confirm password) and a submit button.
- Button remains disabled until both values match and the password length is at least six characters; enforce the same constraints on the server action to avoid tampering.
- On submit, call the profile password server action via `useActionState`, show pending text on the button, and surface success/error using `sonner` toasts.
- Clearing the fields after a successful change keeps the user from resubmitting the same password unintentionally.

### Other Components
- There is a button to allow the user to navigate to group memberships, which links to the profiles/groups page.


## General Guidance.
Where possible, components should be pure server components.
