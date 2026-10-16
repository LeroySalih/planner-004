-- 118-must-change-password.sql
--
-- A user whose password is the shared default must choose their own before
-- using DINO. The flag is set:
--   * here, for every account still on the column's default hash;
--   * at sign-in, for anyone who signs in with the default password (a reset
--     re-hashes it with a new salt, so those accounts can't be found by hash);
--   * when a teacher resets a password to the default.
-- It is cleared when the user sets a password of their own.

begin;

alter table profiles
  add column if not exists must_change_password boolean not null default false;

-- profiles.password_hash's column default is the default password's hash.
update profiles p
   set must_change_password = true
  from information_schema.columns c
 where c.table_schema = current_schema()
   and c.table_name = 'profiles'
   and c.column_name = 'password_hash'
   and p.password_hash = trim(both '''' from split_part(c.column_default, '::', 1));

commit;
