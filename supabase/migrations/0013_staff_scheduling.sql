-- Staff scheduling and shift management.
create table if not exists public.staff_shifts (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.profiles(id) on delete cascade,
 department_id uuid not null references public.departments(id),
 shift_date date not null,
 starts_at time not null,
 ends_at time not null,
 notes text,
 status text not null default 'scheduled' check(status in ('scheduled','cancelled')),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_at > starts_at)
);
create index if not exists staff_shifts_date_department_idx on public.staff_shifts(department_id,shift_date,status);
create index if not exists staff_shifts_staff_date_idx on public.staff_shifts(staff_id,shift_date,status);

alter table public.staff_shifts enable row level security;
create policy "owner manages all shifts" on public.staff_shifts for all to authenticated
 using(public.is_owner()) with check(public.is_owner());
create policy "manager reads department shifts" on public.staff_shifts for select to authenticated
 using(public.current_user_role()='manager' and department_id=public.current_user_department());
create policy "manager creates department shifts" on public.staff_shifts for insert to authenticated
 with check(public.current_user_role()='manager' and department_id=public.current_user_department() and created_by=auth.uid());
create policy "manager updates department shifts" on public.staff_shifts for update to authenticated
 using(public.current_user_role()='manager' and department_id=public.current_user_department())
 with check(public.current_user_role()='manager' and department_id=public.current_user_department());
create policy "staff reads own shifts" on public.staff_shifts for select to authenticated
 using(staff_id=auth.uid());

-- Validate every assignment centrally, including attempts made outside the dashboard.
create or replace function public.validate_staff_shift()
returns trigger language plpgsql security definer set search_path=public as $$
declare person public.profiles%rowtype; shift_start timestamptz; shift_end timestamptz;
begin
 if new.status='cancelled' then return new; end if;
 select * into person from public.profiles where id=new.staff_id and is_active=true for share;
 if not found or person.role not in ('staff','manager') then raise exception 'Choose an active staff member or manager'; end if;
 if person.department_id is distinct from new.department_id then raise exception 'Staff member must belong to the scheduled department'; end if;
 if exists(select 1 from public.staff_leave l where l.staff_id=new.staff_id and l.status='approved' and new.shift_date between l.starts_on and l.ends_on) then
  raise exception 'This staff member has approved leave on that date';
 end if;
 shift_start:=new.shift_date::timestamp+new.starts_at;
 shift_end:=new.shift_date::timestamp+new.ends_at;
 if exists(
  select 1 from public.staff_shifts s
  where s.staff_id=new.staff_id and s.status='scheduled' and s.id is distinct from new.id
   and tstzrange(s.shift_date::timestamp+s.starts_at,s.shift_date::timestamp+s.ends_at,'[)') && tstzrange(shift_start,shift_end,'[)')
 ) then raise exception 'This staff member already has an overlapping shift'; end if;
 return new;
end; $$;
drop trigger if exists validate_staff_shift_before_write on public.staff_shifts;
create trigger validate_staff_shift_before_write before insert or update of staff_id,department_id,shift_date,starts_at,ends_at,status
 on public.staff_shifts for each row execute function public.validate_staff_shift();

create or replace function public.set_staff_shift_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists staff_shifts_updated_at on public.staff_shifts;
create trigger staff_shifts_updated_at before update on public.staff_shifts for each row execute function public.set_staff_shift_updated_at();

create or replace function public.cancel_staff_shift(p_shift_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.staff_shifts%rowtype;
begin
 select * into s from public.staff_shifts where id=p_shift_id for update;
 if not found then raise exception 'Shift not found'; end if;
 if not (public.is_owner() or (public.current_user_role()='manager' and public.current_user_department()=s.department_id)) then
  raise exception 'You cannot manage this shift';
 end if;
 if s.status<>'scheduled' then raise exception 'Only scheduled shifts can be cancelled'; end if;
 update public.staff_shifts set status='cancelled' where id=p_shift_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Cancelled staff shift','staff_shift',p_shift_id,jsonb_build_object('staff_id',s.staff_id,'shift_date',s.shift_date));
end; $$;
revoke all on function public.cancel_staff_shift(uuid) from public;
grant execute on function public.cancel_staff_shift(uuid) to authenticated;

create trigger audit_staff_shifts after insert or update or delete on public.staff_shifts
 for each row execute function public.write_audit_event();
