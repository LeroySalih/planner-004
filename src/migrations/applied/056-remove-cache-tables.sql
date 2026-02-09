-- Migration: Remove cache tables and rebuild functions
-- Author: Claude Code
-- Date: 2026-02-09
-- Description: Removes all reporting cache tables as the application now
--              calculates aggregations on-the-fly from raw data tables.

-- Drop cache tables (order matters due to dependencies)
DROP TABLE IF EXISTS public.report_pupil_unit_summaries CASCADE;
DROP TABLE IF EXISTS public.report_pupil_feedback_cache CASCADE;
DROP TABLE IF EXISTS public.report_pupil_cache CASCADE;

-- Drop cache rebuild function (no longer needed)
DROP FUNCTION IF EXISTS public.reports_recalculate_pupil_cache(text) CASCADE;

-- Note: reports_get_prepared_report_dataset() function is kept
-- This function is still useful and will be called directly (not cached)
