Plan: optimize /units for single profile fetch, direct PG reads, and more SSR

Goals:
- Use one teacher profile fetch per /units request and pass it downstream.
- Switch units/subjects reads to the pg client (no Supabase) with server-side filtering/shaping.
- Reduce client work on the units page; render data on the server and keep only small client widgets for interactions.

Steps:
1) Wire units page to fetch requireTeacherProfile once and pass currentProfile into units/subjects actions; update actions to accept an optional currentProfile.
2) Replace Supabase with pg client in readUnitsAction/readUnitAction/readSubjectsAction; add server-side filtering (search, subject, active toggle) shaped for the UI.
3) Update /units page to perform filtering on the server from searchParams (q, subject, showInactive) and render the units list server-side; keep only small client widgets (search/filter controls, create sidebar triggers).
4) Trim UnitsPageClient to minimal state (open/close, form inputs) and rely on server-provided units/subjects; avoid client-side filtering copies.
5) Keep Supabase only where necessary (e.g., auth admin flows, if any) and ensure telemetry/logging still wraps the pg queries.
6) Validate build and fix TypeScript/runtime issues after refactor.
