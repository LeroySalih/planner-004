-- Create roles table
CREATE TABLE public.roles (
    role_id text NOT NULL PRIMARY KEY,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create user_roles table
CREATE TABLE public.user_roles (
    user_id text NOT NULL,
    role_id text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES public.roles(role_id) ON DELETE CASCADE
);

-- Seed initial roles
INSERT INTO public.roles (role_id, description) VALUES
    ('teacher', 'Access to curriculum, units, assignments, groups, and reports.'),
    ('pupil', 'Access to My Units and Dashboard.'),
    ('technician', 'Access to the Queue.'),
    ('admin', 'Access to role administration and user management.');

-- Migrate existing teacher flags to roles
INSERT INTO public.user_roles (user_id, role_id)
SELECT user_id, 'teacher'
FROM public.profiles
WHERE is_teacher = true;

-- Migrate existing non-teacher flags to pupil roles (assuming non-teachers are pupils initially)
INSERT INTO public.user_roles (user_id, role_id)
SELECT user_id, 'pupil'
FROM public.profiles
WHERE is_teacher = false;

-- Bootstrap initial admin
INSERT INTO public.user_roles (user_id, role_id)
SELECT user_id, 'admin'
FROM public.profiles
WHERE email = 'leroysalih@bisak.org'
ON CONFLICT DO NOTHING;
