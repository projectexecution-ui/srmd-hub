-- Google Drive archive ledger: which stored object has been copied where.
-- Written only by the cron (service role); readable by signed-in users so a
-- file's "open in Drive" link can be shown next to it later.
create table if not exists public.drive_files (
  id               bigserial primary key,
  bucket           text not null,
  object_path      text not null,
  drive_id         text,
  drive_folder_id  text,
  drive_path       text,
  file_name        text,
  uploaded_at      timestamptz,
  archived_at      timestamptz,
  error            text,
  created_at       timestamptz not null default now(),
  unique (bucket, object_path)
);
comment on table public.drive_files is
  'Ledger of Supabase Storage objects mirrored to the Google Shared drive by /api/cron/drive-archive. archived_at set = moved under Archive/ after the hub deleted the object.';
alter table public.drive_files enable row level security;
drop policy if exists drive_files_read on public.drive_files;
create policy drive_files_read on public.drive_files for select to authenticated using ((select auth.uid()) is not null);

-- storage.objects is not reachable through the REST API; the archive cron
-- lists a bucket through this function instead. Service role only.
create or replace function public.list_storage_objects(p_bucket text)
returns table (name text, created_at timestamptz, size bigint)
language sql
stable
security definer
set search_path = public, storage
as $$
  select o.name, o.created_at, (o.metadata->>'size')::bigint
  from storage.objects o
  where o.bucket_id = p_bucket
$$;
revoke all on function public.list_storage_objects(text) from public;
revoke all on function public.list_storage_objects(text) from authenticated;
revoke all on function public.list_storage_objects(text) from anon;
grant execute on function public.list_storage_objects(text) to service_role;
