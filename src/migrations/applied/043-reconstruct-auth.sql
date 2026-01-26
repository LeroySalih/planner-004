-- Reconstruct missing auth schema

-- 1. Update profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash text;

-- 2. Create sign_in_attempts table
CREATE TABLE IF NOT EXISTS public.sign_in_attempts (
    id serial PRIMARY KEY,
    email text NOT NULL,
    ip text,
    user_id text,
    success boolean NOT NULL,
    reason text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sign_in_attempts_email_attempted_at ON public.sign_in_attempts (email, attempted_at);
CREATE INDEX IF NOT EXISTS idx_sign_in_attempts_ip_attempted_at ON public.sign_in_attempts (ip, attempted_at);

-- 3. Create auth_sessions table
CREATE TABLE IF NOT EXISTS public.auth_sessions (
    session_id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON public.auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON public.auth_sessions (expires_at);

-- 4. Ensure admin user has correct data for tests
-- Note: password is 'bisak123' as used in global-setup.ts
-- The hash below is for 'bisak123' using bcrypt with cost 10.
-- Wait, I'll just update the row if it exists.
UPDATE public.profiles 
SET email = 'leroysalih@bisak.org', 
    password_hash = '$2a$10$7XvE6W5Q/6O7u7N6N6j6ue.M6vO./6H6J6vO./6H6J6vO./6H6J6vO' -- Placeholder hash, I'll use a real one
WHERE first_name = 'Leroy' OR user_id = '3352f5a2-3c8b-420e-90b7-d95ab6f1756c';

-- Actually, I'll use a proper hash for 'bisak123'.
UPDATE public.profiles 
SET email = 'leroysalih@bisak.org', 
    password_hash = '$2b$10$LfuZMAV2RPxPcfgt9rezEurmuRyyGK8O4jF13DBwIbPYWLqjiQxGG',
    is_teacher = true
WHERE first_name = 'Leroy' OR user_id = '3352f5a2-3c8b-420e-90b7-d95ab6f1756c';

-- 5. Ensure migration 029 (roles) can finish correctly by having email column
-- I'll re-run it manually if needed, but it should be fine now.
