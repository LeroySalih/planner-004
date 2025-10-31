# Plan: `/profiles/groups` async feedback affordances

## Objectives
- Surface in-progress feedback on both Join Group and Leave Group actions, per `specs/profiles/groups/spec.000.md`.
- Keep the page a pure server component entrypoint while introducing the minimum client logic needed for spinners.

## Implementation steps
1. **Audit current flow** – confirm `ProfileGroupsManager` already consumes `joinGroupByCodeAction` and `leaveGroupAction`, and identify where form submissions can expose a pending state.
2. **Introduce `useActionState` wrappers** – convert the join and leave forms to client components that wrap the existing server actions with `useActionState`, capturing `{ pending, message }` output to drive button UI.
3. **Add loading indicators** – update the shared `Button` usage so that when `pending` is true we show the spinner (existing primitive or `Loader2` icon) and disable the buttons to prevent duplicate submissions.
4. **Preserve redirects & feedback** – ensure success/error redirects continue to set `searchParams` so the server component displays the banner, and that action state resets on navigation.

## Validation
- Manual: trigger join and leave flows; while the server action is running, verify the buttons display the spinner/disabled state, then confirm success/error banners still appear after redirect.
