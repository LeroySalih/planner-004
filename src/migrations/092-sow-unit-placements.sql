-- 092-sow-unit-placements.sql
--
-- Let a teacher lay units out across the half-terms of a scheme of work by
-- hand, and annotate them.
--
-- Until now the summary grid at the top of /sow/[groupId] was entirely
-- derived: readSowHalfTermUnitsAction computes it from planner_assignments,
-- so a unit only appeared once its lessons were actually timetabled. That is
-- a read-out of the timetable, not a plan — there was nowhere to say "Python
-- goes in H2" before scheduling it. This is the first stored SoW planning
-- data.
--
-- Placement is organisational only. Nothing reads these tables except the
-- grid; they do not affect timetabling, marking, reporting or pupil-facing
-- pages.
--
-- Requires 091-chat-call-log-index.sql.

BEGIN;

-- Keyed on the half-term NAME, not half_terms.id, deliberately.
--
-- The grid always draws H1..H6, but a half_terms row only exists once someone
-- has configured its dates at /admin/half-terms. Keying on the id would mean
-- a teacher cannot plan into H5 until an admin has set H5's dates — planning
-- would block on admin setup, which is backwards. The cost is no foreign key
-- to half_terms, and a cell whose dates are unset can hold planned units but
-- can never show a timetabled one, because there are no dates to match
-- lessons against.
CREATE TABLE IF NOT EXISTS public.sow_unit_placements (
  placement_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       text NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
  year           integer NOT NULL,
  half_term_name text NOT NULL,
  unit_id        text NOT NULL REFERENCES public.units(unit_id) ON DELETE CASCADE,
  -- Ordering among planned units only. Timetabled units are ordered by the
  -- week their lessons fall in, which is derived and needs no column here.
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,

  CONSTRAINT sow_unit_placements_half_term_check
    CHECK (half_term_name IN ('H1', 'H2', 'H3', 'H4', 'H5', 'H6')),
  -- One placement of a given unit per cell. Placing a unit that is already
  -- there is a no-op, not a duplicate chip.
  CONSTRAINT sow_unit_placements_unique
    UNIQUE (group_id, year, half_term_name, unit_id)
);

CREATE INDEX IF NOT EXISTS sow_unit_placements_group_year_idx
  ON public.sow_unit_placements (group_id, year);

COMMENT ON TABLE public.sow_unit_placements IS
  'Units a teacher has planned into a half-term by hand. Organisational only — nothing outside the /sow summary grid reads this. A unit also appears in the grid automatically when its lessons are timetabled to the group; that route is derived from planner_assignments and is not stored here.';

-- Notes are their own table rather than a column on the placement above.
--
-- A note can be attached to any unit in the grid, including one that appears
-- because its lessons are timetabled and so has no placement row. Hanging the
-- note off a placement would mean a note written while planning vanished the
-- moment the unit went green — which is exactly when a teacher is most likely
-- to have something to say about it.
CREATE TABLE IF NOT EXISTS public.sow_unit_notes (
  note_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       text NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
  year           integer NOT NULL,
  half_term_name text NOT NULL,
  unit_id        text NOT NULL REFERENCES public.units(unit_id) ON DELETE CASCADE,
  note           text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,

  CONSTRAINT sow_unit_notes_half_term_check
    CHECK (half_term_name IN ('H1', 'H2', 'H3', 'H4', 'H5', 'H6')),
  CONSTRAINT sow_unit_notes_unique
    UNIQUE (group_id, year, half_term_name, unit_id)
);

CREATE INDEX IF NOT EXISTS sow_unit_notes_group_year_idx
  ON public.sow_unit_notes (group_id, year);

COMMENT ON TABLE public.sow_unit_notes IS
  'One free-text note per unit per half-term per group, for either a planned or a timetabled unit. Clearing the text deletes the row rather than storing an empty string, so "has a note" is simply the row existing.';

COMMIT;
