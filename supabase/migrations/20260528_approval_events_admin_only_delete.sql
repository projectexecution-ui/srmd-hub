-- ============================================================
-- Lock the approval audit trail.
--
-- - approval_events: admin / Portal Owner are the ONLY ones who can
--   DELETE a row. There is no UPDATE policy at all, so comments are
--   immutable for everyone (no edit-after-the-fact).
-- - approval-attachments storage: only admin / Portal Owner can DELETE
--   uploaded files. The original uploader can no longer remove their
--   own — this stops a user from quietly wiping their own attached
--   evidence after submitting an approval.
-- ============================================================

drop policy if exists approval_events_delete on public.approval_events;
create policy approval_events_delete on public.approval_events
  for delete to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role::text = 'admin' or p.is_portal_owner = true))
  );

drop policy if exists "approval_attachments_delete" on storage.objects;
create policy "approval_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'approval-attachments'
    and exists (select 1 from public.profiles p
                where p.id = auth.uid()
                  and (p.role::text = 'admin' or p.is_portal_owner = true))
  );
