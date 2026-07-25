-- Link a unit to a single curriculum (in addition to its subject).
-- A unit may only be assigned LOs/SCs from this curriculum. The column is
-- nullable: units with no curriculum yet, or flagged multi-curriculum units
-- awaiting admin remediation, leave it null. Backfill + audit is done by
-- scripts/audit-unit-curricula.ts (auto-sets single-curriculum units).
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS curriculum_id text
  REFERENCES public.curricula(curriculum_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_units_curriculum ON public.units (curriculum_id);
