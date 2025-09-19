-- ============
-- Add active column to assignments table
-- ============
ALTER TABLE assignments ADD COLUMN active BOOLEAN DEFAULT TRUE;
UPDATE assignments SET active = TRUE;