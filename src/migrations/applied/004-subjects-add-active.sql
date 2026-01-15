-- ============
-- Add active column to subjects table
-- ============
ALTER TABLE subjects ADD COLUMN active BOOLEAN DEFAULT TRUE;
UPDATE subjects SET active = TRUE;