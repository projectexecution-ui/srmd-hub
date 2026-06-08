-- Persistent mapping between a BPH project (in budget_hub_state.state.projects)
-- and a Cost Control project (public.projects). When the PM commits their
-- first BPH pull we save the pair here, and from then on the /api/budget-hub
-- state route auto-runs the pull for every mapped pair on every save —
-- no more weekly clicks.

CREATE TABLE IF NOT EXISTS public.cc_bph_project_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bph_project_id  TEXT NOT NULL,
  cc_project_id   UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  last_pulled_at  TIMESTAMPTZ,
  last_pull_result JSONB,
  UNIQUE (bph_project_id),
  UNIQUE (cc_project_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_bph_links_cc_proj ON public.cc_bph_project_links (cc_project_id);

COMMENT ON TABLE public.cc_bph_project_links IS
  'One-to-one mapping between a BPH project (text id inside budget_hub_state.state.projects) and a CT Hub project. After the first manual pull, this powers auto-sync on every /budget save.';

ALTER TABLE public.cc_bph_project_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cc_bph_links_select" ON public.cc_bph_project_links FOR SELECT  TO authenticated USING (true);
CREATE POLICY "cc_bph_links_insert" ON public.cc_bph_project_links FOR INSERT  TO authenticated WITH CHECK (true);
CREATE POLICY "cc_bph_links_update" ON public.cc_bph_project_links FOR UPDATE  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cc_bph_links_delete" ON public.cc_bph_project_links FOR DELETE  TO authenticated USING (true);
