-- 067-add-parent-emails.sql
ALTER TABLE profiles ADD COLUMN father_email text;
ALTER TABLE profiles ADD COLUMN mother_email text;
