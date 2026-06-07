-- When an admin approves a pending access request (access_state flips to
-- 'approved' and the account goes active), notify the new user. This queues
-- an in-app notification AND — via notify_user → notification_deliveries — a
-- pending 'email' row, so the moment the email sender is connected the
-- "you're approved" mail goes out automatically. Exception-safe so it can
-- never block the approval write.

create or replace function public.notify_access_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access_state = 'approved'
     and (old.access_state is distinct from 'approved')
     and new.is_active = true then
    begin
      perform public.notify_user(
        new.id,
        'access_approved',
        'Your CT HUB access is approved',
        'You''re all set — your access has been approved. Open CT HUB to get started.',
        '/dashboard',
        null, 'profiles', new.id
      );
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_access_approved on public.profiles;
create trigger trg_notify_access_approved
  after update on public.profiles
  for each row execute function public.notify_access_approved();
