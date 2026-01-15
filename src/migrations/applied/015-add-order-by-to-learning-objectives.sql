--- ====================
---  Adding order_by to learning_objectives table
--- ====================

alter table learning_objectives add column order_by integer default null;

-- (Optional but recommended) ensure the column doesn't default to 0
-- ALTER TABLE lessons ALTER COLUMN order_by DROP DEFAULT;

CREATE OR REPLACE FUNCTION set_learning_objectives_order_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_order integer;
BEGIN
  -- If order_by is provided AND positive, respect it; otherwise compute it
  IF COALESCE(NEW.order_by, 0) > 0 THEN
    RETURN NEW;
  END IF;

  -- Concurrency safety: transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('learning_objectives.order_by'));

  SELECT COALESCE(MAX(order_by), 0) + 1
    INTO next_order
  FROM learning_objectives;

  NEW.order_by := next_order;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_learning_objectives_order_by ON learning_objectives;
CREATE TRIGGER trg_set_learning_objectives_order_by
BEFORE INSERT ON learning_objectives
FOR EACH ROW
EXECUTE FUNCTION set_learning_objectives_order_by();

-- Ensure the column exists
ALTER TABLE learning_objectives
ADD COLUMN IF NOT EXISTS order_by integer;

-- Assign incremental numbers based on lesson_id + title order (or any order you prefer)
WITH numbered AS (
    SELECT
        learning_objective_id,
        ROW_NUMBER() OVER (ORDER BY learning_objective_id) AS rn
    FROM learning_objectives
)
UPDATE learning_objectives lo
SET order_by = n.rn
FROM numbered n
WHERE lo.learning_objective_id = n.learning_objective_id;