-- Controlled room-readiness workflow: dirty -> cleaning -> inspection -> available.
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
 check(status in('available','occupied','dirty','cleaning','inspection','maintenance','booked'));

create or replace function public.advance_housekeeping_room(p_room_id uuid,p_step text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype; target_status text;
begin
 if not (public.is_owner() or (public.current_user_role()='manager' and public.current_user_department()=(select id from public.departments where slug='housekeeping'))) then
  raise exception 'Housekeeping manager or owner access required';
 end if;
 select * into r from public.rooms where id=p_room_id and is_active=true for update;
 if not found then raise exception 'Room not found'; end if;
 if p_step='start_cleaning' and r.status='dirty' then target_status:='cleaning';
 elsif p_step='submit_inspection' and r.status='cleaning' then target_status:='inspection';
 elsif p_step='approve_room' and r.status='inspection' then target_status:='available';
 else raise exception 'This room cannot move to the requested stage'; end if;
 update public.rooms set status=target_status where id=p_room_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Advanced room readiness','room',p_room_id,jsonb_build_object('from',r.status,'to',target_status,'step',p_step));
end; $$;
revoke all on function public.advance_housekeeping_room(uuid,text) from public;
grant execute on function public.advance_housekeeping_room(uuid,text) to authenticated;
