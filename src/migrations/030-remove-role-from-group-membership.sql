-- Remove role column from group_membership as roles are now global
ALTER TABLE public.group_membership DROP COLUMN role;
