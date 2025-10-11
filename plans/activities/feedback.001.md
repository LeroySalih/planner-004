## Spec Updates
- Present mode must refresh scores whenever a pupil updates a submission so teachers/pupils immediately see the new results.
- The average score is now a single lesson-level metric: compute it across all submission-producing activities and show it once at the top of the feedback card.

## Plan of Action
1. **Data Refresh Strategy** – Decide how to keep feedback data current when submissions change (e.g. mutate cache after submission actions, add revalidation hooks, or introduce a lightweight polling/subscription mechanism).
2. **Lesson-Level Aggregation** – Extend the submission summary helper/server action to return a global lesson average in addition to per-activity details, ensuring it covers all submission-backed activities.
3. **Present Mode UI** – Update the feedback presenter to display the new lesson average at the card header and to re-render when fresh data is pulled after pupil submissions.
4. **Client Integration** – Wire pupil submission flows (MCQ, uploads, future types) to trigger the feedback refresh routine so the panel reflects updates instantly.
5. **Verification** – Add/update automated coverage to confirm the average reflects all activities and that post-submission updates surface without a full page reload.
