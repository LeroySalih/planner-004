-- ============
-- Add active column to groups table
-- ============
ALTER TABLE groups ADD COLUMN active BOOLEAN DEFAULT TRUE;
UPDATE groups SET active = TRUE;