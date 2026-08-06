-- Relatable request numbers: per-project running number (AB-001, AB-002, …)
-- instead of the global REQ-YYYY-NNNNN. "AB-014" reads as Admin Block's 14th
-- request. Existing requests keep their old number (the trigger only fires when
-- request_no is blank on insert). Serialized per project via an advisory xact
-- lock so two simultaneous requests for the same project can't grab the same no.
create or replace function public.inv_set_request_no()
returns trigger language plpgsql as $$
declare v_code text; v_n int;
begin
  if new.request_no is null or new.request_no = '' then
    select code into v_code from public.projects where id = new.project_id;
    if v_code is not null and btrim(v_code) <> '' then
      perform pg_advisory_xact_lock(hashtext('inv_req:' || new.project_id::text));
      select count(*) into v_n from public.inv_requests where project_id = new.project_id;
      new.request_no := upper(btrim(v_code)) || '-' || lpad((v_n + 1)::text, 3, '0');
    else
      -- No project on the request → keep the global fallback (never null).
      new.request_no := 'REQ-' || to_char(now(), 'YYYY') || '-'
        || lpad(nextval('public.inv_request_no_seq')::text, 5, '0');
    end if;
  end if;
  return new;
end $$;
