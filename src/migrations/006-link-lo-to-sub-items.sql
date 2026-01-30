-- Add sub_item_id to learning_objectives to link to specifications
ALTER TABLE learning_objectives
ADD COLUMN sub_item_id TEXT REFERENCES sub_items(sub_item_id);

-- Add index for performance
CREATE INDEX idx_learning_objectives_sub_item_id ON learning_objectives(sub_item_id);
