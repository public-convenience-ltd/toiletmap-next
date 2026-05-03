-- Migration: add pending_change table for anonymous submission approval queue
-- Apply to Supabase via: supabase db reset (local) or Supabase dashboard (production)

CREATE TABLE IF NOT EXISTS public.pending_change (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text        NOT NULL CHECK (type IN ('create', 'update')),
  loo_id       char(24),
  payload      jsonb       NOT NULL,
  ip           text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  text,
  reviewed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pending_change_status       ON public.pending_change(status);
CREATE INDEX IF NOT EXISTS idx_pending_change_submitted_at ON public.pending_change(submitted_at);
