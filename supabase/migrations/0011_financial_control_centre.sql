-- Financial control centre: expense approvals and cashier shift reconciliation.
-- Apply this migration in Supabase after reviewing it. It is not executed by this commit.

alter table public.expenses
  add column if not exists description text,
  add column if not exists category text not null default 'general',
  add column if not exists payment_method text,
  add column if not exists receipt_reference text,
  add column if not exists rejection_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.expenses
  drop constraint if exists expenses_payment_method_check;
alter table public.expenses
  add constraint expenses_payment_method_check
  check (payment_method is null or payment_method in ('cash','mobile_money','card','bank_transfer','pesapal'));

create index if not exists expenses_approval_created_idx
  on public.expenses(approval_status, created_at desc);
create index if not exists payments_received_by_created_idx
  on public.payments(received_by, created_at desc)
  where received_by is not null and status='completed';

create table if not exists public.cashier_sessions (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles(id),
  department_id uuid references public.departments(id),
  opening_float numeric(14,2) not null default 0 check(opening_float >= 0),
  closing_cash numeric(14,2),
  expected_cash numeric(14,2),
  cash_sales numeric(14,2),
  non_cash_sales numeric(14,2),
  cash_variance numeric(14,2),
  status text not null default 'open' check(status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_notes text,
  closing_notes text,
  created_at timestamptz not null default now(),
  check ((status='open' and closed_at is null and closing_cash is null)
      or (status='closed' and closed_at is not null and closing_cash is not null))
);
create unique index if not exists one_open_cashier_session_per_user
  on public.cashier_sessions(cashier_id) where status='open';
create index if not exists cashier_sessions_opened_idx
  on public.cashier_sessions(opened_at desc);

alter table public.cashier_sessions enable row level security;
drop policy if exists "owner read cashier sessions" on public.cashier_sessions;
create policy "owner read cashier sessions" on public.cashier_sessions
  for select to authenticated using(public.is_owner());
drop policy if exists "manager read own cashier sessions" on public.cashier_sessions;
create policy "manager read own cashier sessions" on public.cashier_sessions
  for select to authenticated using(
    public.current_user_role()='manager' and cashier_id=auth.uid()
  );

-- Requests are submitted by managers for their own department. The owner can
-- submit a request for any department, but approval remains a separate action.
create or replace function public.submit_expense_request(
  p_title text,
  p_amount numeric,
  p_department_id uuid default null,
  p_description text default null,
  p_category text default 'general',
  p_payment_method text default null,
  p_receipt_reference text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  actor_role text;
  actor_department uuid;
  expense_id uuid;
begin
  actor_role:=public.current_user_role();
  actor_department:=public.current_user_department();
  if actor_role not in ('owner','manager') then
    raise exception 'Manager or owner access required';
  end if;
  if nullif(trim(p_title),'') is null then raise exception 'Expense title is required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
  if p_payment_method is not null and p_payment_method not in ('cash','mobile_money','card','bank_transfer','pesapal') then
    raise exception 'Choose a valid payment method';
  end if;
  if actor_role='manager' then
    if p_department_id is not null and p_department_id<>actor_department then
      raise exception 'You can only submit expenses for your department';
    end if;
    p_department_id:=actor_department;
  end if;
  insert into public.expenses(
    title,description,amount,department_id,created_by,approval_status,
    category,payment_method,receipt_reference
  ) values (
    trim(p_title),nullif(trim(p_description),''),p_amount,p_department_id,auth.uid(),'pending',
    coalesce(nullif(trim(p_category),''),'general'),p_payment_method,nullif(trim(p_receipt_reference),'')
  ) returning id into expense_id;
  return expense_id;
end;
$$;
revoke all on function public.submit_expense_request(text,numeric,uuid,text,text,text,text) from public;
grant execute on function public.submit_expense_request(text,numeric,uuid,text,text,text,text) to authenticated;

create or replace function public.review_expense_request(
  p_expense_id uuid,
  p_decision text,
  p_rejection_reason text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare target public.expenses%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  if p_decision='rejected' and nullif(trim(p_rejection_reason),'') is null then
    raise exception 'Provide a reason when rejecting an expense';
  end if;
  select * into target from public.expenses where id=p_expense_id for update;
  if not found then raise exception 'Expense request not found'; end if;
  if target.approval_status<>'pending' then raise exception 'Only pending requests can be reviewed'; end if;
  update public.expenses
  set approval_status=p_decision,
      approved_by=auth.uid(),
      rejection_reason=case when p_decision='rejected' then trim(p_rejection_reason) else null end,
      updated_at=now()
  where id=p_expense_id;
end;
$$;
revoke all on function public.review_expense_request(uuid,text,text) from public;
grant execute on function public.review_expense_request(uuid,text,text) to authenticated;

create or replace function public.open_cashier_session(
  p_opening_float numeric default 0,
  p_opening_notes text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor_role text; actor_department uuid; session_id uuid;
begin
  actor_role:=public.current_user_role();
  actor_department:=public.current_user_department();
  if actor_role not in ('owner','manager') then raise exception 'Manager or owner access required'; end if;
  if p_opening_float is null or p_opening_float<0 then raise exception 'Opening float cannot be negative'; end if;
  if actor_role='manager' and not exists(
    select 1 from public.departments where id=actor_department and slug in ('front-desk','restaurant-kitchen','bar')
  ) then raise exception 'Your department is not authorised to operate a cashier shift'; end if;
  insert into public.cashier_sessions(cashier_id,department_id,opening_float,opening_notes)
  values(auth.uid(),actor_department,p_opening_float,nullif(trim(p_opening_notes),''))
  returning id into session_id;
  return session_id;
exception when unique_violation then
  raise exception 'You already have an open cashier shift. Close it before opening another.';
end;
$$;
revoke all on function public.open_cashier_session(numeric,text) from public;
grant execute on function public.open_cashier_session(numeric,text) to authenticated;

create or replace function public.close_cashier_session(
  p_counted_cash numeric,
  p_closing_notes text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  target public.cashier_sessions%rowtype;
  cash_total numeric(14,2);
  non_cash_total numeric(14,2);
  expected numeric(14,2);
  variance numeric(14,2);
begin
  if public.current_user_role() not in ('owner','manager') then raise exception 'Manager or owner access required'; end if;
  if p_counted_cash is null or p_counted_cash<0 then raise exception 'Counted cash cannot be negative'; end if;
  select * into target from public.cashier_sessions
    where cashier_id=auth.uid() and status='open' for update;
  if not found then raise exception 'No open cashier shift found for your account'; end if;
  select
    coalesce(sum(amount) filter(where payment_method='cash'),0),
    coalesce(sum(amount) filter(where payment_method is distinct from 'cash'),0)
  into cash_total,non_cash_total
  from public.payments
  where received_by=auth.uid()
    and status='completed'
    and created_at>=target.opened_at
    and created_at<=now();
  expected:=target.opening_float+cash_total;
  variance:=p_counted_cash-expected;
  update public.cashier_sessions
  set closing_cash=p_counted_cash,
      expected_cash=expected,
      cash_sales=cash_total,
      non_cash_sales=non_cash_total,
      cash_variance=variance,
      status='closed',
      closed_at=now(),
      closing_notes=nullif(trim(p_closing_notes),'')
  where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Closed cashier shift','cashier_session',target.id,
    jsonb_build_object('opening_float',target.opening_float,'cash_sales',cash_total,
      'non_cash_sales',non_cash_total,'expected_cash',expected,
      'counted_cash',p_counted_cash,'variance',variance));
  return jsonb_build_object(
    'session_id',target.id,'opening_float',target.opening_float,
    'cash_sales',cash_total,'non_cash_sales',non_cash_total,
    'expected_cash',expected,'counted_cash',p_counted_cash,'variance',variance
  );
end;
$$;
revoke all on function public.close_cashier_session(numeric,text) from public;
grant execute on function public.close_cashier_session(numeric,text) to authenticated;

-- Session opening/closing is only possible through the RPCs above. The
-- owner can inspect all shifts; managers can inspect their own shifts only.


-- Keep cashier shift opening and closing visible in the existing owner audit log.
drop trigger if exists audit_cashier_sessions on public.cashier_sessions;
create trigger audit_cashier_sessions
after insert or update or delete on public.cashier_sessions
for each row execute function public.write_audit_event();
