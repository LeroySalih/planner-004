CREATE TABLE IF NOT EXISTS public.peer_review_comments (
    comment_id text DEFAULT gen_random_uuid() NOT NULL,
    review_activity_id text NOT NULL,
    author_user_id text NOT NULL,
    target_user_id text NOT NULL,
    comment_text text NOT NULL,
    is_flagged boolean DEFAULT false NOT NULL,
    flagged_at timestamptz,
    created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
    CONSTRAINT peer_review_comments_pkey PRIMARY KEY (comment_id)
);

CREATE INDEX IF NOT EXISTS idx_prc_review_activity ON public.peer_review_comments (review_activity_id);
CREATE INDEX IF NOT EXISTS idx_prc_target_user ON public.peer_review_comments (target_user_id);
