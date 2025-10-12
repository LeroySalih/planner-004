# Assignment Results Dashboard – Clarifications

1. **Data assembly**: Build the pupil × activity matrix in server actions using the existing Supabase queries/helpers; defer introducing database views until optimisation is required.
2. **Score bands**: Apply green styling for scores >0.7, red for scores <0.3, and yellow for all remaining values.
3. **Persistence**: Record manual score overrides using the current assignments tables; no new Supabase relations are required.
4. **Override range**: Teachers can override scores with any value between 0 and 1 inclusive.
5. **Audit metadata**: Tracking “last modified” data is not a priority for the initial release.
6. **Activity visibility**: Exclude activities that do not produce scores (e.g., text prompts, image displays) from the results matrix. Scorable activities without marks yet should render as grey cells.
7. **Performance envelope**: Target implementation now and revisit virtualization/pagination thresholds once we have clearer data on group sizes and activity counts.
