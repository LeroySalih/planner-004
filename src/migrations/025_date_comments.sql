CREATE TABLE public.date_comments (
    date_comment_id text DEFAULT gen_random_uuid() NOT NULL,
    comment_date date NOT NULL,
    comment text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.date_comments
    ADD CONSTRAINT date_comments_pkey PRIMARY KEY (date_comment_id);
