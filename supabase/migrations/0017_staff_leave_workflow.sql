-- Staff leave workflow with department-scoped review and an auditable decision history.
-- Apply after migrations 0013-0016. Committed for review; not applied to Supabase.

alter table public.staff_leave
  add column if not exists department_id uuid references public.departments(id),
  add column if not exists leave_type text not null default 'annual',
  add column if not exists contact_phone text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists updated_at timestamptz not null default now();

update public.staff_leave l
set department_id = p.department_id
from public.profiles p
where l.staff_id = p.id and l.department_id is null;

alter table public.staff_leave
  drop constraint if exists staff_leave_status_check;
alter table public.staff_leave
  add constraint staff_leave_status_check
  check (status in ('pending','approved','rejected','cancelled'));

alter table public.staff_leave
  drop constraint if exists staff_leave_leave_type_check;
alter table public.staff_leave
  add constraint staff_leave_leave_type_check
  check (leave_type in ('annual','sick','personal','unpaid'));

create index if not exists staff_leave_department_dates_idx
  on public.staff_leave(department_id, starts_on desc, ends_on);
create index if not exists staff_leave_staff_dates_idx
  on public.staff_leave(staff_id, starts_on desc, ends_on);

alter table public.staff_leave enable row level security;

drop policy if exists "owner leave control" on public.staff_leave;
drop policy if exists "staff read own leave" on public.staff_leave;
drop policy if exists "staff create own leave" on public.staff_leave;
drop policy if exists "manager read department leave" on public.staff_leave;
drop policy if exists "owner reads staff leave" on public.staff_leave;
drop policy if exists "manager reads department staff leave" on public.staff_leave;
drop policy if exists "hr reads staff leave" on public.staff_leave;

create policy "owner reads staff leave" on public.staff_leave
  for select to authenticated using (public.is_owner());

create policy "staff reads own leave" on public.staff_leave
  for select to authenticated using (staff_id = auth.uid());

create policy "manager reads department staff leave" on public.staff_leave
  for select to authenticated using (
    public.current_user_role() = 'manager'
    and department_id = public.current_user_department()
  );

create policy "hr reads staff leave" on public.staff_leave
  for select to authenticated using (public.is_hr_manager());

revoke insert, update, delete on public.staff_leave from authenticated;
grant select on public.staff_leave to authenticated;

create or replace function public.submit_staff_leave(
  p_starts_on date,
  p_ends_on date,
  p_leave_type text,
  p_reason text,
  p_contact_phone text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  target_department uuid;
  request_id uuid;
begin
  if public.current_user_role() not in ('staff','manager') then
    raise exception 'Active staff access required';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or p_ends_on - p_starts_on > 90 then
    raise exception 'Enter a valid leave period of 1 to 91 calendar days';
  end if;
  if p_leave_type not in ('annual','sick','personal','unpaid') then
    raise exception 'Choose a valid leave type';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Provide a reason of at least five characters';
  end if;
  if length(trim(coalesce(p_contact_phone,''))) > 30 then
    raise exception 'Contact number is too long';
  end if;

  -- Serialise requests per employee so simultaneous submissions cannot overlap.
  select department_id into target_department
  from public.profiles
  where id = auth.uid() and is_active = true
  for update;
  if not found then raise exception 'Active staff profile not found'; end if;

  if exists (
    select 1 from public.staff_leave l
    where l.staff_id = auth.uid()
      and l.status in ('pending','approved')
      and daterange(l.starts_on,l.ends_on,'[]') && daterange(p_starts_on,p_ends_on,'[]')
  ) then
    raise exception 'You already have a pending or approved leave request overlapping these dates';
  end if;

  insert into public.staff_leave(
    staff_id,department_id,starts_on,ends_on,leave_type,reason,contact_phone,status,created_at,updated_at
  ) values (
    auth.uid(),target_department,p_starts_on,p_ends_on,p_leave_type,trim(p_reason),
    nullif(trim(coalesce(p_contact_phone,'')),''),'pending',now(),now()
  ) returning id into request_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Submitted staff leave request','staff_leave',request_id,
    jsonb_build_object('starts_on',p_starts_on,'ends_on',p_ends_on,'leave_type',p_leave_type));
  return request_id;
end;
$$;

create or replace function public.review_staff_leave(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.staff_leave%rowtype;
begin
  if p_decision not in ('approve','reject') then
    raise exception 'Choose approve or reject';
  end if;
  if p_decision = 'reject' and length(trim(coalesce(p_decision_note,''))) < 5 then
    raise exception 'A clear reason is required when rejecting leave';
  end if;

  select * into target
  from public.staff_leave
  where id = p_request_id
  for update;
  if not found or target.status <> 'pending' then
    raise exception 'Pending leave request not found';
  end if;

  if auth.uid() = target.staff_id then
    raise exception 'You cannot review your own leave request';
  end if;
  if not (
    public.is_owner()
    or public.is_hr_manager()
    or (
      public.current_user_role() = 'manager'
      and public.current_user_department() = target.department_id
    )
  ) then
    raise exception 'Owner, HR or the employee department manager access required';
  end if;

  if p_decision = 'approve' and exists (
    select 1 from public.staff_leave l
    where l.staff_id = target.staff_id
      and l.id <> target.id
      and l.status = 'approved'
      and daterange(l.starts_on,l.ends_on,'[]') && daterange(target.starts_on,target.ends_on,'[]')
  ) then
    raise exception 'This employee already has approved leave overlapping these dates';
  end if;

  update public.staff_leave
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      decision_note = nullif(trim(coalesce(p_decision_note,'')),''),
      updated_at = now()
  where id = target.id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),
    case when p_decision = 'approve' then 'Approved staff leave request' else 'Rejected staff leave request' end,
    'staff_leave',target.id,
    jsonb_build_object('staff_id',target.staff_id,'starts_on',target.starts_on,
      'ends_on',target.ends_on,'decision_note',nullif(trim(coalesce(p_decision_note,'')),'')));
end;
$$;

create or replace function public.cancel_staff_leave(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare target public.staff_leave%rowtype;
begin
  select * into target from public.staff_leave where id = p_request_id for update;
  if not found or target.staff_id <> auth.uid() or target.status <> 'pending' then
    raise exception 'Only your own pending leave request can be cancelled';
  end if;
  update public.staff_leave set status='cancelled',updated_at=now() where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id)
  values(auth.uid(),'Cancelled pending staff leave request','staff_leave',target.id);
end;
$$;

revoke all on function public.submit_staff_leave(date,date,text,text,text) from public;
revoke all on function public.review_staff_leave(uuid,text,text) from public;
revoke all on function public.cancel_staff_leave(uuid) from public;
grant execute on function public.submit_staff_leave(date,date,text,text,text) to authenticated;
grant execute on function public.review_staff_leave(uuid,text,text) to authenticated;
grant execute on function public.cancel_staff_leave(uuid) to authenticated;
