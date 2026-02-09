-- Migration: Add performance indexes for real-time reporting
-- Author: Claude Code
-- Date: 2026-02-09
-- Description: Adds indexes to optimize on-the-fly aggregation queries
--              for unit progress reports and LO progress reports.

-- Index for pupil_activity_feedback queries
-- Optimizes: Unit progress reports (getClassProgressAction, getProgressMatrixAction, etc.)
CREATE INDEX IF NOT EXISTS idx_paf_pupil_activity
ON pupil_activity_feedback(pupil_id, activity_id);

-- Index for feedback queries with latest rating lookup
-- Optimizes: LO progress reports (getLOProgressMatrixAction, getClassLOMatrixAction, etc.)
-- The DESC on id helps with DISTINCT ON queries to get latest feedback
CREATE INDEX IF NOT EXISTS idx_feedback_user_criteria_id
ON feedback(user_id, success_criteria_id, id DESC);

-- Additional index for activity-based feedback queries
-- Optimizes: Queries that join activities to pupil_activity_feedback
CREATE INDEX IF NOT EXISTS idx_paf_activity_id
ON pupil_activity_feedback(activity_id);

-- Index for feedback success_criteria lookups
-- Optimizes: Queries that filter or join on success_criteria_id
CREATE INDEX IF NOT EXISTS idx_feedback_success_criteria_id
ON feedback(success_criteria_id);
