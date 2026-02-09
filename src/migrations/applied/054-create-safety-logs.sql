-- Create safety_logs table to separate AI safety blocks from pupil submissions
CREATE TABLE IF NOT EXISTS safety_logs (
    safety_log_id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    activity_id TEXT REFERENCES activities(activity_id) ON DELETE SET NULL,
    lesson_id TEXT REFERENCES lessons(lesson_id) ON DELETE SET NULL,
    prompt TEXT,
    ai_model_feedback TEXT,
    request_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_safety_logs_user_id ON safety_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_safety_logs_created_at ON safety_logs(created_at DESC);
