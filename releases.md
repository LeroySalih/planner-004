# Releases

## 0.0.10 — 2025-10-10
- Added sanitized success-criterion formatting so Levels and Units tabs show clean SC text without duplicated LO titles.
- Introduced a DOCX export workflow for the Levels view, including a server route that renders level tables with AO bullet lists and a client-side download button.
- Shared export helpers for consistent filenames and wired in the `docx` dependency to support the new document generation.
