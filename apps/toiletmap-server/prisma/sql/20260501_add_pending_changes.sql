-- Identical to supabase/migrations/20260501000000_add_pending_change.sql
-- Apply via: pnpm --filter toiletmap-server supabase:reset

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

ALTER TABLE IF EXISTS public.pending_change OWNER TO postgres;
GRANT ALL ON TABLE public.pending_change TO anon;
GRANT ALL ON TABLE public.pending_change TO authenticated;
GRANT ALL ON TABLE public.pending_change TO service_role;
GRANT ALL ON TABLE public.pending_change TO postgres;

GRANT SELECT, INSERT, UPDATE ON TABLE public.pending_change TO toiletmap_web;

ALTER TABLE public.pending_change ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_policy ON public.pending_change
    FOR SELECT
    TO toiletmap_web
    USING (true);

CREATE POLICY insert_policy ON public.pending_change
    FOR INSERT
    TO toiletmap_web
    WITH CHECK (true);

CREATE POLICY update_policy ON public.pending_change
    FOR UPDATE
    TO toiletmap_web
    USING (true)
    WITH CHECK (true);
