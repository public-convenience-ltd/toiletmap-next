-- Lets the admin feedback inbox (/admin/feedback) delete messages.
--
-- The worker connects as toiletmap_web, which until now could only SELECT and
-- INSERT feedback (20240823182342_feedback_table.sql). Deleting is limited to
-- the admin pages by the application (requireAdminAuth + requireAdminRole);
-- the public POST /api/feedback route only inserts.
--
-- Additive and idempotent: a grant plus a DELETE policy alongside the existing
-- select_policy / insert_policy. Rollback:
--   DROP POLICY IF EXISTS delete_policy ON public.feedback;
--   REVOKE DELETE ON TABLE public.feedback FROM toiletmap_web;

GRANT DELETE ON TABLE public.feedback TO toiletmap_web;

DROP POLICY IF EXISTS delete_policy ON public.feedback;
CREATE POLICY delete_policy ON public.feedback
    FOR DELETE
    TO toiletmap_web
    USING (true);
