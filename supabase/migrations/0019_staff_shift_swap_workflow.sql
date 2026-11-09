-- Staff-to-staff shift exchange requests with target consent and manager approval.
-- Apply after 0018_staff_shift_roster.sql. This migration is committed, not applied.

create table if not exists public.staff_shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  requester_id uuid not null references public.profiles(id),
  target_id uuid not null references public.profiles(id),
  requester_shift_id uuid not null references public.staff_shift_assignments(id),
  target_shift_id uuid not null references public.staff_shift_assignments(id),
  status text not null default 'pending_target'
    check (status in ('pending_target','declined','pending_manager','approved','rejected','cancelled')),
  target_responded_at timestamptz,
  request_note text,
  target_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint swap_different_staff check (requester_id <> target_id),
  constraint swap_different_shifts check (requester_shift_id <> target_shift_id)
);

create index if not exists staff_shift_swap_participants_idx
  on public.staff_shift_swap_requests(requester_id,target_id,status,created_at desc);
create index if not exists staff_shift_swap_department_idx
  on public.staff_shift_swap_requests(department_id,status,created_at desc);

alter table public.staff_shift_swap_requests enable row level security;
drop policy if exists "participants read their shift swap requests" on public.staff_shift_swap_requests;
drop policy if exists "managers read department shift swap requests" on public.staff_shift_swap_requests;
drop policy if exists "owner reads all shift swap requests" on public.staff_shift_swap_requests;

create policy "participants read their shift swap requests"
  on public.staff_shift_swap_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());
create policy "managers read department shift swap requests"
  on public.staff_shift_swap_requests for select to authenticated
  using (public.current_user_role() = 'manager' and department_id = public.current_user_department());
create policy "owner reads all shift swap requests"
  on public.staff_shift_swap_requests for select to authenticated
  using (public.is_owner());

revoke insert,update,delete on public.staff_shift_swap_requests from authenticated;
grant select on public.staff_shift_swap_requests to authenticated;

-- Staff may see the published roster for their own department, which is necessary
-- to select a colleague's shift. Assignment writes remain RPC-only.
drop policy if exists "staff reads department shift roster" on public.staff_shift_assignments;
create policy "staff reads department shift roster" on public.staff_shift_assignments
  for select to authenticated using (
    public.current_user_role() = 'staff'
    and department_id = public.current_user_department()
  );

create or replace function public.request_staff_shift_swap(
  p_requester_shift_id uuid,
  p_target_shift_id uuid,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  own_shift public.staff_shift_assignments%rowtype;
  other_shift public.staff_shift_assignments%rowtype;
  request_id uuid;
  requester_department uuid;
begin
  if public.current_user_role() not in ('staff','manager') then
    raise exception 'Active staff access required';
  end if;
  if p_requester_shift_id is null or p_target_shift_id is null
     or p_requester_shift_id = p_target_shift_id then
    raise exception 'Choose two different shifts';
  end if;
  if length(trim(coalesce(p_note,''))) > 500 then
    raise exception 'The note must be 500 characters or fewer';
  end if;

  -- Lock in stable ID order to avoid deadlocks when two employees request at once.
  perform 1 from public.staff_shift_assignments
    where id in (p_requester_shift_id,p_target_shift_id)
    order by id for update;
  select * into own_shift from public.staff_shift_assignments where id=p_requester_shift_id;
  select * into other_shift from public.staff_shift_assignments where id=p_target_shift_id;

  if own_shift.id is null or other_shift.id is null
     or own_shift.status <> 'scheduled' or other_shift.status <> 'scheduled' then
    raise exception 'Both shifts must still be scheduled';
  end if;
  if own_shift.staff_id <> auth.uid() then
    raise exception 'You can request a swap only for your own shift';
  end if;
  if own_shift.starts_at <= now() or other_shift.starts_at <= now() then
    raise exception 'Only future shifts can be exchanged';
  end if;
  if own_shift.department_id <> other_shift.department_id then
    raise exception 'Shifts must belong to the same department';
  end if;
  if other_shift.staff_id = auth.uid() then
    raise exception 'Choose a shift assigned to another employee';
  end if;

  select department_id into requester_department from public.profiles
    where id=auth.uid() and is_active=true for update;
  if requester_department is null or requester_department <> own_shift.department_id then
    raise exception 'Your active department must match the selected shifts';
  end if;
  if not exists(select 1 from public.profiles where id=other_shift.staff_id
    and is_active=true and department_id=own_shift.department_id) then
    raise exception 'The other employee must be active in your department';
  end if;

  if exists (
    select 1 from public.staff_shift_swap_requests r
    where r.status in ('pending_target','pending_manager')
      and (r.requester_shift_id in (own_shift.id,other_shift.id)
        or r.target_shift_id in (own_shift.id,other_shift.id))
  ) then
    raise exception 'One of these shifts already has an open swap request';
  end if;

  insert into public.staff_shift_swap_requests(
    department_id,requester_id,target_id,requester_shift_id,target_shift_id,request_note
  ) values (
    own_shift.department_id,auth.uid(),other_shift.staff_id,own_shift.id,other_shift.id,
    nullif(trim(coalesce(p_note,'')),'')
  ) returning id into request_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Requested staff shift swap','staff_shift_swap_request',request_id,
    jsonb_build_object('requester_shift_id',own_shift.id,'target_shift_id',other_shift.id,
      'target_id',other_shift.staff_id));
  return request_id;
