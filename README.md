# Planner 004

Planner 004 is a Next.js prototype for lesson, unit, and curriculum planning workflows. The project exposes a curriculum explorer at `/curriculum` that now reads and persists data against Supabase via server actions.

See [Repository Guidelines](AGENTS.md) for contributor workflows, coding style, and PR expectations.

## Development

```bash
pnpm install
pnpm dev
```

The app runs at http://localhost:3000. The curriculum prototype lives under `/curriculum` and individual curriculum detail pages are served from `/curriculum/:curriculumId`.

## Curriculum Prototype

- Curriculum index renders live data through `readCurriculaAction`.
- Curriculum detail pages fetch nested assessment objectives, learning objectives, and success criteria with `readCurriculumDetailAction`.
- Inline edits for assessment objectives, learning objectives, and success criteria call the curriculum server actions to persist title, level, description, and unit linkage changes.
- Unit chips use real unit metadata; filters accept free text plus `l <level>` and `yr <year>` tokens.

## Manual Smoke Checklist

1. Load `/curriculum` – expect existing curricula ordered by title with description excerpts.
2. Select a curriculum – verify assessment objectives, learning objectives, and success criteria render.
3. Edit a success criterion description and level – confirm optimistic update and persisted change after refresh.
4. Toggle unit associations for a criterion – chips update immediately and survive reload.
5. Add a new learning objective and success criterion – default placeholders appear and persist.
6. Add a new assessment objective – default learning objective and criterion scaffold the new AO.

If a step fails, tail the terminal for server-action logs and ensure Supabase environment variables are configured.

## Notes

- All curriculum mutations are routed through `src/lib/server-actions/curricula.ts` and revalidate the relevant curriculum detail path.
- Server actions enforce basic validation (non-empty codes, titles, and descriptions) before writing to Supabase.
- Feature is still a prototype; keep in mind UI polish and granular error toasts are pending.
