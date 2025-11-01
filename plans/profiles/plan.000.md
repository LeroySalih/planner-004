# Plan: `/profiles` profile settings

## Current gaps
- `ProfileForm` is a client component that talks to Supabase directly, violating the “server actions only” guidance and preventing pure server rendering.
- The form only captures first and last name; the spec requires a read-only email field and an explicit teacher-account indicator.
- Submission UI relies on inline text messages, lacks toast-based feedback, and does not show a loading spinner or disable inputs while saving.
- Route components (`/profile` and `/profiles`) do not guard themselves with the shared auth helpers, so unauthenticated access falls back to client-side redirects instead of server enforcement.
- The teacher-facing profile detail view (`src/components/profile/detail.tsx`) still uses the browser Supabase client rather than server actions.

## Proposed steps
1. **Model the profile payload** – define a typed helper (e.g. `CurrentUserProfile` schema) that includes user id, email, first name, last name, and `is_teacher`, sourced from the existing Zod profile schema plus the auth user metadata.
2. **Add server actions** – create `readCurrentProfileAction` and `updateCurrentProfileAction` in a new `src/lib/server-actions/profile.ts`, following the error-handling patterns and re-exporting them from `src/lib/server-updates.ts`.
3. **Rework the form component** – convert `ProfileForm` into a server component that loads the profile via the new read action and renders a small client child using `useActionState` to submit the update action, show a `Loader2` spinner, disable fields, and issue toast success/error notifications.
4. **Update pages** – ensure `/profile` and `/profiles` pages import the revised form, call `requireAuthenticatedProfile()` early, and keep the group-membership navigation link the spec calls for.
5. **Convert profile detail view** – refactor `ProfileDetailForm` into a server component that uses the shared read/update actions (or detail-specific ones if needed) and a slim client wrapper for `useActionState`, matching the UX from the primary profile form.
6. **Retire browser Supabase usage** – remove the Supabase browser client dependency from profile UI modules so all reads/writes flow through the server actions.

## Validation
- Manual: sign in as a teacher and pupil, load `/profiles`, update names, and confirm spinners, disabled fields, and toasts fire appropriately; verify the teacher badge reflects account type.
- Manual: visit `/profiles/[profileId]` as a teacher, edit details, and ensure the server-driven form behaves consistently with the main profile settings flow.
- Regression: refresh the page after saving to confirm persisted data is rendered from the server response without extra client fetches.

## Open questions
- None at present.