end;
$$;

create or replace function public.respond_staff_shift_swap(
  p_request_id uuid,
  p_response text,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare target public.staff_shift_swap_requests%rowtype;
begin
  if p_response not in ('accept','decline') then raise exception 'Choose accept or decline'; end if;
  if length(trim(coalesce(p_note,''))) > 500 then raise exception 'The note must be 500 characters or fewer'; end if;
  select * into target from public.staff_shift_swap_requests where id=p_request_id for update;
  if not found or target.target_id <> auth.uid() or target.status <> 'pending_target' then
    raise exception 'This request is not awaiting your response';
  end if;
  if p_response='accept' then
    update public.staff_shift_swap_requests set status='pending_manager',
      target_responded_at=now(),target_note=nullif(trim(coalesce(p_note,'')),''),
      updated_at=now() where id=target.id;
  else
    update public.staff_shift_swap_requests set status='declined',
      target_responded_at=now(),target_note=coalesce(nullif(trim(coalesce(p_note,'')),''),target.target_note),
      updated_at=now() where id=target.id;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when p_response='accept' then 'Accepted shift swap request' else 'Declined shift swap request' end,
    'staff_shift_swap_request',target.id,jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),'')));
end;
$$;

create or replace function public.cancel_staff_shift_swap(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare target public.staff_shift_swap_requests%rowtype;
begin
  select * into target from public.staff_shift_swap_requests where id=p_request_id for update;
  if not found or target.requester_id <> auth.uid() or target.status not in ('pending_target','pending_manager') then
    raise exception 'Only your own open swap request can be cancelled';
  end if;
  update public.staff_shift_swap_requests set status='cancelled',updated_at=now() where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id)
  values(auth.uid(),'Cancelled shift swap request','staff_shift_swap_request',target.id);
end;
$$;

