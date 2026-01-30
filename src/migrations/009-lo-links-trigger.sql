-- Create a trigger function to handle updates/inserts on learning_objectives
CREATE OR REPLACE FUNCTION sync_lo_links_trigger() RETURNS TRIGGER AS $$
DECLARE
    ref_part TEXT;
    target_sub_item_id TEXT;
BEGIN
    -- Only proceed if spec_ref has changed (for updates) or is new (insert)
    IF (TG_OP = 'UPDATE' AND NEW.spec_ref IS NOT DISTINCT FROM OLD.spec_ref) THEN
        RETURN NEW;
    END IF;

    -- Clear existing links for this LO
    DELETE FROM lo_links WHERE learning_objective_id = NEW.learning_objective_id;

    -- If spec_ref is null/empty, we are done (links cleared)
    IF NEW.spec_ref IS NULL OR TRIM(NEW.spec_ref) = '' THEN
        RETURN NEW;
    END IF;

    -- Parse the comma-separated spec_ref
    FOREACH ref_part IN ARRAY string_to_array(NEW.spec_ref, ',')
    LOOP
        -- Trim whitespace
        ref_part := TRIM(ref_part);
        
        -- Find matching sub_item by number
        SELECT sub_item_id INTO target_sub_item_id FROM sub_items WHERE number = ref_part LIMIT 1;
        
        IF target_sub_item_id IS NOT NULL THEN
            INSERT INTO lo_links (learning_objective_id, sub_item_id)
            VALUES (NEW.learning_objective_id, target_sub_item_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists to be safe
DROP TRIGGER IF EXISTS trg_sync_lo_links ON learning_objectives;

-- Create the trigger
CREATE TRIGGER trg_sync_lo_links
AFTER INSERT OR UPDATE OF spec_ref ON learning_objectives
FOR EACH ROW
EXECUTE FUNCTION sync_lo_links_trigger();

-- Run one-time sync to catch any manual changes made since last migration
SELECT refresh_lo_links();
