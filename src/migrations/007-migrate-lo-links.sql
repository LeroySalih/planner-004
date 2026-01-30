-- Migrate existing learning objectives to link to sub_items based on spec_ref
UPDATE learning_objectives lo
SET sub_item_id = si.sub_item_id
FROM sub_items si
WHERE lo.spec_ref = si.number
AND lo.sub_item_id IS NULL;
