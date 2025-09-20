-- (Optional but recommended) ensure the column doesn't default to 0
-- ALTER TABLE lessons ALTER COLUMN order_by DROP DEFAULT;

CREATE OR REPLACE FUNCTION set_lessons_order_by()
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
  PERFORM pg_advisory_xact_lock(hashtext('lessons.order_by'));

  SELECT COALESCE(MAX(order_by), 0) + 1
    INTO next_order
  FROM lessons;

  NEW.order_by := next_order;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_lessons_order_by ON lessons;
CREATE TRIGGER trg_set_lessons_order_by
BEFORE INSERT ON lessons
FOR EACH ROW
EXECUTE FUNCTION set_lessons_order_by();