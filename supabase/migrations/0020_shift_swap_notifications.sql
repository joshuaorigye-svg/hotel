-- In-app notifications for staff shift exchanges.
-- Apply after 0019_staff_shift_swap_workflow.sql. Not applied automatically.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  href text not null default '/',
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_user_unread_idx
  on public.user_notifications(user_id,created_at desc) where read_at is null;
create index if not exists user_notifications_user_history_idx
  on public.user_notifications(user_id,created_at desc);

alter table public.user_notifications enable row level security;
drop policy if exists "users read their own notifications" on public.user_notifications;
create policy "users read their own notifications" on public.user_notifications
  for select to authenticated using (user_id=auth.uid());
revoke insert,update,delete on public.user_notifications from authenticated;
grant select on public.user_notifications to authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.user_notifications set read_at=coalesce(read_at,now())
  where id=p_notification_id and user_id=auth.uid();
  if not found then raise exception 'Notification not found'; end if;
end;
$$;
create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  update public.user_notifications set read_at=now()
  where user_id=auth.uid() and read_at is null;
  get diagnostics changed=row_count;
  return changed;
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

create or replace function public.notify_shift_swap_participants()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  requester_name text;
  target_name text;
  manager_name text;
begin
  select coalesce(full_name,'A colleague') into requester_name from public.profiles where id=new.requester_id;
  select coalesce(full_name,'A colleague') into target_name from public.profiles where id=new.target_id;

  if tg_op='INSERT' then
    insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
    values(new.target_id,'Shift exchange requested',
      requester_name||' has asked to exchange a scheduled shift with you.',
      '/staff/swaps','staff_shift_swap_request',new.id);
    return new;
  end if;

  if old.status is distinct from new.status then
    if new.status='pending_manager' then
      insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
      values(new.requester_id,'Colleague accepted your shift exchange',
        target_name||' accepted. The exchange is now awaiting manager approval.',
        case when (select role from public.profiles where id=new.requester_id)='manager' then '/manager/swaps' else '/staff/swaps' end,
        'staff_shift_swap_request',new.id);
      insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
      select p.id,'Shift exchange needs approval',
        requester_name||' and '||target_name||' agreed to exchange shifts.',
        case when p.role='owner' then '/owner/swaps' else '/manager/swaps' end,
        'staff_shift_swap_request',new.id
      from public.profiles p
      where p.is_active=true and (
        p.role='owner' or (p.role='manager' and p.department_id=new.department_id)
      );
    elsif new.status='declined' then
      insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
      values(new.requester_id,'Shift exchange declined',
        target_name||' declined your shift exchange request.',
        case when (select role from public.profiles where id=new.requester_id)='manager' then '/manager/swaps' else '/staff/swaps' end,
        'staff_shift_swap_request',new.id);
    elsif new.status in ('approved','rejected') then
      insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
      select p.id,
        case when new.status='approved' then 'Shift exchange approved' else 'Shift exchange rejected' end,
        case when new.status='approved'
          then 'Your shift exchange with '||case when p.id=new.requester_id then target_name else requester_name end||' was approved.'
          else 'Your shift exchange with '||case when p.id=new.requester_id then target_name else requester_name end||' was rejected.' end,
        case when (select role from public.profiles where id=p.id)='manager' then '/manager/swaps' else '/staff/swaps' end,
        'staff_shift_swap_request',new.id
      from public.profiles p where p.id in (new.requester_id,new.target_id);
    elsif new.status='cancelled' and old.status='pending_target' then
      insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
      values(new.target_id,'Shift exchange cancelled',
        requester_name||' cancelled the shift exchange request.',
        '/staff/swaps','staff_shift_swap_request',new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_shift_swap_notifications on public.staff_shift_swap_requests;
create trigger staff_shift_swap_notifications
after insert or update of status on public.staff_shift_swap_requests
for each row execute function public.notify_shift_swap_participants();
