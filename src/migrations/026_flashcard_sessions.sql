CREATE TABLE public.flashcard_sessions (
    session_id text DEFAULT gen_random_uuid() NOT NULL,
    pupil_id text NOT NULL,
    lesson_id text NOT NULL,
    status text DEFAULT 'in_progress' NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    total_cards integer NOT NULL,
    correct_count integer DEFAULT 0
);

ALTER TABLE ONLY public.flashcard_sessions
    ADD CONSTRAINT flashcard_sessions_pkey PRIMARY KEY (session_id);

CREATE INDEX idx_flashcard_sessions_pupil_id ON public.flashcard_sessions (pupil_id);
CREATE INDEX idx_flashcard_sessions_lesson_id ON public.flashcard_sessions (lesson_id);

CREATE TABLE public.flashcard_attempts (
    attempt_id text DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    term text NOT NULL,
    definition text NOT NULL,
    chosen_definition text NOT NULL,
    is_correct boolean NOT NULL,
    attempt_number integer NOT NULL,
    attempted_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.flashcard_attempts
    ADD CONSTRAINT flashcard_attempts_pkey PRIMARY KEY (attempt_id);

ALTER TABLE ONLY public.flashcard_attempts
    ADD CONSTRAINT flashcard_attempts_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES public.flashcard_sessions(session_id) ON DELETE CASCADE;

CREATE INDEX idx_flashcard_attempts_session_id ON public.flashcard_attempts (session_id);
