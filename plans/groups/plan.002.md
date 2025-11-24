Plan: optimise /groups flows for direct PG access and single profile fetch

Context:
- Current /groups pages call requireTeacherProfile per page/action; Supabase client per action.
- readGroupsAction already switched to direct pg client.

Steps:
1) Introduce a shared profile fetch in /groups entrypoints: call requireTeacherProfile once per request and pass the profile downstream to server actions instead of re-fetching inside them.
2) Update group-related server actions used by /groups and /groups/[id] to accept an optional currentProfile and skip Supabase auth/profile calls when provided.
3) Replace Supabase usage with pg client for group reads/membership/profile fetches needed on those routes, mirroring existing queries but using the direct connection string.
4) Keep Supabase only where required (e.g., reset pupil password action via auth admin API); note this exception in code comments/specs.
5) Ensure all other group page/server actions invoked from /groups and /groups/[id] use the pg client path (no Supabase) and reuse the single fetched profile.
6) Verify behavior (authorization redirects still occur) and log timings for the pg queries to compare with Supabase path.

Next SSR optimisation steps (to implement):
- Move /groups list rendering to a server component; perform filtering on the server using searchParams.
- Extend readGroupsAction to return only needed fields and member counts via a single pg query.
- Reduce GroupsPageClient to minimal client-only UI (search input, create/edit/delete triggers) and pass actions/server data via props; avoid holding a client copy of the group list.
- Keep /groups/[id] membership list server-rendered; keep buttons as thin client action triggers.
