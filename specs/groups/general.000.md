# Groups – Specifications

## /groups/[groupId]
- Teachers can view membership lists that include each pupil's display name and Supabase user ID.
- Every pupil list item exposes management actions rendered as server-powered `<form>` submissions so the page stays server-only.
- The `Reset password` control must call the service-role server action so teachers can immediately assign the fallback password `bisak123` to the selected pupil without leaving the page; failures need to bubble an error.
- The existing `Remove` action continues to delete the membership row while revalidating `/groups` and the specific group detail route.
- Both actions surface success/error toasts (via `sonner`) and keep their buttons in a pending state while the server request processes (implemented with `useActionState`) so teachers know exactly when the request completed or failed.
