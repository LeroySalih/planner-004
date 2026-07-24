-- Per-unit AI curriculum-development chat history (teacher-only, experimental).
-- Mirrors lesson_chat_messages but scoped to a unit: the teacher develops the
-- unit's lessons, lesson sequence, learning objectives and success criteria via
-- propose-then-confirm. Each turn we send the model a bounded window of these
-- rows, not the whole history.
CREATE TABLE IF NOT EXISTS public.unit_chat_messages (
    message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id text NOT NULL,
    teacher_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL DEFAULT '',
    -- Assistant proposals (array of lesson / lesson-reorder / learning-objective
    -- / success-criterion specs) for re-rendering the proposal cards when the
    -- chat is reopened. Null for user messages.
    proposals jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unit_chat_messages_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text]))
);

CREATE INDEX IF NOT EXISTS idx_unit_chat_messages_unit
    ON public.unit_chat_messages (unit_id, created_at);
