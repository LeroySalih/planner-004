# Pupil Tracking.


# Description

Pupil sign-ins flow through a new `pupil_sign_in_history` table backed directly by our Postgres schema (no Supabase client).  Each entry stores the pupil id, the exact request URL (including the query string), and the timestamp.

Only authenticated pupils (non-teachers) count, and a log is created only when Next.js renders an HTML page (GET requests with an `Accept` header that includes `text/html`).  The middleware captures the full `request.nextUrl.href` string at render time and records the event along with telemetry; we expect the data to be queried via SQL tooling, so no UI surface is required.
