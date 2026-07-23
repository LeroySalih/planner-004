-- Generalized external-service job queue.
--
-- Tracks every interaction with an external service (Gotenberg document
-- conversion, n8n AI marking) and the processing of inbound webhook responses,
-- so all external I/O flows through one observable, retryable pathway.
--
-- job_type examples:
--   'doc_convert'   -> Gotenberg docx/doc -> PDF -> JPEGs for a worksheet asset
--   'webhook_apply' -> apply an inbound AI-mark webhook payload
--   'ai_mark'       -> (future) outbound AI marking request
CREATE TABLE IF NOT EXISTS public.external_jobs (
    job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    result jsonb,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    last_error text,
    process_after timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT external_jobs_status_check
        CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'error'::text]))
);

-- Claim index: fetch the next runnable pending jobs cheaply.
CREATE INDEX IF NOT EXISTS idx_external_jobs_claim
    ON public.external_jobs (process_after)
    WHERE status = 'pending';

-- Observability: list/filter jobs by type and status.
CREATE INDEX IF NOT EXISTS idx_external_jobs_type_status
    ON public.external_jobs (job_type, status);
