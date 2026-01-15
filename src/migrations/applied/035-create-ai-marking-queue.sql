-- Create AI Marking Queue table
CREATE TABLE IF NOT EXISTS public.ai_marking_queue (
    queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id text NOT NULL,
    assignment_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT ai_marking_queue_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))
);

-- Add index for performance on status lookups
CREATE INDEX IF NOT EXISTS idx_ai_marking_queue_status ON public.ai_marking_queue (status) WHERE status = 'pending';

-- Add unique constraint to prevent duplicate pending/processing entries for same submission
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_marking_queue_unique_active ON public.ai_marking_queue (submission_id) 
WHERE status = ANY (ARRAY['pending'::text, 'processing'::text]);

-- Note: We use text for submission_id to match the submissions table schema.
-- We don't use a formal FOREIGN KEY here to avoid strict ordering during migrations if needed, 
-- but it's logically linked to submissions.submission_id.
