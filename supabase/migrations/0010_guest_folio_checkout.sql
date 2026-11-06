-- Guest folio, room-service posting, settlement and checkout.
alter table public.restaurant_orders add column if not exists booking_id uuid references public.bookings(id);
create index if not exists restaurant_orders_booking_idx on public.restaurant_orders(booking_id) where booking_id is not null;

drop function if exists public.create_restaurant_order(text,text,text,jsonb,text);
create function public.create_restaurant_order(
 p_order_type text,p_table_label text,p_guest_name text,p_items jsonb,p_notes text,p_booking_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare d uuid; dept_slug text; oid uuid; item jsonb; menu public.restaurant_menu_items%rowtype; qty integer; total numeric(14,2):=0; b public.bookings%rowtype;
begin
 if public.current_user_role() not in('manager','staff') then raise exception 'Restaurant or bar staff access required'; end if;
 d:=public.current_user_department(); select dp.slug into dept_slug from public.departments dp where dp.id=d;
 if dept_slug not in('restaurant-kitchen','bar') then raise exception 'Only restaurant and bar staff can create orders'; end if;
 if p_order_type not in('dine_in','takeaway','room_service') then raise exception 'Invalid order type'; end if;
 if p_order_type='room_service' then
  if p_booking_id is null then raise exception 'Select the checked-in guest booking for room service'; end if;
  select * into b from public.bookings where id=p_booking_id and status='checked_in';
  if not found then raise exception 'Room service can only be posted to a checked-in guest'; end if;
 elsif p_booking_id is not null then raise exception 'Only room-service orders can be posted to a guest folio';
 end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item'; end if;
 insert into public.restaurant_orders(department_id,order_type,table_label,guest_name,notes,created_by,booking_id)
 values(d,p_order_type,nullif(trim(p_table_label),''),coalesce(nullif(trim(p_guest_name),''),case when p_booking_id is not null then b.guest_name end),nullif(trim(p_notes),''),auth.uid(),p_booking_id) returning id into oid;
 for item in select value from jsonb_array_elements(p_items) loop
  if coalesce(item->>'menu_item_id','')='' then raise exception 'Menu item is required'; end if;
  qty:=coalesce((item->>'quantity')::integer,0); if qty<1 or qty>50 then raise exception 'Quantity must be between 1 and 50'; end if;
  select * into menu from public.restaurant_menu_items where id=(item->>'menu_item_id')::uuid and department_id=d and is_available=true;
  if not found then raise exception 'Menu item is unavailable for this department'; end if;
  insert into public.restaurant_order_items(order_id,menu_item_id,item_name,quantity,unit_price,line_total,notes)
  values(oid,menu.id,menu.name,qty,menu.price,menu.price*qty,nullif(trim(item->>'notes'),'')); total:=total+(menu.price*qty);
 end loop;
 update public.restaurant_orders set total_amount=total where id=oid;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Created restaurant or bar order','restaurant_order',oid,jsonb_build_object('department_id',d,'total',total,'booking_id',p_booking_id));
 return oid;
end; $$;
revoke all on function public.create_restaurant_order(text,text,text,jsonb,text,uuid) from public;
grant execute on function public.create_restaurant_order(text,text,text,jsonb,text,uuid) to authenticated;

create table if not exists public.guest_folio_items(
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.bookings(id) on delete cascade,
 source_type text not null check(source_type in('accommodation','room_service')),
 source_id uuid not null,
 description text not null,
 quantity numeric(14,2) not null default 1 check(quantity>0),
 unit_amount numeric(14,2) not null check(unit_amount>=0),
 total_amount numeric(14,2) not null check(total_amount>=0),
 created_at timestamptz not null default now()
);
create unique index if not exists guest_folio_source_unique on public.guest_folio_items(booking_id,source_type,source_id);
create index if not exists guest_folio_booking_idx on public.guest_folio_items(booking_id,created_at);
alter table public.guest_folio_items enable row level security;
drop policy if exists "owner guest folio read" on public.guest_folio_items;
create policy "owner guest folio read" on public.guest_folio_items for select to authenticated using(public.is_owner());
create policy "front desk guest folio read" on public.guest_folio_items for select to authenticated using(public.current_user_role()='manager' and public.current_user_department()=(select id from public.departments where slug='front-desk'));
drop policy if exists "front desk read guest payments" on public.payments;
create policy "front desk read guest payments" on public.payments for select to authenticated using(public.current_user_role()='manager' and public.current_user_department()=(select id from public.departments where slug='front-desk') and booking_id is not null);

create or replace function public.get_guest_folio(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; r public.rooms%rowtype; nights integer; room_total numeric(14,2); charges numeric(14,2); paid numeric(14,2); total numeric(14,2); items jsonb;
begin
 if not public.can_manage_front_desk() then raise exception 'Front Desk manager or owner access required'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.status<>'checked_in' then raise exception 'Only checked-in bookings can be checked out'; end if;
 if b.room_id is null then raise exception 'Booking has no assigned room'; end if;
 select * into r from public.rooms where id=b.room_id;
 if not found then raise exception 'Assigned room not found'; end if;
 nights:=greatest(1,b.check_out-b.check_in);
 room_total:=nights*r.nightly_rate;
 insert into public.guest_folio_items(booking_id,source_type,source_id,description,quantity,unit_amount,total_amount)
 values(b.id,'accommodation',b.id,'Accommodation · Room '||r.room_number||' · '||nights||' night(s)',nights,r.nightly_rate,room_total)
 on conflict(booking_id,source_type,source_id) do nothing;
 insert into public.guest_folio_items(booking_id,source_type,source_id,description,quantity,unit_amount,total_amount)
 select b.id,'room_service',o.id,'Room service · Order #'||o.order_number,1,o.total_amount,o.total_amount
 from public.restaurant_orders o where o.booking_id=b.id and o.status='served'
 on conflict(booking_id,source_type,source_id) do nothing;
 select coalesce(sum(total_amount),0) into charges from public.guest_folio_items where booking_id=b.id;
 select coalesce(sum(amount),0) into paid from public.payments where booking_id=b.id and status='completed';
 total:=greatest(0,charges-paid);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',description,'quantity',quantity,'unit_amount',unit_amount,'total_amount',total_amount) order by created_at,id),'[]'::jsonb)
 into items from public.guest_folio_items where booking_id=b.id;
 return jsonb_build_object('booking_id',b.id,'guest_name',b.guest_name,'guest_phone',b.guest_phone,'room_number',r.room_number,'check_in',b.check_in,'check_out',b.check_out,'nights',nights,'items',items,'charges',charges,'paid',paid,'balance',total);
end; $$;

create or replace function public.record_guest_payment(
 p_booking_id uuid,p_amount numeric,p_payment_method text,p_confirmation_code text default null
) returns text language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; due numeric(14,2); receipt text;
begin
 if not public.can_manage_front_desk() then raise exception 'Front Desk manager or owner access required'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Payment amount must be greater than zero'; end if;
 if p_payment_method not in('cash','mobile_money','card','bank_transfer','pesapal') then raise exception 'Choose a valid payment method'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.status<>'checked_in' then raise exception 'Guest is not currently checked in'; end if;
 perform public.get_guest_folio(p_booking_id);
 select coalesce(sum(f.total_amount),0)-coalesce((select sum(p.amount) from public.payments p where p.booking_id=p_booking_id and p.status='completed'),0)
 into due from public.guest_folio_items f where f.booking_id=p_booking_id;
 if p_amount>greatest(0,due) then raise exception 'Payment exceeds the outstanding guest balance'; end if;
 receipt:='BPV-'||to_char(now() at time zone 'Africa/Kampala','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.payments(booking_id,amount,currency,provider,status,payment_method,confirmation_code,received_by,receipt_number,verified_at)
 values(p_booking_id,p_amount,'UGX',case when p_payment_method='pesapal' then 'pesapal' else 'manual' end,'completed',p_payment_method,nullif(trim(p_confirmation_code),''),auth.uid(),receipt,now());
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Recorded guest checkout payment','booking',p_booking_id,jsonb_build_object('amount',p_amount,'method',p_payment_method,'receipt',receipt));
 return receipt;
end; $$;

create or replace function public.finalize_guest_checkout(p_booking_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; room_total numeric(14,2); paid numeric(14,2);
begin
 if not public.can_manage_front_desk() then raise exception 'Front Desk manager or owner access required'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.status<>'checked_in' then raise exception 'Guest is not currently checked in'; end if;
 perform public.get_guest_folio(p_booking_id);
 select coalesce(sum(total_amount),0) into room_total from public.guest_folio_items where booking_id=p_booking_id;
 select coalesce(sum(amount),0) into paid from public.payments where booking_id=p_booking_id and status='completed';
 if paid<room_total then raise exception 'Outstanding balance must be paid before checkout'; end if;
 update public.bookings set status='checked_out',updated_at=now() where id=p_booking_id;
 update public.rooms set status='dirty' where id=b.room_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Completed guest checkout','booking',p_booking_id,jsonb_build_object('total_charges',room_total,'paid',paid,'room_id',b.room_id));
end; $$;
revoke all on function public.get_guest_folio(uuid) from public;
revoke all on function public.record_guest_payment(uuid,numeric,text,text) from public;
revoke all on function public.finalize_guest_checkout(uuid) from public;
grant execute on function public.get_guest_folio(uuid) to authenticated;
grant execute on function public.record_guest_payment(uuid,numeric,text,text) to authenticated;
grant execute on function public.finalize_guest_checkout(uuid) to authenticated;


create or replace function public.check_in_guest(p_booking_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; r public.rooms%rowtype;
begin
 if not public.can_manage_front_desk() then raise exception 'Front Desk manager or owner access required'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.status<>'confirmed' then raise exception 'Only confirmed bookings can be checked in'; end if;
 if b.check_in>current_date then raise exception 'Guest check-in date has not arrived'; end if;
 if b.room_id is null then raise exception 'Assign a room before check-in'; end if;
 select * into r from public.rooms where id=b.room_id for update;
 if not found or r.status not in('available','booked') then raise exception 'Assigned room is not ready for check-in'; end if;
 update public.bookings set status='checked_in',updated_at=now() where id=p_booking_id;
 update public.rooms set status='occupied' where id=b.room_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Checked in guest','booking',p_booking_id,jsonb_build_object('room_id',b.room_id));
end; $$;
revoke all on function public.check_in_guest(uuid) from public;
grant execute on function public.check_in_guest(uuid) to authenticated;
