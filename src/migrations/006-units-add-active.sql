-- ============
-- Add active column to units table
-- ============
ALTER TABLE units ADD COLUMN active BOOLEAN DEFAULT TRUE;
UPDATE units SET active = TRUE;