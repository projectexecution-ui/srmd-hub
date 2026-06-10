-- Tighten cc_bph_project_links write policies. Previously USING(true)/
-- WITH CHECK(true) let any authenticated user create/remap/delete BPH↔CT
-- mappings (e.g. redirect another project's auto-sync). Reads stay open
-- (the freshness chip + mapping list need them), but writes now require
-- cost-control admin — consistent with cc_budget_lines (cc_bl_admin_write),
-- which is also admin-only, so only admins ever successfully pull anyway.

DROP POLICY IF EXISTS "cc_bph_links_insert" ON public.cc_bph_project_links;
DROP POLICY IF EXISTS "cc_bph_links_update" ON public.cc_bph_project_links;
DROP POLICY IF EXISTS "cc_bph_links_delete" ON public.cc_bph_project_links;

CREATE POLICY "cc_bph_links_insert"
  ON public.cc_bph_project_links
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_cc_is_admin(auth.uid()));

CREATE POLICY "cc_bph_links_update"
  ON public.cc_bph_project_links
  FOR UPDATE TO authenticated
  USING (public.fn_cc_is_admin(auth.uid()))
  WITH CHECK (public.fn_cc_is_admin(auth.uid()));

CREATE POLICY "cc_bph_links_delete"
  ON public.cc_bph_project_links
  FOR DELETE TO authenticated
  USING (public.fn_cc_is_admin(auth.uid()));
