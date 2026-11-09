-- Owner-controlled payroll preparation and payment tracking.
-- This migration is committed for review only. It is not applied to Supabase.

create table if not exists public.staff_salary_settings (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null unique references public.profiles(id) on delete restrict,
  base_salary numeric(14,2) not null check (base_salary > 0),
  allowances numeric(14,2) not null default 0 check (allowances >= 0),
  default_deductions numeric(14,2) not null default 0 check (default_deductions >= 0),
  effective_from date not null default current_date,
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (base_salary + allowances >= default_deductions)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
    check (status in ('draft','approved','partially_paid','paid')),
  total_gross numeric(14,2) not null default 0 check (total_gross >= 0),
  total_deductions numeric(14,2) not null default 0 check (total_deductions >= 0),
  total_net numeric(14,2) not null default 0 check (total_net >= 0),
  notes text,
  prepared_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (period_start, period_end),
  check (period_end >= period_start),
  check ((status = 'draft' and approved_at is null) or status <> 'draft')
);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete restrict,
  staff_id uuid not null references public.profiles(id) on delete restrict,
  base_salary numeric(14,2) not null check (base_salary > 0),
  allowances numeric(14,2) not null default 0 check (allowances >= 0),
  deductions numeric(14,2) not null default 0 check (deductions >= 0),
  net_pay numeric(14,2) not null check (net_pay >= 0),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid')),
  payment_method text check (payment_method is null or payment_method in ('cash','mobile_money','bank_transfer')),
  payment_reference text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (payroll_run_id, staff_id),
  check (base_salary + allowances >= deductions),
  check (
    (payment_status = 'pending' and paid_at is null and paid_by is null)
    or (payment_status = 'paid' and paid_at is not null and paid_by is not null and payment_reference is not null)
  )
);

create index if not exists payroll_runs_period_idx on public.payroll_runs(period_start desc);
create index if not exists payroll_items_staff_idx on public.payroll_items(staff_id, created_at desc);

alter table public.staff_salary_settings enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;

drop policy if exists "owner reads salary settings" on public.staff_salary_settings;
create policy "owner reads salary settings" on public.staff_salary_settings
  for select to authenticated using (public.is_owner());

drop policy if exists "owner reads payroll runs" on public.payroll_runs;
create policy "owner reads payroll runs" on public.payroll_runs
  for select to authenticated using (public.is_owner());

drop policy if exists "owner reads payroll items" on public.payroll_items;
create policy "owner reads payroll items" on public.payroll_items
  for select to authenticated using (public.is_owner());

