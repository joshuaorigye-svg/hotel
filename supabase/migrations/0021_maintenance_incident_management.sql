-- Hotel maintenance and incident reporting workflow.
-- Apply after 0020_shift_swap_notifications.sql. Review and apply manually.

create table if not exists public.maintenance_incidents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  reported_by uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  category text not null check (category in ('plumbing','electrical','equipment','room','furniture','cleaning','security','other')),
  title text not null,
  description text not null,
  location text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','acknowledged','in_progress','waiting_parts','resolved','closed','cancelled')),
  estimated_cost numeric(14,2),
  actual_cost numeric(14,2),
  vendor_name text,
  resolution_note text,
  reported_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint maintenance_title_length check (char_length(trim(title)) between 4 and 120),
  constraint maintenance_description_length check (char_length(trim(description)) between 10 and 4000),
  constraint maintenance_location_length check (char_length(trim(location)) between 2 and 160),
  constraint maintenance_costs_nonnegative check (
    (estimated_cost is null or estimated_cost >= 0) and
    (actual_cost is null or actual_cost >= 0)
  )
);

create index if not exists maintenance_department_status_idx
  on public.maintenance_incidents(department_id,status,priority,reported_at desc);
create index if not exists maintenance_reporter_idx
  on public.maintenance_incidents(reported_by,reported_at desc);
create index if not exists maintenance_assignee_idx
  on public.maintenance_incidents(assigned_to,status,reported_at desc);

alter table public.maintenance_incidents enable row level security;
drop policy if exists "owner reads maintenance incidents" on public.maintenance_incidents;
drop policy if exists "manager reads department maintenance incidents" on public.maintenance_incidents;
drop policy if exists "staff reads own maintenance incidents" on public.maintenance_incidents;
create policy "owner reads maintenance incidents" on public.maintenance_incidents
  for select to authenticated using (public.is_owner());
create policy "manager reads department maintenance incidents" on public.maintenance_incidents
  for select to authenticated using (
    public.current_user_role()='manager'
    and department_id=public.current_user_department()
  );
create policy "staff reads own maintenance incidents" on public.maintenance_incidents
  for select to authenticated using (reported_by=auth.uid());
revoke insert,update,delete on public.maintenance_incidents from authenticated;
grant select on public.maintenance_incidents to authenticated;

create or replace function public.submit_maintenance_incident(
  p_category text,p_title text,p_description text,p_location text,p_priority text default 'normal'
) returns uuid
language plpgsql security definer set search_path=public as $$
declare dept uuid; incident_id uuid;
begin
  if public.current_user_role() not in ('staff','manager') then
    raise exception 'Active staff access required';
  end if;
  if p_category not in ('plumbing','electrical','equipment','room','furniture','cleaning','security','other')
    or p_priority not in ('low','normal','high','urgent') then
    raise exception 'Choose a valid category and priority';
  end if;
  if length(trim(coalesce(p_title,''))) not between 4 and 120
    or length(trim(coalesce(p_description,''))) not between 10 and 4000
    or length(trim(coalesce(p_location,''))) not between 2 and 160 then
    raise exception 'Check the title, description and location lengths';
  end if;
  select department_id into dept from public.profiles
    where id=auth.uid() and is_active=true for update;
  if not found or dept is null then raise exception 'An active department profile is required'; end if;
  insert into public.maintenance_incidents(department_id,reported_by,category,title,description,location,priority)
  values(dept,auth.uid(),p_category,trim(p_title),trim(p_description),trim(p_location),p_priority)
  returning id into incident_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Reported maintenance incident','maintenance_incident',incident_id,
    jsonb_build_object('category',p_category,'priority',p_priority,'location',trim(p_location)));
  return incident_id;
end;
$$;

