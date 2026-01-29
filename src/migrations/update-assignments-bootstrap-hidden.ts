import * as dotenv from "dotenv";
dotenv.config();
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log(
        "Starting migration: Update assignments_bootstrap to include hidden column",
    );

    try {
        const res = await pool.query(`
CREATE OR REPLACE FUNCTION public.assignments_bootstrap() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  result := jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.group_id)
      from (
        select group_id, subject, join_code, coalesce(active, true) as active
        from groups
        where coalesce(active, true) = true
      ) as row_data
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.subject)
      from (
        select subject, coalesce(active, true) as active
        from subjects
        where coalesce(active, true) = true
      ) as row_data
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.group_id, row_data.unit_id, row_data.start_date)
      from (
        select group_id, unit_id, start_date, end_date, coalesce(active, true) as active
        from assignments
        where coalesce(active, true) = true
      ) as row_data
    ), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.title, row_data.unit_id)
      from (
        select unit_id, title, subject, description, year, coalesce(active, true) as active
        from units
      ) as row_data
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.unit_id, row_data.order_by nulls first, row_data.title)
      from (
        select lesson_id, unit_id, title, coalesce(order_by, 0) as order_by, coalesce(active, true) as active
        from lessons
      ) as row_data
    ), '[]'::jsonb),
    'lessonAssignments', coalesce((
      select jsonb_agg(row_to_json(row_data) order by row_data.group_id, row_data.lesson_id)
      from (
        select group_id, lesson_id, start_date, coalesce(hidden, false) as hidden
        from lesson_assignments
      ) as row_data
    ), '[]'::jsonb)
  );

  return result;
end;
$$;
        `);
        console.log("Migration successful:", res);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
