
ALTER TABLE profiles
ADD COLUMN is_teacher boolean DEFAULT false;

UPDATE profiles
SET is_teacher = false;

UPDATE profiles
SET is_teacher = true
WHERE first_name = 'Leroy';
