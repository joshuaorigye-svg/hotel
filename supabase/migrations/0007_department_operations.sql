-- Department operations: room turnover and issue triage are enforced in PostgreSQL.
create or replace function public.set_housekeeping_room_status(p_room_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype;
begin
 if not (public.is_owner() or (public.current_user_role()='manager' and public.current_user_department()=(select id from public.departments where slug='housekeeping'))) then
  raise exception 'Housekeeping manager or owner access required';
 end if;
 if p_status not in ('available','dirty','cleaning','maintenance') then raise exception 'Invalid housekeeping status'; end if;
 select * into r from public.rooms where id=p_room_id and is_active=true for update;
 if not found then raise exception 'Room not found'; end if;
 if r.status='occupied' and p_status='available' then raise exception 'A checked-in room cannot be marked available'; end if;
 update public.rooms set status=p_status where id=p_room_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Updated room housekeeping status','room',p_room_id,jsonb_build_object('from',r.status,'to',p_status));
end; $$;

create or replace function public.update_department_issue(p_issue_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare i public.issue_reports%rowtype;
begin
 if not (public.is_owner() or (public.current_user_role()='manager' and public.current_user_department()=(select department_id from public.issue_reports where id=p_issue_id))) then
  raise exception 'Department manager or owner access required';
 end if;
 if p_status not in ('open','in_progress','fixed','closed') then raise exception 'Invalid issue status'; end if;
 select * into i from public.issue_reports where id=p_issue_id for update;
 if not found then raise exception 'Issue not found'; end if;
 update public.issue_reports set status=p_status,resolved_at=case when p_status in ('fixed','closed') then now() else null end where id=p_issue_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Updated maintenance issue','issue_report',p_issue_id,jsonb_build_object('from',i.status,'to',p_status));
end; $$;
revoke all on function public.set_housekeeping_room_status(uuid,text) from public;
revoke all on function public.update_department_issue(uuid,text) from public;
grant execute on function public.set_housekeeping_room_status(uuid,text) to authenticated;
grant execute on function public.update_department_issue(uuid,text) to authenticated;