create or replace function public.update_maintenance_incident(
  p_incident_id uuid,p_status text,p_assigned_to uuid default null,
  p_estimated_cost numeric default null,p_actual_cost numeric default null,
  p_vendor_name text default null,p_resolution_note text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare target public.maintenance_incidents%rowtype; assignee_dept uuid;
begin
  if not (public.is_owner() or public.current_user_role()='manager') then
    raise exception 'Manager or owner access required';
  end if;
  if p_status not in ('open','acknowledged','in_progress','waiting_parts','resolved','closed','cancelled') then
    raise exception 'Choose a valid incident status';
  end if;
  if (p_estimated_cost is not null and p_estimated_cost<0)
    or (p_actual_cost is not null and p_actual_cost<0)
    or length(coalesce(p_vendor_name,''))>160
    or length(coalesce(p_resolution_note,''))>2000 then
    raise exception 'Check cost and note values';
  end if;
  select * into target from public.maintenance_incidents where id=p_incident_id for update;
  if not found then raise exception 'Incident not found'; end if;
  if public.current_user_role()='manager'
    and target.department_id<>public.current_user_department() then
    raise exception 'You can manage incidents only in your department';
  end if;
  if p_assigned_to is not null then
    select department_id into assignee_dept from public.profiles
      where id=p_assigned_to and is_active=true and role in ('staff','manager');
    if assignee_dept is distinct from target.department_id then
      raise exception 'Assignee must be active in the incident department';
    end if;
  end if;
  if p_status='closed' and target.status not in ('resolved','closed') then
    raise exception 'Resolve the incident before closing it';
  end if;
  if p_status='resolved' and length(trim(coalesce(p_resolution_note,'')))<5 then
    raise exception 'Add a resolution note of at least five characters';
  end if;

  update public.maintenance_incidents set
    status=p_status,
    assigned_to=p_assigned_to,
    estimated_cost=p_estimated_cost,
    actual_cost=p_actual_cost,
    vendor_name=nullif(trim(coalesce(p_vendor_name,'')),''),
    resolution_note=case when p_resolution_note is null then resolution_note else nullif(trim(p_resolution_note),'') end,
    acknowledged_at=case when p_status in ('acknowledged','in_progress','waiting_parts','resolved','closed') then coalesce(acknowledged_at,now()) else acknowledged_at end,
    resolved_at=case when p_status='resolved' then coalesce(resolved_at,now()) else resolved_at end,
    closed_at=case when p_status='closed' then coalesce(closed_at,now()) else closed_at end,
    updated_at=now()
  where id=target.id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Updated maintenance incident','maintenance_incident',target.id,
    jsonb_build_object('from_status',target.status,'to_status',p_status,
      'assigned_to',p_assigned_to,'estimated_cost',p_estimated_cost,'actual_cost',p_actual_cost,
      'vendor_name',nullif(trim(coalesce(p_vendor_name,'')),''),'resolution_note',nullif(trim(coalesce(p_resolution_note,'')),'')));
end;
$$;

revoke all on function public.submit_maintenance_incident(text,text,text,text,text) from public;
revoke all on function public.update_maintenance_incident(uuid,text,uuid,numeric,numeric,text,text) from public;
grant execute on function public.submit_maintenance_incident(text,text,text,text,text) to authenticated;
grant execute on function public.update_maintenance_incident(uuid,text,uuid,numeric,numeric,text,text) to authenticated;


-- Notify the affected team and reporter using the in-app notification centre.
create or replace function public.notify_maintenance_incident_participants()
returns trigger language plpgsql security definer set search_path=public as $$
declare reporter_name text;
begin
  select coalesce(full_name,'A colleague') into reporter_name
  from public.profiles where id=new.reported_by;

  if tg_op='INSERT' then
    insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
    select p.id,'New maintenance incident',
      reporter_name||' reported: '||new.title||' ('||new.priority||' priority).',
      case when p.role='owner' then '/owner/incidents' else '/manager/incidents' end,
      'maintenance_incident',new.id
    from public.profiles p
    where p.is_active=true and (
      p.role='owner' or (p.role='manager' and p.department_id=new.department_id)
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
    values(new.reported_by,'Maintenance incident updated',
      'Your report "'||new.title||'" is now '||replace(new.status,'_',' ')||'.',
      case when (select role from public.profiles where id=new.reported_by)='manager'
        then '/manager/incidents' else '/staff/incidents' end,
      'maintenance_incident',new.id);
  end if;

  if old.assigned_to is distinct from new.assigned_to and new.assigned_to is not null then
    insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
    values(new.assigned_to,'Maintenance work assigned to you',
      'You have been assigned: '||new.title||' at '||new.location||'.',
      case when (select role from public.profiles where id=new.assigned_to)='manager'
        then '/manager/incidents' else '/staff/incidents' end,
      'maintenance_incident',new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_incident_notifications on public.maintenance_incidents;
create trigger maintenance_incident_notifications
after insert or update of status,assigned_to on public.maintenance_incidents
for each row execute function public.notify_maintenance_incident_participants();
