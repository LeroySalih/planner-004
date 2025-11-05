# Plan: Simplify Lesson List Row Layout

## Scope
- Update the UI for lessons shown in the Unit Lessons panel so each row only displays: drag handle, lesson title, “Show activities” button, and “Details” button.
- Remove the inline “Edit” button and collapse the expandable detail section unless explicitly opened elsewhere.
- Ensure pending/async placeholders introduced by the async creation flow continue to behave correctly with the new layout.

## Tasks
1. **Audit Current Rendering**
   - Review `LessonsPanel` list markup (pending badges, expanded sections, buttons) and note all props passed to child components (`LessonSidebar`, activities/resources sidebars).
   - Confirm there are no external dependencies on the edit button or the inline detail toggle.

2. **Update LessonsPanel List Rows**
   - Strip the detail toggle logic; render a compact row with drag handle + title and the two buttons aligned right.
   - Preserve the “Pending” badge for async-created lessons and ensure drag handle styles still convey draggable state.
   - Remove detail DOM nodes and any state (`expandedLessons`, toggles) that become unused.

3. **Adjust Dependent Interactions**
   - Ensure opening edit workflows still works via existing sidebars (e.g., clicking a lesson row or separate entry points).
   - Verify removal of detail sections doesn’t break activity/resource actions; keep buttons or entry points accessible elsewhere.

4. **Clean Up Supporting Code**
   - Drop unused state or helper functions related to the old detail view (`toggleLessonDetails`, `detailsSectionId`, etc.).
   - Re-check TypeScript types and imports; remove anything no longer referenced.

5. **Validation**
   - Manual pass through `/units/[unitId]` ensuring:
     - Lessons display in intended simplified format.
     - Drag-and-drop ordering works.
     - “Show activities” and “Details” buttons remain functional.
     - Async lesson creation still queues and swaps placeholders correctly.

## Notes
- No changes required to server actions or async job logic; this is a pure UI/layout update.
- Update `specs/units/spec.000.md` after implementation if layout details change further.
