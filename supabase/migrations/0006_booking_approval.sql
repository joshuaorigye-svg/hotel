create or replace function public.can_manage_front_desk()
returns boolean language sql stable security definer set search_path=public as $$
 select public.is_owner() or (public.current_user_role()='manager' and public.current_user_department()=(select id from public.departments where slug='front-desk'))
$$;
create or replace function public.confirm_booking(p_booking_id uuid,p_room_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; r public.rooms%rowtype;
begin
 if not public.can_manage_front_desk() then raise exception 'Front Desk manager or owner access required'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.status<>'pending' then raise exception 'Pending booking not found'; end if;
 select * into r from public.rooms where id=p_room_id and is_active=true for update;
 if not found then raise exception 'Selected room does not exist'; end if;
 if r.status not in('available','booked') then raise exception 'Selected room is not ready for a guest'; end if;
 if exists(select 1 from public.bookings x where x.room_id=p_room_id and x.id<>p_booking_id and x.status in('confirmed','checked_in') and x.check_in<b.check_out and x.check_out>b.check_in) then raise exception 'This room already has a booking during those dates'; end if;
 update public.bookings set room_id=p_room_id,status='confirmed',updated_at=now() where id=p_booking_id;
 update public.rooms set status='booked' where id=p_room_id;
end; $$;
create or replace function public.reject_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.can_manage_front_desk() then raise exception 'Front Desk manager or owner access required'; end if;
 update public.bookings set status='cancelled',updated_at=now() where id=p_booking_id and status='pending';
 if not found then raise exception 'Pending booking not found'; end if;
end; $$;
revoke all on function public.confirm_booking(uuid,uuid) from public;
revoke all on function public.reject_booking(uuid) from public;
grant execute on function public.confirm_booking(uuid,uuid) to authenticated;
grant execute on function public.reject_booking(uuid) to authenticated;
