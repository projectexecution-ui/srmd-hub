-- Cost Control: (1) 'combined' line type for Material+Labour asks, and
-- (2) Trustee/Admin accept-or-reject of the management-set Internal Estimate,
-- snapshotted into cc_budget_lines.internal_estimate_amt as the baseline the
-- app compares engineers' asks against.

-- (1) Combined M+L line type (engineers sometimes budget both together).
alter type public.cc_line_type add value if not exists 'combined';

-- (2) Accept / reject the Internal Estimate per (project, sub-skill).
create or replace function public.cc_set_internal_estimate(
  p_project uuid,
  p_discipline uuid,
  p_sub_skill uuid,
  p_decision text,               -- 'accept' | 'reject' | 'clear'
  p_amount numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_amt numeric;
  v_setat timestamptz;
  v_notes text;
  v_id uuid;
begin
  v_role := public.effective_user_role(auth.uid(), 'cost-control')::text;
  if v_role not in ('admin', 'founder') then
    raise exception 'Only the Trustee or an Admin can accept or reject the Internal Estimate';
  end if;

  if p_decision = 'accept' then
    v_amt := coalesce(p_amount, 0); v_setat := now(); v_notes := null;
  elsif p_decision = 'reject' then
    v_amt := null; v_setat := now(); v_notes := 'rejected';
  elsif p_decision = 'clear' then
    v_amt := null; v_setat := null; v_notes := null;
  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  insert into public.cc_budget_lines
    (project_id, discipline_id, sub_skill_id, line_type,
     internal_estimate_amt, internal_estimate_set_at, internal_estimate_set_by, internal_estimate_notes)
  values
    (p_project, p_discipline, p_sub_skill, 'work',
     v_amt, v_setat, case when v_setat is null then null else auth.uid() end, v_notes)
  on conflict (project_id, discipline_id, sub_skill_id, line_type) do update
    set internal_estimate_amt = excluded.internal_estimate_amt,
        internal_estimate_set_at = excluded.internal_estimate_set_at,
        internal_estimate_set_by = excluded.internal_estimate_set_by,
        internal_estimate_notes = excluded.internal_estimate_notes,
        updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'decision', p_decision, 'amount', v_amt);
end;
$$;

grant execute on function public.cc_set_internal_estimate(uuid, uuid, uuid, text, numeric) to authenticated;
