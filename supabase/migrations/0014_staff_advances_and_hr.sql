-- Staff advances, repayment scheduling and HR-submitted salary deductions.
-- Apply only after reviewing migration 0013. This file is committed, not applied.

insert into public.departments(name, slug, owner_only)
values ('Human Resources', 'human-resources', false)
on conflict (slug) do nothing;

create or replace function public.is_hr_manager()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_user_role() = 'manager'
    and public.current_user_department() = (
      select id from public.departments where slug = 'human-resources' limit 1
    ), false
  );
$$;
revoke all on function public.is_hr_manager() from public;
grant execute on function public.is_hr_manager() to authenticated;

create table if not exists public.staff_advance_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  repayment_per_month numeric(14,2) not null check (repayment_per_month > 0),
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','disbursed')),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  disbursement_method text check (disbursement_method is null or disbursement_method in ('cash','mobile_money','bank_transfer')),
  disbursement_reference text,
  disbursed_by uuid references public.profiles(id),
  disbursed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'rejected' and rejection_reason is not null)
    or status <> 'rejected'
  ),
  check (
    (status = 'disbursed' and disbursed_at is not null and disbursed_by is not null and disbursement_reference is not null)
    or status <> 'disbursed'
  )
);

create table if not exists public.staff_advance_repayments (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.staff_advance_requests(id) on delete restrict,
  payroll_item_id uuid not null references public.payroll_items(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'scheduled' check (status in ('scheduled','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (advance_id, payroll_item_id),
  check ((status = 'scheduled' and paid_at is null) or (status = 'paid' and paid_at is not null))
);

create table if not exists public.salary_deduction_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) >= 5),
  effective_month date not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','scheduled','applied')),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  payroll_item_id uuid references public.payroll_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (effective_month = date_trunc('month', effective_month)::date),
  check ((status = 'rejected' and rejection_reason is not null) or status <> 'rejected'),
  check (
    (status in ('scheduled','applied') and payroll_item_id is not null)
    or status not in ('scheduled','applied')
  )
);

create index if not exists staff_advances_staff_idx on public.staff_advance_requests(staff_id, created_at desc);
create index if not exists advance_repayments_item_idx on public.staff_advance_repayments(payroll_item_id);
create index if not exists salary_deduction_month_idx on public.salary_deduction_requests(effective_month, status);

alter table public.payroll_items
  add column if not exists advance_deductions numeric(14,2) not null default 0 check (advance_deductions >= 0),
  add column if not exists other_deductions numeric(14,2) not null default 0 check (other_deductions >= 0);

alter table public.staff_advance_requests enable row level security;
alter table public.staff_advance_repayments enable row level security;
alter table public.salary_deduction_requests enable row level security;

drop policy if exists "owner reads staff advance requests" on public.staff_advance_requests;
create policy "owner reads staff advance requests" on public.staff_advance_requests
  for select to authenticated using (public.is_owner());
drop policy if exists "hr reads staff advance requests" on public.staff_advance_requests;
create policy "hr reads staff advance requests" on public.staff_advance_requests
  for select to authenticated using (public.is_hr_manager());

drop policy if exists "owner reads advance repayments" on public.staff_advance_repayments;
create policy "owner reads advance repayments" on public.staff_advance_repayments
  for select to authenticated using (public.is_owner());
drop policy if exists "hr reads advance repayments" on public.staff_advance_repayments;
create policy "hr reads advance repayments" on public.staff_advance_repayments
  for select to authenticated using (public.is_hr_manager());

drop policy if exists "owner reads salary deduction requests" on public.salary_deduction_requests;
create policy "owner reads salary deduction requests" on public.salary_deduction_requests
  for select to authenticated using (public.is_owner());
drop policy if exists "hr reads salary deduction requests" on public.salary_deduction_requests;
create policy "hr reads salary deduction requests" on public.salary_deduction_requests
  for select to authenticated using (public.is_hr_manager());

grant select on public.staff_advance_requests, public.staff_advance_repayments, public.salary_deduction_requests to authenticated;

