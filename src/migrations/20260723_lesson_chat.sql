-- Per-lesson AI activity-authoring chat history (teacher-only, experimental).
-- Stores the conversation so a teacher can resume where they left off. What we
-- send to the model each turn is a bounded window of these rows, not the whole
-- history.
CREATE TABLE IF NOT EXISTS public.lesson_chat_messages (
    message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id text NOT NULL,
    teacher_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL DEFAULT '',
    -- Assistant proposals (array of MCQ/STQ activity specs) for re-rendering the
    -- proposal cards when the chat is reopened. Null for user messages.
    proposals jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lesson_chat_messages_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text]))
);

CREATE INDEX IF NOT EXISTS idx_lesson_chat_messages_lesson
    ON public.lesson_chat_messages (lesson_id, created_at);
