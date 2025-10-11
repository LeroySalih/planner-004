## Goal
Implement the new Feedback activity so teachers can configure per-group visibility of submission results and pupils can review outcomes when permitted.

## Clarifications
- Scores: MCQ submissions map to 0 (incorrect) or 1 (correct); other activities rely on their existing numeric `score` property.
- Correct answers: currently supported for MCQ and File Upload submissions; future activities with submissions should integrate similarly.
- Short mode text: display `Not enabled for group <group_id>` for each group where the activity is disabled.
- Disabled presentation: pupils still see the activity title plus the message `Not enabled for group <group_id>` when the setting is off.

## Planned Work
1. **Schema & Types** – Extend the feedback activity body schema to include a `groups` map keyed by `group_id` with `isEnabled`, `showScore`, and `showCorrectAnswers` booleans; update related TypeScript helpers and validators, ensuring the structure supports both MCQ and File Upload submissions.
2. **Server Utilities** – Adjust activity load/save helpers and server actions to read/write the new body shape and expose per-group settings alongside lesson assignments.
3. **Teacher Edit UI** – Add a grid editor in `lesson-activities-manager` that lists assigned groups with toggles for the three settings, round-trip the values through existing save flows, and surface “Not enabled” messaging.
4. **Short/Present Views** – Teach the activity view component to summarise per-group enablement (including `Not enabled for group <group_id>`), and in present mode render submissions, average scores (0/1 for MCQ; `score` for other activities), and correct answers when the relevant toggles are set.
5. **Supporting Helpers** – Implement utilities to aggregate submissions, calculate average scores for MCQ and other activities, and extract correct answers across supported activity types while respecting the configuration flags.
6. **Testing** – Add Playwright coverage for teacher configuration and pupil viewing scenarios, plus targeted unit tests for submission aggregation and configuration parsing.
