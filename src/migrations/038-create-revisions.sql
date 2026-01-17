-- Create system definitions table for global config
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key text PRIMARY KEY,
    setting_value jsonb NOT NULL
);

-- Create revisions table
CREATE TABLE IF NOT EXISTS revisions (
    revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pupil_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    lesson_id text NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at timestamp with time zone,
    total_score integer DEFAULT 0,
    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted'))
);

-- Create revision answers table
CREATE TABLE IF NOT EXISTS revision_answers (
    answer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id uuid NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
    activity_id text NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
    answer_data jsonb,
    score integer DEFAULT 0,
    feedback text,
    status text NOT NULL DEFAULT 'pending_marking' CHECK (status IN ('pending_marking', 'marked', 'pending_manual')),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(revision_id, activity_id)
);

-- Add indexes
CREATE INDEX idx_revisions_pupil_lesson ON revisions(pupil_id, lesson_id);
CREATE INDEX idx_revision_answers_revision ON revision_answers(revision_id);