create or replace function public.staff_can_read_payroll_item(p_run_id uuid, p_staff_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_staff_id = auth.uid() and exists (
    select 1 from public.payroll_runs r
    where r.id = p_run_id and r.status in ('approved','partially_paid','paid')
  );
$$;
revoke all on function public.staff_can_read_payroll_item(uuid,uuid) from public;
grant execute on function public.staff_can_read_payroll_item(uuid,uuid) to authenticated;

create or replace function public.staff_can_read_payroll_run(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_runs r
    join public.payroll_items i on i.payroll_run_id = r.id
    where r.id = p_run_id and i.staff_id = auth.uid()
      and r.status in ('approved','partially_paid','paid')
  );
$$;
revoke all on function public.staff_can_read_payroll_run(uuid) from public;
grant execute on function public.staff_can_read_payroll_run(uuid) to authenticated;

drop policy if exists "staff reads own approved payroll runs" on public.payroll_runs;
create policy "staff reads own approved payroll runs" on public.payroll_runs
  for select to authenticated using (public.staff_can_read_payroll_run(id));

drop policy if exists "staff reads own approved payslips" on public.payroll_items;
create policy "staff reads own approved payslips" on public.payroll_items
  for select to authenticated using (public.staff_can_read_payroll_item(payroll_run_id, staff_id));

grant select on public.staff_salary_settings, public.payroll_runs, public.payroll_items to authenticated;

create or replace function public.save_staff_salary(
  p_staff_id uuid,
  p_base_salary numeric,
  p_allowances numeric default 0,
  p_default_deductions numeric default 0,
  p_effective_from date default current_date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare setting_id uuid;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_staff_id is null or p_base_salary is null or p_base_salary <= 0
     or coalesce(p_allowances,0) < 0 or coalesce(p_default_deductions,0) < 0 then
    raise exception 'Enter a valid staff member and non-negative salary amounts';
  end if;
  if p_base_salary + coalesce(p_allowances,0) < coalesce(p_default_deductions,0) then
    raise exception 'Deductions cannot exceed salary plus allowances';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_staff_id and is_active = true and role in ('staff','manager')
  ) then raise exception 'Choose an active staff member or manager'; end if;

  insert into public.staff_salary_settings(
    staff_id, base_salary, allowances, default_deductions, effective_from, updated_by, updated_at
  ) values (
    p_staff_id, p_base_salary, coalesce(p_allowances,0),
    coalesce(p_default_deductions,0), coalesce(p_effective_from,current_date), auth.uid(), now()
  )
  on conflict (staff_id) do update set
    base_salary = excluded.base_salary,
    allowances = excluded.allowances,
    default_deductions = excluded.default_deductions,
    effective_from = excluded.effective_from,
    is_active = true,
    updated_by = auth.uid(),
    updated_at = now()
  returning id into setting_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values(auth.uid(), 'Updated staff salary settings', 'staff_salary_setting', setting_id,
    jsonb_build_object('staff_id',p_staff_id,'effective_from',p_effective_from));
  return setting_id;
end;
$$;

create or replace function public.create_payroll_run(
  p_period_start date,
  p_period_end date,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  run_id uuid;
  employee_count integer;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_period_start is null or p_period_end is null
     or p_period_start <> date_trunc('month', p_period_start)::date
     or p_period_end <> (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date then
    raise exception 'Select a complete calendar month for payroll';
  end if;
  if p_period_start > current_date then raise exception 'A future payroll period cannot be prepared'; end if;
  if exists(select 1 from public.payroll_runs where period_start=p_period_start and period_end=p_period_end) then
    raise exception 'A payroll run already exists for this month';
  end if;

  insert into public.payroll_runs(period_start,period_end,notes,prepared_by)
  values(p_period_start,p_period_end,nullif(trim(p_notes),''),auth.uid())
  returning id into run_id;

  insert into public.payroll_items(
    payroll_run_id,staff_id,base_salary,allowances,deductions,net_pay
  )
  select run_id, s.staff_id, s.base_salary, s.allowances, s.default_deductions,
         s.base_salary + s.allowances - s.default_deductions
  from public.staff_salary_settings s
  join public.profiles p on p.id=s.staff_id
  where s.is_active = true and s.effective_from <= p_period_start
    and p.is_active = true and p.role in ('staff','manager');

  get diagnostics employee_count = row_count;
  if employee_count = 0 then
    delete from public.payroll_runs where id=run_id;
    raise exception 'No active staff have salary settings effective from the first day of this month';
  end if;

  update public.payroll_runs r set
    total_gross = x.gross,
    total_deductions = x.deductions,
    total_net = x.net
  from (
    select sum(base_salary + allowances) as gross,
           sum(deductions) as deductions,
           sum(net_pay) as net
    from public.payroll_items where payroll_run_id=run_id
  ) x where r.id=run_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Prepared monthly payroll','payroll_run',run_id,
    jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'staff_count',employee_count));
  return run_id;
end;
$$;

create or replace function public.approve_payroll_run(p_payroll_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare target public.payroll_runs%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  select * into target from public.payroll_runs where id=p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if target.status <> 'draft' then raise exception 'Only a draft payroll run can be approved'; end if;
  if not exists(select 1 from public.payroll_items where payroll_run_id=target.id) then
    raise exception 'Payroll run has no staff entries';
  end if;
  update public.payroll_runs set status='approved',approved_by=auth.uid(),approved_at=now()
  where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id)
  values(auth.uid(),'Approved monthly payroll','payroll_run',target.id);
end;
$$;

create or replace function public.record_payroll_payment(
  p_payroll_item_id uuid,
  p_payment_method text,
  p_payment_reference text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.payroll_items%rowtype;
  run_status text;
  remaining_count integer;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_payment_method not in ('cash','mobile_money','bank_transfer') then
    raise exception 'Choose cash, mobile money or bank transfer';
  end if;
  if length(trim(coalesce(p_payment_reference,''))) < 3 then
    raise exception 'Enter the actual payment receipt or transaction reference';
  end if;

  select * into target from public.payroll_items where id=p_payroll_item_id for update;
  if not found then raise exception 'Payroll entry not found'; end if;
  select status into run_status from public.payroll_runs where id=target.payroll_run_id for update;
  if run_status not in ('approved','partially_paid') then
    raise exception 'Only approved payroll can be paid';
  end if;
  if target.payment_status <> 'pending' then raise exception 'This salary has already been recorded as paid'; end if;

  update public.payroll_items set
    payment_status='paid',payment_method=p_payment_method,
    payment_reference=trim(p_payment_reference),paid_at=now(),paid_by=auth.uid()
  where id=target.id;

  select count(*) into remaining_count from public.payroll_items
  where payroll_run_id=target.payroll_run_id and payment_status='pending';
  update public.payroll_runs set status=case when remaining_count=0 then 'paid' else 'partially_paid' end
  where id=target.payroll_run_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Recorded staff salary payment','payroll_item',target.id,
    jsonb_build_object('staff_id',target.staff_id,'amount',target.net_pay,
      'payment_method',p_payment_method,'payment_reference',trim(p_payment_reference)));
end;
$$;

revoke all on function public.save_staff_salary(uuid,numeric,numeric,numeric,date) from public;
revoke all on function public.create_payroll_run(date,date,text) from public;
revoke all on function public.approve_payroll_run(uuid) from public;
revoke all on function public.record_payroll_payment(uuid,text,text) from public;
grant execute on function public.save_staff_salary(uuid,numeric,numeric,numeric,date) to authenticated;
grant execute on function public.create_payroll_run(date,date,text) to authenticated;
grant execute on function public.approve_payroll_run(uuid) to authenticated;
grant execute on function public.record_payroll_payment(uuid,text,text) to authenticated;
