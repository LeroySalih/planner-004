# User Flow: Pupil Sign Up

This document outlines the end-to-end flow for a new pupil signing up,
completing their profile, and joining a class group.

## Actors

- **Pupil**: A new user who needs to create an account and join a class.

## Preconditions

- The application is running.
- A class group exists with the Join Code: `E7PST` (e.g., Group "25-7A-DT").

## Flow Steps

1. **Start**: User navigates to the application home page (`/`).
2. **Navigation**: User clicks the "Sign in" link in the top navigation or body.
   - _System redirects to `/signin`._
3. **Sign Up Entry**: User clicks the "Sign up" link on the sign-in form.
   - _System redirects to `/signup`._
4. **Account Creation**:
   - User enters a valid **Email Address**.
   - User enters a **Password** (min 6 chars).
   - User enters the same password in **Confirm Password**.
   - User clicks **"Create account"**.
   - _System creates the account and signs the user in._
   - _System redirects to `/profiles` and then immediately to
     `/profiles/[user-id]` (Manage Details)._
5. **Profile Completion**:
   - User sees "Manage your details".
   - User enters **First Name**.
   - User enters **Last Name**.
   - User clicks **"Save details"**.
   - _System updates the user profile._
   - _System displays a success message (e.g., "Profile updated successfully")._
6. **Join Group**:
   - User locates the "Groups" section on the details page.
   - User enters the 5-character **Join Code** (e.g., `E7PST`).
   - User clicks **"Join group"**.
7. **Verification**:
   - _System adds the user to the group._
   - _System displays a success message indicating the group name (e.g., "Joined
     25-7A-DT")._
   - The new group appears in the "Groups" list on the page.

## Automated Test

This flow is covered by the automated test:
`tests/sign-up/pupil-sign-up.spec.ts`.
