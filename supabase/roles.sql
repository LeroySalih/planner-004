-- supabase/roles.sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cli_login_postgres') then
    create role cli_login_postgres NOLOGIN;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_etl_admin') then
    create role supabase_etl_admin NOLOGIN;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    create role supabase_read_only_user NOLOGIN;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin NOLOGIN;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_replication_admin') then
    create role supabase_replication_admin NOLOGIN;
  end if;
end
$$;