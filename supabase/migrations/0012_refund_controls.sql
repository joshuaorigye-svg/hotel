-- Refund request and owner-controlled settlement workflow.
-- Processing records a refund already executed with the payment provider or bank.
-- This migration never sends money or calls a payment gateway.

create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 5 and 1000),
  requested_by uuid not null references public.profiles(id),
  department_id uuid references public.departments(id),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','processed')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  refund_reference text,
  processed_by uuid references public.profiles(id),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists refund_requests_status_created_idx
  on public.refund_requests(status, created_at desc);
create index if not exists refund_requests_payment_idx
  on public.refund_requests(payment_id, status);

alter table public.refund_requests enable row level security;
drop policy if exists "owner read refund requests" on public.refund_requests;
create policy "owner read refund requests" on public.refund_requests
  for select to authenticated using (public.is_owner());
drop policy if exists "front desk manager read own refund requests" on public.refund_requests;
create policy "front desk manager read own refund requests" on public.refund_requests
  for select to authenticated using (
    public.current_user_role()='manager'
    and department_id=public.current_user_department()
    and public.current_user_department()=(select id from public.departments where slug='front-desk')
  );

create or replace function public.create_refund_request(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  payment_row public.payments%rowtype;
  already_reserved numeric(14,2);
  request_id uuid;
  actor_department uuid;
begin
  if not public.is_owner() and not public.can_manage_front_desk() then
    raise exception 'Owner or Front Desk manager access required';
  end if;
  if p_amount is null or p_amount<=0 then raise exception 'Refund amount must be greater than zero'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Please provide a clear refund reason'; end if;

  select * into payment_row from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Payment record not found'; end if;
  if payment_row.status<>'completed' then raise exception 'Only completed payments can be refunded'; end if;

  select coalesce(sum(amount),0) into already_reserved
  from public.refund_requests
  where payment_id=p_payment_id and status in ('pending','approved','processed');
  if p_amount > payment_row.amount-already_reserved then
    raise exception 'Refund amount exceeds the remaining refundable balance';
  end if;

  actor_department:=public.current_user_department();
  insert into public.refund_requests(payment_id,amount,reason,requested_by,department_id)
  values(p_payment_id,p_amount,trim(p_reason),auth.uid(),actor_department)
  returning id into request_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Requested payment refund','refund_request',request_id,
    jsonb_build_object('payment_id',p_payment_id,'amount',p_amount,'reason',trim(p_reason)));
  return request_id;
end;
$$;
revoke all on function public.create_refund_request(uuid,numeric,text) from public;
grant execute on function public.create_refund_request(uuid,numeric,text) to authenticated;

create or replace function public.review_refund_request(
  p_refund_request_id uuid,
  p_decision text,
  p_rejection_reason text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare request_row public.refund_requests%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
  if p_decision='rejected' and length(trim(coalesce(p_rejection_reason,'')))<5 then
    raise exception 'A clear rejection reason is required';
  end if;
  select * into request_row from public.refund_requests where id=p_refund_request_id for update;
  if not found then raise exception 'Refund request not found'; end if;
  if request_row.status<>'pending' then raise exception 'Only pending refund requests can be reviewed'; end if;
  update public.refund_requests
  set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),
      rejection_reason=case when p_decision='rejected' then trim(p_rejection_reason) else null end,
      updated_at=now()
  where id=p_refund_request_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),case when p_decision='approved' then 'Approved refund request' else 'Rejected refund request' end,
    'refund_request',p_refund_request_id,jsonb_build_object('decision',p_decision,'reason',p_rejection_reason));
end;
$$;
revoke all on function public.review_refund_request(uuid,text,text) from public;
grant execute on function public.review_refund_request(uuid,text,text) to authenticated;

create or replace function public.record_refund_processed(
  p_refund_request_id uuid,
  p_refund_reference text
) returns void
language plpgsql security definer set search_path=public as $$
declare request_row public.refund_requests%rowtype; payment_row public.payments%rowtype; refunded_total numeric(14,2);
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if length(trim(coalesce(p_refund_reference,'')))<3 then
    raise exception 'Enter the provider or bank refund reference after the refund is actually completed';
  end if;
  select * into request_row from public.refund_requests where id=p_refund_request_id for update;
  if not found then raise exception 'Refund request not found'; end if;
  if request_row.status<>'approved' then raise exception 'Only approved refunds can be marked processed'; end if;
  -- Serialize settlement for requests against the same payment so concurrent
  -- partial refunds cannot leave the parent payment in the wrong final state.
  select * into payment_row from public.payments where id=request_row.payment_id for update;
  if not found or payment_row.status not in ('completed','refunded') then raise exception 'Original payment is not eligible for refund settlement'; end if;
  update public.refund_requests
  set status='processed',refund_reference=trim(p_refund_reference),
      processed_by=auth.uid(),processed_at=now(),updated_at=now()
  where id=p_refund_request_id;

  select coalesce(sum(amount),0) into refunded_total
  from public.refund_requests
  where payment_id=request_row.payment_id and status='processed';

  update public.payments
  set status='refunded'
  where id=request_row.payment_id
    and refunded_total >= amount;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Recorded completed refund','refund_request',p_refund_request_id,
    jsonb_build_object('payment_id',request_row.payment_id,'amount',request_row.amount,
      'refund_reference',trim(p_refund_reference),'total_refunded',refunded_total));
end;
$$;
revoke all on function public.record_refund_processed(uuid,text) from public;
grant execute on function public.record_refund_processed(uuid,text) to authenticated;
