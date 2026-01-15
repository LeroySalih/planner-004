-- Create AI Marking Logs table
CREATE TABLE IF NOT EXISTS public.ai_marking_logs (
    log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    level text NOT NULL DEFAULT 'info',
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add index for performance on recent logs
CREATE INDEX IF NOT EXISTS idx_ai_marking_logs_created_at ON public.ai_marking_logs (created_at DESC);

-- Optional: Pruning logic could also be applied here later.
