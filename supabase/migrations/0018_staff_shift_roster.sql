-- Department-scoped staff shift roster with conflict and approved-leave protection.
create table if not exists public.staff_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  staff_id uuid not null references public.profiles(id),
  shift_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  constraint staff_shift_time_check check (ends_at > starts_at),
  constraint staff_shift_duration_check check (ends_at <= starts_at + interval '18 hours'),
  constraint staff_shift_cancel_check check (
    (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null)
    or status = 'scheduled'
  )
);

create index if not exists staff_shift_department_start_idx
  on public.staff_shift_assignments(department_id, starts_at)
  where status = 'scheduled';
create index if not exists staff_shift_staff_start_idx
  on public.staff_shift_assignments(staff_id, starts_at)
  where status = 'scheduled';

alter table public.staff_shift_assignments enable row level security;
drop policy if exists "owner reads all staff shifts" on public.staff_shift_assignments;
drop policy if exists "manager reads department staff shifts" on public.staff_shift_assignments;
drop policy if exists "staff reads own shifts" on public.staff_shift_assignments;

create policy "owner reads all staff shifts" on public.staff_shift_assignments
  for select to authenticated using (public.is_owner());
create policy "manager reads department staff shifts" on public.staff_shift_assignments
  for select to authenticated using (
    public.current_user_role() = 'manager'
    and department_id = public.current_user_department()
  );
create policy "staff reads own shifts" on public.staff_shift_assignments
  for select to authenticated using (staff_id = auth.uid());

revoke insert, update, delete on public.staff_shift_assignments from authenticated;
grant select on public.staff_shift_assignments to authenticated;

create or replace function public.create_staff_shift(
  p_staff_id uuid,
  p_shift_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  target_department uuid;
  local_start date;
  local_end date;
  new_shift_id uuid;
begin
  if public.current_user_role() not in ('owner','manager') then
    raise exception 'Manager or owner access required';
  end if;
  if p_staff_id is null or p_starts_at is null or p_ends_at is null
     or p_ends_at <= p_starts_at
     or p_ends_at > p_starts_at + interval '18 hours'
     or p_starts_at < now() - interval '5 minutes'
     or length(trim(coalesce(p_shift_name,''))) < 2
     or length(trim(coalesce(p_shift_name,''))) > 60 then
    raise exception 'Enter a valid shift name and a future shift lasting no more than 18 hours';
  end if;

  -- Lock the employee row so two managers cannot create overlapping shifts concurrently.
  select department_id into target_department
  from public.profiles
  where id = p_staff_id and is_active = true and role in ('staff','manager')
  for update;
  if not found or target_department is null then
    raise exception 'Select an active employee assigned to a department';
  end if;
  if public.current_user_role() = 'manager'
     and target_department <> public.current_user_department() then
    raise exception 'You can schedule only employees in your department';
  end if;

  local_start := (p_starts_at at time zone 'Africa/Kampala')::date;
  local_end := ((p_ends_at - interval '1 microsecond') at time zone 'Africa/Kampala')::date;

  if exists (
    select 1 from public.staff_shift_assignments s
    where s.staff_id = p_staff_id and s.status = 'scheduled'
      and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
  ) then
    raise exception 'This employee already has a shift overlapping that time';
  end if;

  if exists (
    select 1 from public.staff_leave l
    where l.staff_id = p_staff_id and l.status = 'approved'
      and daterange(l.starts_on,l.ends_on,'[]') && daterange(local_start,local_end,'[]')
  ) then
    raise exception 'This employee has approved leave during the selected shift';
  end if;

  insert into public.staff_shift_assignments(
    department_id,staff_id,shift_name,starts_at,ends_at,created_by
  ) values (
    target_department,p_staff_id,trim(p_shift_name),p_starts_at,p_ends_at,auth.uid()
  ) returning id into new_shift_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Scheduled staff shift','staff_shift_assignment',new_shift_id,
    jsonb_build_object('staff_id',p_staff_id,'department_id',target_department,
      'shift_name',trim(p_shift_name),'starts_at',p_starts_at,'ends_at',p_ends_at));
  return new_shift_id;
end;
$$;

create or replace function public.cancel_staff_shift(
  p_shift_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare target public.staff_shift_assignments%rowtype;
begin
  if public.current_user_role() not in ('owner','manager') then
    raise exception 'Manager or owner access required';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Enter a cancellation reason of at least five characters';
  end if;

  select * into target
  from public.staff_shift_assignments
  where id = p_shift_id
  for update;
  if not found or target.status <> 'scheduled' then
    raise exception 'Scheduled shift not found';
  end if;
  if public.current_user_role() = 'manager'
     and target.department_id <> public.current_user_department() then
    raise exception 'You can cancel only shifts in your department';
  end if;
  if target.starts_at <= now() then
    raise exception 'A shift that has started cannot be cancelled here';
  end if;

  update public.staff_shift_assignments
  set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),
      cancellation_reason=trim(p_reason)
  where id=target.id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Cancelled scheduled staff shift','staff_shift_assignment',target.id,
    jsonb_build_object('staff_id',target.staff_id,'reason',trim(p_reason)));
end;
$$;

revoke all on function public.create_staff_shift(uuid,text,timestamptz,timestamptz) from public;
revoke all on function public.cancel_staff_shift(uuid,text) from public;
grant execute on function public.create_staff_shift(uuid,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.cancel_staff_shift(uuid,text) to authenticated;
