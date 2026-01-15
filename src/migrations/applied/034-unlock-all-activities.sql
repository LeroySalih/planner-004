-- Migration: Unlock all activities and reset submission statuses
-- This migration ensures that all submissions are in a state where they can be edited (inprogress)
-- and hides feedback so that editing starts from a clean state.

-- 1. Reset all submissions to 'inprogress' and unflag them
UPDATE public.submissions 
SET submission_status = 'inprogress', 
    is_flagged = false;

-- 2. Hide feedback for all lesson assignments
-- In the previous logic, feedback_visible = true caused questions to be locked.
-- Although we have removed this lock in the UI code, resetting this ensures a consistent state.
UPDATE public.lesson_assignments 
SET feedback_visible = false;
