-- Safe cancellation and recreation of unpaid draft payroll runs.
-- Apply after migrations 0013 and 0014.

alter table public.payroll_runs
  drop constraint if exists payroll_runs_status_check;

alter table public.payroll_runs
  add constraint payroll_runs_status_check
  check (status in ('draft','approved','partially_paid','paid','cancelled'));

alter table public.payroll_runs
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id);

-- A cancelled run remains as an auditable record, while a replacement run
-- for the same calendar month is permitted.
alter table public.payroll_runs
  drop constraint if exists payroll_runs_period_start_period_end_key;

create unique index if not exists payroll_runs_active_period_uidx
  on public.payroll_runs(period_start, period_end)
  where status <> 'cancelled';

create or replace function public.cancel_draft_payroll_run(
  p_payroll_run_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.payroll_runs%rowtype;
  item_count integer;
  released_advances integer;
  released_deductions integer;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_payroll_run_id is null or length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Enter a cancellation reason of at least five characters';
  end if;

  -- Lock the run first. Payment recording uses the same lock order.
  select * into target
  from public.payroll_runs
  where id = p_payroll_run_id
  for update;

  if not found then raise exception 'Payroll run not found'; end if;
  if target.status <> 'draft' then
    raise exception 'Only an unpaid draft payroll run can be cancelled';
  end if;

  perform 1
  from public.payroll_items
  where payroll_run_id = target.id
  order by id
  for update;

  if exists (
    select 1 from public.payroll_items
    where payroll_run_id = target.id and payment_status <> 'pending'
  ) then
    raise exception 'A payroll run with recorded payments cannot be cancelled';
  end if;

  delete from public.staff_advance_repayments r
  using public.payroll_items i
  where r.payroll_item_id = i.id
    and i.payroll_run_id = target.id
    and r.status = 'scheduled';
  get diagnostics released_advances = row_count;

  update public.salary_deduction_requests d
  set status = 'approved', payroll_item_id = null
  from public.payroll_items i
  where d.payroll_item_id = i.id
    and i.payroll_run_id = target.id
    and d.status = 'scheduled';
  get diagnostics released_deductions = row_count;

  delete from public.payroll_items where payroll_run_id = target.id;
  get diagnostics item_count = row_count;

  update public.payroll_runs
  set status = 'cancelled',
      cancellation_reason = trim(p_reason),
      cancelled_at = now(),
      cancelled_by = auth.uid()
  where id = target.id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),
    'Cancelled draft payroll run',
    'payroll_run',
    target.id,
    jsonb_build_object(
      'period_start', target.period_start,
      'period_end', target.period_end,
      'reason', trim(p_reason),
      'payroll_items_removed', item_count,
      'advance_repayments_released', released_advances,
      'salary_deductions_released', released_deductions
    )
  );
end;
$$;

-- Consistent lock order prevents a cancellation/payment deadlock.
create or replace function public.record_payroll_payment(
  p_payroll_item_id uuid,
  p_payment_method text,
  p_payment_reference text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.payroll_items%rowtype;
  target_run_id uuid;
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

  select payroll_run_id into target_run_id
  from public.payroll_items where id = p_payroll_item_id;
  if not found then raise exception 'Payroll entry not found'; end if;

  select status into run_status
  from public.payroll_runs where id = target_run_id for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if run_status not in ('approved','partially_paid') then
    raise exception 'Only approved payroll can be paid';
  end if;

  select * into target
  from public.payroll_items
  where id = p_payroll_item_id and payroll_run_id = target_run_id
  for update;
  if not found then raise exception 'Payroll entry not found'; end if;
  if target.payment_status <> 'pending' then
    raise exception 'This salary has already been recorded as paid';
  end if;

  update public.payroll_items
  set payment_status='paid',payment_method=p_payment_method,
      payment_reference=trim(p_payment_reference),paid_at=now(),paid_by=auth.uid()
  where id=target.id;

  update public.staff_advance_repayments
  set status='paid',paid_at=now()
  where payroll_item_id=target.id and status='scheduled';

  update public.salary_deduction_requests
  set status='applied'
  where payroll_item_id=target.id and status='scheduled';

  select count(*) into remaining_count
  from public.payroll_items
  where payroll_run_id=target_run_id and payment_status='pending';

  update public.payroll_runs
  set status=case when remaining_count=0 then 'paid' else 'partially_paid' end
  where id=target_run_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Recorded staff salary payment','payroll_item',target.id,
    jsonb_build_object(
      'staff_id',target.staff_id,
      'amount',target.net_pay,
      'advance_deductions',target.advance_deductions,
      'other_deductions',target.other_deductions,
      'payment_method',p_payment_method,
      'payment_reference',trim(p_payment_reference)
    ));
end;
$$;

revoke all on function public.cancel_draft_payroll_run(uuid,text) from public;
grant execute on function public.cancel_draft_payroll_run(uuid,text) to authenticated;
revoke all on function public.record_payroll_payment(uuid,text,text) from public;
grant execute on function public.record_payroll_payment(uuid,text,text) to authenticated;
