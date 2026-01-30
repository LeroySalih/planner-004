-- Create lo_links join table
CREATE TABLE IF NOT EXISTS lo_links (
  learning_objective_id TEXT NOT NULL REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE,
  sub_item_id TEXT NOT NULL REFERENCES sub_items(sub_item_id) ON DELETE CASCADE,
  PRIMARY KEY (learning_objective_id, sub_item_id)
);
-- Create the parsing function properly
CREATE OR REPLACE FUNCTION refresh_lo_links() RETURNS void AS $$
DECLARE
    row_lo RECORD;
    ref_part TEXT;
    target_sub_item_id TEXT;
BEGIN
    FOR row_lo IN SELECT learning_objective_id, spec_ref FROM learning_objectives WHERE spec_ref IS NOT NULL LOOP
        FOREACH ref_part IN ARRAY string_to_array(row_lo.spec_ref, ',')
        LOOP
            -- Trim whitespace
            ref_part := TRIM(ref_part);
            
            -- Find matching sub_item by number
            SELECT sub_item_id INTO target_sub_item_id FROM sub_items WHERE number = ref_part LIMIT 1;
            
            IF target_sub_item_id IS NOT NULL THEN
                INSERT INTO lo_links (learning_objective_id, sub_item_id)
                VALUES (row_lo.learning_objective_id, target_sub_item_id)
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT refresh_lo_links();
