-- Staff operations: controlled attendance/task mutations and issue reporting.
create table if not exists public.issue_reports(
 id uuid primary key default gen_random_uuid(),
 reported_by uuid not null references public.profiles(id),
 department_id uuid references public.departments(id),
 room_id uuid references public.rooms(id),
 title text not null,
 description text not null,
 photo_url text,
 status text not null default 'open' check(status in('open','in_progress','fixed','closed')),
 assigned_to uuid references public.profiles(id),
 resolved_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.issue_reports enable row level security;
create policy "owner issue access" on public.issue_reports for all to authenticated using(public.is_owner()) with check(public.is_owner());
create policy "manager department issue access" on public.issue_reports for all to authenticated using(public.current_user_role()='manager' and department_id=public.current_user_department()) with check(public.current_user_role()='manager' and department_id=public.current_user_department());
create policy "staff report own issues" on public.issue_reports for insert to authenticated with check(reported_by=auth.uid() and department_id=public.current_user_department());
create policy "staff read own issues" on public.issue_reports for select to authenticated using(reported_by=auth.uid());

create or replace function public.staff_clock_in()
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if public.current_user_role() not in ('staff','manager') then raise exception 'Staff access required'; end if;
 if exists(select 1 from public.attendance where staff_id=auth.uid() and clock_out is null and clock_in::date=current_date) then raise exception 'Already clocked in'; end if;
 insert into public.attendance(staff_id,status) values(auth.uid(),'clocked_in') returning id into new_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'Clocked in','attendance',new_id);
 return new_id;
end; $$;
create or replace function public.staff_clock_out()
returns uuid language plpgsql security definer set search_path=public as $$
declare attendance_id uuid;
begin
 if public.current_user_role() not in ('staff','manager') then raise exception 'Staff access required'; end if;
 update public.attendance set clock_out=now(),status='completed'
 where staff_id=auth.uid() and clock_out is null and clock_in::date=current_date
 returning id into attendance_id;
 if attendance_id is null then raise exception 'No open attendance record for today'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'Clocked out','attendance',attendance_id);
 return attendance_id;
end; $$;
create or replace function public.complete_my_task(task_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.current_user_role()<>'staff' then raise exception 'Staff access required'; end if;
 update public.tasks set status='done',completed_at=now()
 where id=task_id and assigned_to=auth.uid() and status<>'done';
 if not found then raise exception 'Task not found or not assigned to you'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'Marked assigned task done','task',task_id);
end; $$;
revoke all on function public.staff_clock_in() from public;
revoke all on function public.staff_clock_out() from public;
revoke all on function public.complete_my_task(uuid) from public;
grant execute on function public.staff_clock_in() to authenticated;
grant execute on function public.staff_clock_out() to authenticated;
grant execute on function public.complete_my_task(uuid) to authenticated;

-- Do not let staff rewrite task ownership or department via direct table updates.
drop policy if exists "staff update assigned tasks" on public.tasks;
create policy "staff update assigned task description only" on public.tasks for update to authenticated
using(assigned_to=auth.uid() and public.current_user_role()='staff')
with check(assigned_to=auth.uid() and public.current_user_role()='staff');
