-- Prevent any non-owner account from being assigned to the owner-only finance department.
create or replace function public.guard_finance_department()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.role<>'owner' and new.department_id is not null and exists(select 1 from public.departments where id=new.department_id and slug='accounts-finance') then
  raise exception 'Accounts / Finance is reserved for the owner account';
 end if;
 return new;
end; $$;
drop trigger if exists profiles_finance_department_guard on public.profiles;
create trigger profiles_finance_department_guard before insert or update of role,department_id on public.profiles for each row execute function public.guard_finance_department();

-- Staff complete assigned work only through the audited RPC.
drop policy if exists "staff update assigned task description only" on public.tasks;

-- Record mutations centrally. Sensitive row contents are deliberately not copied into the audit trail.
create or replace function public.write_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare row_data jsonb; entity_uuid uuid; operation_label text;
begin
 if TG_OP='DELETE' then row_data:=to_jsonb(OLD); else row_data:=to_jsonb(NEW); end if;
 entity_uuid:=(row_data->>'id')::uuid;
 operation_label:=case TG_OP when 'INSERT' then 'Created ' when 'UPDATE' then 'Updated ' else 'Deleted ' end||TG_TABLE_NAME;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),operation_label,TG_TABLE_NAME,entity_uuid,jsonb_build_object('operation',TG_OP));
 if TG_OP='DELETE' then return OLD; else return NEW; end if;
end; $$;
do $$
declare t text;
begin
 foreach t in array array['profiles','rooms','bookings','payments','expenses','attendance','tasks','inventory_items','staff_leave','issue_reports','restaurant_menu_items','contact_messages'] loop
  execute format('drop trigger if exists audit_%I on public.%I',t,t);
  execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.write_audit_event()',t,t);
 end loop;
end $$;