create or replace function public.hr_staff_directory()
returns table(staff_id uuid, full_name text, role text, department_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr_manager() then raise exception 'HR manager access required'; end if;
  return query
    select p.id, p.full_name, p.role, coalesce(d.name, 'Unassigned')
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    where p.is_active = true and p.role in ('staff','manager')
    order by p.full_name;
end;
$$;

create or replace function public.submit_staff_advance_request(
  p_staff_id uuid,
  p_amount numeric,
  p_repayment_per_month numeric,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare request_id uuid;
begin
  if not public.is_hr_manager() then raise exception 'HR manager access required'; end if;
  if p_amount is null or p_amount <= 0 or p_repayment_per_month is null
     or p_repayment_per_month <= 0 or p_repayment_per_month > p_amount or length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Enter a valid amount, monthly repayment and reason';
  end if;
  if not exists(select 1 from public.profiles where id=p_staff_id and is_active=true and role in ('staff','manager')) then
    raise exception 'Select an active hotel employee';
  end if;
  insert into public.staff_advance_requests(staff_id,amount,repayment_per_month,reason,requested_by)
  values(p_staff_id,p_amount,p_repayment_per_month,trim(p_reason),auth.uid())
  returning id into request_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Submitted staff advance request','staff_advance_request',request_id,
    jsonb_build_object('staff_id',p_staff_id,'amount',p_amount,'repayment_per_month',p_repayment_per_month));
  return request_id;
end;
$$;

create or replace function public.submit_salary_deduction_request(
  p_staff_id uuid,
  p_amount numeric,
  p_reason text,
  p_effective_month date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare request_id uuid;
begin
  if not public.is_hr_manager() then raise exception 'HR manager access required'; end if;
  if p_amount is null or p_amount <= 0 or length(trim(coalesce(p_reason,''))) < 5
     or p_effective_month is null
     or p_effective_month <> date_trunc('month',p_effective_month)::date
     or p_effective_month < date_trunc('month',current_date)::date then
    raise exception 'Enter a valid amount, reason and current or future payroll month';
  end if;
  if not exists(select 1 from public.profiles where id=p_staff_id and is_active=true and role in ('staff','manager')) then
    raise exception 'Select an active hotel employee';
  end if;
  insert into public.salary_deduction_requests(staff_id,amount,reason,effective_month,requested_by)
  values(p_staff_id,p_amount,trim(p_reason),p_effective_month,auth.uid())
  returning id into request_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Submitted salary deduction request','salary_deduction_request',request_id,
    jsonb_build_object('staff_id',p_staff_id,'amount',p_amount,'effective_month',p_effective_month));
  return request_id;
end;
$$;

create or replace function public.review_staff_advance_request(
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare target public.staff_advance_requests%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner approval required'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Choose approve or reject'; end if;
  if p_decision='reject' and length(trim(coalesce(p_rejection_reason,''))) < 5 then
    raise exception 'A clear rejection reason is required';
  end if;
  select * into target from public.staff_advance_requests where id=p_request_id for update;
  if not found or target.status <> 'pending' then raise exception 'Pending advance request not found'; end if;
  update public.staff_advance_requests set
    status=case when p_decision='approve' then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),
    rejection_reason=case when p_decision='reject' then trim(p_rejection_reason) else null end
  where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when p_decision='approve' then 'Approved staff advance request' else 'Rejected staff advance request' end,
    'staff_advance_request',target.id,jsonb_build_object('staff_id',target.staff_id,'amount',target.amount));
end;
$$;

create or replace function public.record_staff_advance_disbursement(
  p_request_id uuid,
  p_payment_method text,
  p_payment_reference text
) returns void
language plpgsql security definer set search_path = public as $$
declare target public.staff_advance_requests%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner disbursement access required'; end if;
  if p_payment_method not in ('cash','mobile_money','bank_transfer')
     or length(trim(coalesce(p_payment_reference,''))) < 3 then
    raise exception 'Choose a payment method and enter the actual disbursement reference';
  end if;
  select * into target from public.staff_advance_requests where id=p_request_id for update;
  if not found or target.status <> 'approved' then raise exception 'Only an approved advance can be disbursed'; end if;
  update public.staff_advance_requests set
    status='disbursed',disbursement_method=p_payment_method,
    disbursement_reference=trim(p_payment_reference),disbursed_by=auth.uid(),disbursed_at=now()
  where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Recorded staff advance disbursement','staff_advance_request',target.id,
    jsonb_build_object('staff_id',target.staff_id,'amount',target.amount,'payment_method',p_payment_method,'reference',trim(p_payment_reference)));
end;
$$;

