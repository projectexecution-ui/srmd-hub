-- Daily Sadhana Tracker — updated with scale + text input types

CREATE TABLE IF NOT EXISTS public.sadhana_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  emoji        text        NOT NULL DEFAULT '🙏',
  -- boolean: yes/no toggle
  -- number:  numeric (minutes etc.)
  -- scale:   fixed radio values; unit encodes range e.g. '1-2' or '0-2'
  -- text:    free-text note
  input_type   text        NOT NULL DEFAULT 'boolean'
                             CHECK (input_type IN ('boolean', 'number', 'scale', 'text')),
  unit         text,
  target_value integer,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sadhana_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sadhana_items_owner"
  ON public.sadhana_items FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sadhana_logs (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date    date          NOT NULL DEFAULT CURRENT_DATE,
  item_id     uuid          NOT NULL REFERENCES public.sadhana_items(id) ON DELETE CASCADE,
  done        boolean       NOT NULL DEFAULT false,
  value_num   numeric(10,2),
  value_text  text,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_date, item_id)
);

ALTER TABLE public.sadhana_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sadhana_logs_owner"
  ON public.sadhana_logs FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_sadhana_logs_updated_at
  BEFORE UPDATE ON public.sadhana_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