create or replace function public.review_staff_shift_swap(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.staff_shift_swap_requests%rowtype;
  first_shift public.staff_shift_assignments%rowtype;
  second_shift public.staff_shift_assignments%rowtype;
  requester_department uuid;
  target_department uuid;
  first_staff uuid;
  second_staff uuid;
begin
  if p_decision not in ('approve','reject') then raise exception 'Choose approve or reject'; end if;
  if p_decision='reject' and length(trim(coalesce(p_decision_note,''))) < 5 then
    raise exception 'A rejection reason of at least five characters is required';
  end if;
  if length(trim(coalesce(p_decision_note,''))) > 500 then raise exception 'The decision note is too long'; end if;

  select * into target from public.staff_shift_swap_requests where id=p_request_id for update;
  if not found or target.status <> 'pending_manager' then
    raise exception 'This request has not been accepted by the other employee';
  end if;
  if auth.uid() in (target.requester_id,target.target_id) then
    raise exception 'A swap participant cannot approve their own exchange';
  end if;
  if not (public.is_owner() or (
    public.current_user_role()='manager'
    and public.current_user_department()=target.department_id
  )) then
    raise exception 'Department manager or owner access required';
  end if;

  if p_decision='approve' then
    perform 1 from public.staff_shift_assignments
      where id in (target.requester_shift_id,target.target_shift_id)
      order by id for update;
    select * into first_shift from public.staff_shift_assignments where id=target.requester_shift_id;
    select * into second_shift from public.staff_shift_assignments where id=target.target_shift_id;

    if first_shift.id is null or second_shift.id is null
      or first_shift.status <> 'scheduled' or second_shift.status <> 'scheduled'
      or first_shift.staff_id <> target.requester_id
      or second_shift.staff_id <> target.target_id
      or first_shift.starts_at <= now() or second_shift.starts_at <= now()
      or first_shift.department_id <> target.department_id
      or second_shift.department_id <> target.department_id then
      raise exception 'The shifts changed or are no longer eligible; the swap cannot be approved';
    end if;

    -- Lock both employee profiles in stable ID order before conflict checks.
    perform 1 from public.profiles where id in (target.requester_id,target.target_id)
      order by id for update;
    select department_id into requester_department from public.profiles
      where id=target.requester_id and is_active=true;
    select department_id into target_department from public.profiles
      where id=target.target_id and is_active=true;
    if requester_department is distinct from target.department_id
      or target_department is distinct from target.department_id then
      raise exception 'Both employees must remain active in the same department';
    end if;

    -- Check the post-swap assignments against every other scheduled shift.
    if exists(select 1 from public.staff_shift_assignments s
      where s.status='scheduled' and s.id not in (first_shift.id,second_shift.id)
        and s.staff_id=target.target_id
        and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(first_shift.starts_at,first_shift.ends_at,'[)'))
      or exists(select 1 from public.staff_shift_assignments s
      where s.status='scheduled' and s.id not in (first_shift.id,second_shift.id)
        and s.staff_id=target.requester_id
        and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(second_shift.starts_at,second_shift.ends_at,'[)')) then
      raise exception 'The exchange would create an overlapping shift for one of the employees';
    end if;

    if exists(select 1 from public.staff_leave l
      where l.staff_id=target.target_id and l.status='approved'
        and daterange(l.starts_on,l.ends_on,'[]') &&
          daterange((first_shift.starts_at at time zone 'Africa/Kampala')::date,
            ((first_shift.ends_at-interval '1 microsecond') at time zone 'Africa/Kampala')::date,'[]'))
      or exists(select 1 from public.staff_leave l
      where l.staff_id=target.requester_id and l.status='approved'
        and daterange(l.starts_on,l.ends_on,'[]') &&
          daterange((second_shift.starts_at at time zone 'Africa/Kampala')::date,
            ((second_shift.ends_at-interval '1 microsecond') at time zone 'Africa/Kampala')::date,'[]')) then
      raise exception 'The exchange conflicts with approved leave';
    end if;

    first_staff := first_shift.staff_id;
    second_staff := second_shift.staff_id;
    update public.staff_shift_assignments set staff_id=second_staff where id=first_shift.id;
    update public.staff_shift_assignments set staff_id=first_staff where id=second_shift.id;
  end if;

  update public.staff_shift_swap_requests set
    status=case when p_decision='approve' then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),
    decision_note=nullif(trim(coalesce(p_decision_note,'')),''),
    updated_at=now()
  where id=target.id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when p_decision='approve' then 'Approved staff shift swap' else 'Rejected staff shift swap' end,
    'staff_shift_swap_request',target.id,
    jsonb_build_object('requester_id',target.requester_id,'target_id',target.target_id,
      'requester_shift_id',target.requester_shift_id,'target_shift_id',target.target_shift_id,
      'decision_note',nullif(trim(coalesce(p_decision_note,'')),'')));
end;
$$;

revoke all on function public.request_staff_shift_swap(uuid,uuid,text) from public;
revoke all on function public.respond_staff_shift_swap(uuid,text,text) from public;
revoke all on function public.cancel_staff_shift_swap(uuid) from public;
revoke all on function public.review_staff_shift_swap(uuid,text,text) from public;
grant execute on function public.request_staff_shift_swap(uuid,uuid,text) to authenticated;
grant execute on function public.respond_staff_shift_swap(uuid,text,text) to authenticated;
grant execute on function public.cancel_staff_shift_swap(uuid) to authenticated;
grant execute on function public.review_staff_shift_swap(uuid,text,text) to authenticated;
