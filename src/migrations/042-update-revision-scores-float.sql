-- Update revision_answers score column to support decimals
ALTER TABLE revision_answers 
ALTER COLUMN score TYPE real USING score::real;

-- Update revisions total_score column to support decimals
ALTER TABLE revisions 
ALTER COLUMN total_score TYPE real USING total_score::real;
