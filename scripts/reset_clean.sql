-- Reset non-auth data while preserving profile and auth records.
-- Run against the primary database; it truncates every table outside the auth schema
-- except for public.profiles. All other public/storage/etc tables are wiped.

begin;

do
$$
declare
  tbl record;
begin
  for tbl in
    select table_schema, table_name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema not in ('pg_catalog', 'information_schema', 'auth')
      and not (table_schema = 'public' and table_name = 'profiles')
      and not (table_schema = 'public' and table_name = 'subjects')
      and not (table_schema = 'public' and table_name = 'auth_sessions') -- keep sessions
  loop
    execute format('truncate table %I.%I restart identity cascade;', tbl.table_schema, tbl.table_name);
  end loop;
end
$$;

commit;
