-- Restaurant/bar cashier settlement with partial payments and traceable receipts.
alter table public.payments
  add column if not exists restaurant_order_id uuid references public.restaurant_orders(id),
  add column if not exists received_by uuid references public.profiles(id),
  add column if not exists receipt_number text unique;
alter table public.payments add constraint payments_method_check
  check(payment_method is null or payment_method in('cash','mobile_money','card','bank_transfer','pesapal'));
create index if not exists payments_restaurant_order_idx on public.payments(restaurant_order_id,created_at desc);
drop policy if exists "department read restaurant payments" on public.payments;
create policy "department read restaurant payments" on public.payments
for select to authenticated using (
  public.is_owner() or (
    public.current_user_role()='manager'
    and exists(select 1 from public.restaurant_orders o
      where o.id=restaurant_order_id and o.department_id=public.current_user_department())
  )
);
create or replace function public.record_restaurant_payment(
  p_order_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_confirmation_code text default null
) returns text
language plpgsql security definer set search_path=public as $$
declare
  o public.restaurant_orders%rowtype;
  paid numeric(14,2);
  receipt text;
begin
  if public.current_user_role()<>'manager' and not public.is_owner() then
    raise exception 'Manager or owner access required';
  end if;
  if p_amount is null or p_amount<=0 then raise exception 'Payment amount must be greater than zero'; end if;
  if p_payment_method not in('cash','mobile_money','card','bank_transfer','pesapal') then
    raise exception 'Choose a valid payment method';
  end if;
  select * into o from public.restaurant_orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not public.is_owner() and o.department_id<>public.current_user_department() then
    raise exception 'This order belongs to another department';
  end if;
  if o.status='cancelled' then raise exception 'Cancelled orders cannot receive payments'; end if;
  select coalesce(sum(amount),0) into paid from public.payments
    where restaurant_order_id=p_order_id and status='completed';
  if p_amount>o.total_amount-paid then raise exception 'Payment exceeds the outstanding balance'; end if;
  receipt:='BPV-'||to_char(now() at time zone 'Africa/Kampala','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.payments(
    restaurant_order_id,amount,currency,provider,status,payment_method,
    confirmation_code,received_by,receipt_number,verified_at
  ) values (
    p_order_id,p_amount,'UGX',case when p_payment_method='pesapal' then 'pesapal' else 'manual' end,
    'completed',p_payment_method,nullif(trim(p_confirmation_code),''),auth.uid(),receipt,now()
  );
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Recorded restaurant/bar payment','restaurant_order',p_order_id,
    jsonb_build_object('amount',p_amount,'method',p_payment_method,'receipt',receipt));
  return receipt;
end;
$$;
revoke all on function public.record_restaurant_payment(uuid,numeric,text,text) from public;
grant execute on function public.record_restaurant_payment(uuid,numeric,text,text) to authenticated;