create or replace function public.review_salary_deduction_request(
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare target public.salary_deduction_requests%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner approval required'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Choose approve or reject'; end if;
  if p_decision='reject' and length(trim(coalesce(p_rejection_reason,''))) < 5 then
    raise exception 'A clear rejection reason is required';
  end if;
  select * into target from public.salary_deduction_requests where id=p_request_id for update;
  if not found or target.status <> 'pending' then raise exception 'Pending salary deduction request not found'; end if;
  update public.salary_deduction_requests set
    status=case when p_decision='approve' then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),
    rejection_reason=case when p_decision='reject' then trim(p_rejection_reason) else null end
  where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when p_decision='approve' then 'Approved salary deduction request' else 'Rejected salary deduction request' end,
    'salary_deduction_request',target.id,jsonb_build_object('staff_id',target.staff_id,'amount',target.amount));
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
  payroll_item public.payroll_items%rowtype;
  advance_row public.staff_advance_requests%rowtype;
  deduction_request public.salary_deduction_requests%rowtype;
  repaid numeric(14,2);
  advance_total numeric(14,2);
  other_total numeric(14,2);
  has_scheduled boolean;
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

  insert into public.payroll_items(payroll_run_id,staff_id,base_salary,allowances,deductions,net_pay)
  select run_id,s.staff_id,s.base_salary,s.allowances,s.default_deductions,
         s.base_salary+s.allowances-s.default_deductions
  from public.staff_salary_settings s
  join public.profiles p on p.id=s.staff_id
  where s.is_active=true and s.effective_from<=p_period_start
    and p.is_active=true and p.role in ('staff','manager');

  get diagnostics employee_count = row_count;
  if employee_count=0 then
    delete from public.payroll_runs where id=run_id;
    raise exception 'No active staff have salary settings effective from the first day of this month';
  end if;

  for payroll_item in select * from public.payroll_items where payroll_run_id=run_id for update loop
    advance_total := 0;
    other_total := 0;

    for advance_row in
      select * from public.staff_advance_requests
      where staff_id=payroll_item.staff_id and status='disbursed'
      order by disbursed_at, created_at
      for update
    loop
      select coalesce(sum(amount),0), coalesce(bool_or(status='scheduled'),false)
      into repaid, has_scheduled
      from public.staff_advance_repayments where advance_id=advance_row.id;

      -- Never schedule a second instalment while an earlier payroll deduction is unpaid.
      if not has_scheduled and repaid < advance.amount then
        insert into public.staff_advance_repayments(advance_id,payroll_item_id,amount)
        values(advance_row.id,payroll_item.id,least(advance_row.repayment_per_month,advance_row.amount-repaid));
        advance_total := advance_total + least(advance_row.repayment_per_month,advance_row.amount-repaid);
      end if;
    end loop;

    for deduction_request in
      select * from public.salary_deduction_requests
      where staff_id=payroll_item.staff_id
        and effective_month=p_period_start and status='approved'
      order by created_at
      for update
    loop
      other_total := other_total + deduction_request.amount;
      update public.salary_deduction_requests
      set status='scheduled',payroll_item_id=payroll_item.id
      where id=deduction_request.id;
    end loop;

    if payroll_item.base_salary + payroll_item.allowances
       < payroll_item.deductions + advance_total + other_total then
      raise exception 'Deductions exceed gross pay for staff record %. Review the approved deductions and advance instalments.', payroll_item.staff_id;
    end if;

    update public.payroll_items set
      advance_deductions=advance_total,
      other_deductions=other_total,
      deductions=deductions+advance_total+other_total,
      net_pay=base_salary+allowances-deductions-advance_total-other_total
    where id=payroll_item.id;
  end loop;

  update public.payroll_runs r set
    total_gross=x.gross,total_deductions=x.deductions,total_net=x.net
  from (
    select sum(base_salary+allowances) as gross,sum(deductions) as deductions,sum(net_pay) as net
    from public.payroll_items where payroll_run_id=run_id
  ) x where r.id=run_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Prepared monthly payroll with advances and deductions','payroll_run',run_id,
    jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'staff_count',employee_count));
  return run_id;
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
  if run_status not in ('approved','partially_paid') then raise exception 'Only approved payroll can be paid'; end if;
  if target.payment_status <> 'pending' then raise exception 'This salary has already been recorded as paid'; end if;

  update public.payroll_items set payment_status='paid',payment_method=p_payment_method,
    payment_reference=trim(p_payment_reference),paid_at=now(),paid_by=auth.uid()
  where id=target.id;

  update public.staff_advance_repayments set status='paid',paid_at=now()
  where payroll_item_id=target.id and status='scheduled';
  update public.salary_deduction_requests set status='applied'
  where payroll_item_id=target.id and status='scheduled';

  select count(*) into remaining_count from public.payroll_items
  where payroll_run_id=target.payroll_run_id and payment_status='pending';
  update public.payroll_runs set status=case when remaining_count=0 then 'paid' else 'partially_paid' end
  where id=target.payroll_run_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Recorded staff salary payment','payroll_item',target.id,
    jsonb_build_object('staff_id',target.staff_id,'amount',target.net_pay,
      'advance_deductions',target.advance_deductions,'other_deductions',target.other_deductions,
      'payment_method',p_payment_method,'payment_reference',trim(p_payment_reference)));
end;
$$;

revoke all on function public.hr_staff_directory() from public;
revoke all on function public.submit_staff_advance_request(uuid,numeric,numeric,text) from public;
revoke all on function public.submit_salary_deduction_request(uuid,numeric,text,date) from public;
revoke all on function public.review_staff_advance_request(uuid,text,text) from public;
revoke all on function public.record_staff_advance_disbursement(uuid,text,text) from public;
revoke all on function public.review_salary_deduction_request(uuid,text,text) from public;
revoke all on function public.create_payroll_run(date,date,text) from public;
revoke all on function public.record_payroll_payment(uuid,text,text) from public;

grant execute on function public.hr_staff_directory() to authenticated;
grant execute on function public.submit_staff_advance_request(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.submit_salary_deduction_request(uuid,numeric,text,date) to authenticated;
grant execute on function public.review_staff_advance_request(uuid,text,text) to authenticated;
grant execute on function public.record_staff_advance_disbursement(uuid,text,text) to authenticated;
grant execute on function public.review_salary_deduction_request(uuid,text,text) to authenticated;
grant execute on function public.create_payroll_run(date,date,text) to authenticated;
grant execute on function public.record_payroll_payment(uuid,text,text) to authenticated;
