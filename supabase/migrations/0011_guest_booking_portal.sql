-- Public guest booking status portal, protected by booking reference + matching phone.
create or replace function public.get_guest_booking_portal(p_booking_id uuid, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  r public.rooms%rowtype;
  supplied_phone text;
  stored_phone text;
  nights integer;
  charges numeric(14,2) := 0;
  paid numeric(14,2) := 0;
  items jsonb := '[]'::jsonb;
  payment_rows jsonb := '[]'::jsonb;
begin
  if p_booking_id is null or coalesce(length(p_phone), 0) < 7 or length(p_phone) > 30 then
    raise exception 'Booking reference or phone number is incorrect';
  end if;

  select * into b from public.bookings where id = p_booking_id;
  if not found then raise exception 'Booking reference or phone number is incorrect'; end if;

  supplied_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
  stored_phone := regexp_replace(coalesce(b.guest_phone, ''), '[^0-9]', '', 'g');
  if length(supplied_phone) = 10 and left(supplied_phone, 1) = '0' then
    supplied_phone := '256' || substr(supplied_phone, 2);
  elsif length(supplied_phone) = 9 then
    supplied_phone := '256' || supplied_phone;
  end if;
  if length(stored_phone) = 10 and left(stored_phone, 1) = '0' then
    stored_phone := '256' || substr(stored_phone, 2);
  elsif length(stored_phone) = 9 then
    stored_phone := '256' || stored_phone;
  end if;
  if supplied_phone <> stored_phone then
    raise exception 'Booking reference or phone number is incorrect';
  end if;

  nights := greatest(1, b.check_out - b.check_in);
  if b.status in ('checked_in', 'checked_out') and b.room_id is not null then
    select * into r from public.rooms where id = b.room_id;
    if found and b.status = 'checked_in' then
      insert into public.guest_folio_items(booking_id,source_type,source_id,description,quantity,unit_amount,total_amount)
      values(b.id,'accommodation',b.id,'Accommodation · Room '||r.room_number||' · '||nights||' night(s)',nights,r.nightly_rate,nights*r.nightly_rate)
      on conflict(booking_id,source_type,source_id) do nothing;
      insert into public.guest_folio_items(booking_id,source_type,source_id,description,quantity,unit_amount,total_amount)
      select b.id,'room_service',o.id,'Room service · Order #'||o.order_number,1,o.total_amount,o.total_amount
      from public.restaurant_orders o where o.booking_id=b.id and o.status='served'
      on conflict(booking_id,source_type,source_id) do nothing;
    end if;
  end if;

  select coalesce(sum(total_amount),0) into charges
  from public.guest_folio_items where booking_id=b.id;
  select coalesce(sum(amount),0) into paid
  from public.payments where booking_id=b.id and status='completed';

  select coalesce(jsonb_agg(jsonb_build_object(
    'description',description,'quantity',quantity,'unit_amount',unit_amount,'total_amount',total_amount
  ) order by created_at,id),'[]'::jsonb)
  into items from public.guest_folio_items where booking_id=b.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'amount',amount,'currency',currency,'method',payment_method,
    'receipt_number',receipt_number,'reference',confirmation_code,'created_at',created_at
  ) order by created_at),'[]'::jsonb)
  into payment_rows from public.payments where booking_id=b.id and status='completed';

  return jsonb_build_object(
    'booking_id',b.id,'guest_name',b.guest_name,'status',b.status,
    'check_in',b.check_in,'check_out',b.check_out,'guests',b.guests,
    'room_type',b.room_type,'room_number',case when b.room_id is not null then r.room_number else null end,
    'nights',nights,'charges',charges,'paid',paid,'balance',greatest(0,charges-paid),
    'items',items,'payments',payment_rows,
    'message',case
      when b.status='pending' then 'Your request has been received. Reception is reviewing availability.'
      when b.status='confirmed' then 'Your booking is confirmed. Please contact reception if you need to make changes.'
      when b.status='checked_in' then 'You are checked in. Your account summary is shown below.'
      when b.status='checked_out' then 'Your stay is complete. Thank you for choosing us.'
      when b.status='cancelled' then 'This booking request was declined or cancelled. Please contact reception for assistance.'
      else 'Please contact reception for an update.'
    end
  );
end;
$$;

revoke all on function public.get_guest_booking_portal(uuid,text) from public;
grant execute on function public.get_guest_booking_portal(uuid,text) to anon, authenticated;
