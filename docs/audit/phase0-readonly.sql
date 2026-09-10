-- CT HUB — Phase 0 database inventory. READ-ONLY. Run in the Supabase SQL editor
-- (project hjwtjrjkmuhhbsbjsqhx) and paste the four result sets into docs/audit/db-inventory.txt.
-- These are the mechanical checks Prompt A used to spend model budget on.

-- 1. Every in4_* table: exact row count and last sync. Compare against the 6 Sep 2026
--    mirror baseline (projects 36 + sub-projects 123, indent lines 4,914, work orders 1,666,
--    wo_boq_items 9,852, wo_abstract_items 8,230). IN4 itself holds MORE than the mirror
--    (2,157 work orders on 7 Sep) — a mirror count below IN4's is expected, not a fault.
select t.table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', t.table_name), false, true, '')))[1]::text::bigint as row_count,
       case when exists (select 1 from information_schema.columns c
                         where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'synced_at')
            then (xpath('/row/s/text()', query_to_xml(format('select max(synced_at)::text s from public.%I', t.table_name), false, true, '')))[1]::text
            else 'no synced_at column' end as last_sync
from information_schema.tables t
where t.table_schema = 'public' and t.table_name like 'in4\_%' escape '\'
order by 1;

-- 2. RLS: is it on, per table.
select c.relname as table_name, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 3. Every policy and what it permits.
select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies
where schemaname = 'public'
order by 1, 2;

-- 4. Table-level grants to anon. EXPECT every table to show all privileges: that is
--    Supabase's default grant and is NOT a finding on its own. RLS (block 2) plus the
--    policies (block 3) are what actually decide access. A finding is a POLICY whose
--    roles include anon or public with a permissive USING / WITH CHECK.
select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
group by 1 order by 1;

-- 5. PO / GRN shape. On 8 Sep 2026: 4,963 indent lines, 4,664 PO entries and 4,535 GRN
--    entries, ALL nested inside in4_indent_items.pos / .grns (jsonb); no standalone
--    in4 PO or GRN table exists. A PO not raised from an indent is therefore invisible.
select count(*) as indent_lines,
       count(*) filter (where jsonb_array_length(coalesce(pos, '[]'::jsonb)) > 0) as lines_with_po,
       coalesce(sum(jsonb_array_length(coalesce(pos, '[]'::jsonb))), 0) as po_entries,
       count(*) filter (where jsonb_array_length(coalesce(grns, '[]'::jsonb)) > 0) as lines_with_grn,
       coalesce(sum(jsonb_array_length(coalesce(grns, '[]'::jsonb))), 0) as grn_entries,
       (select count(*) from information_schema.tables
         where table_schema = 'public'
           and table_name in ('in4_purchase_orders', 'in4_pos', 'in4_po_lines', 'in4_grns', 'in4_grn_lines')) as standalone_po_grn_tables
from in4_indent_items;
