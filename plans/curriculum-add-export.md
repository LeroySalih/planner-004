# Add export button

## Objectives
- Tidy the Levels Output view so success criteria do not duplicate their learning objective titles.
- Provide a downloadable DOCX export that mirrors the Levels Visualization data.

## Workplan
1. Centralize string helpers to strip learning objective prefixes from success criteria.
2. Update the Levels Output and Units Output views to use the cleaned descriptions.
3. Build a DOCX export endpoint that reuses the cleaned success criteria and groups them by level.
4. Surface an Export DOCX button in the Levels tab that triggers the server export and downloads the file for the user.
