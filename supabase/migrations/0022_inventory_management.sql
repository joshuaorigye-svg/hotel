-- Inventory management expansion: supplier purchasing, receiving, transfers and stocktakes.
-- Extends the existing inventory_items / inventory_movements ledger. Apply after 0021.

alter table public.inventory_items
  add column if not exists sku text,
  add column if not exists category text not null default 'general',
  add column if not exists unit_cost numeric(14,2) not null default 0,
  add column if not exists storage_location text,
  add constraint inventory_unit_cost_nonnegative check(unit_cost>=0);
create unique index if not exists inventory_department_sku_unique
  on public.inventory_items(department_id,lower(sku)) where sku is not null and trim(sku)<>'';
create index if not exists inventory_department_category_idx
  on public.inventory_items(department_id,category,is_active);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check(movement_type in('opening','purchase','adjustment','waste','sale','reversal','transfer_in','transfer_out','stocktake'));

create table if not exists public.inventory_suppliers(
 id uuid primary key default gen_random_uuid(),
 name text not null,
 contact_person text,
 phone text,
 email text,
 address text,
 notes text,
 is_active boolean not null default true,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint inventory_supplier_name_length check(char_length(trim(name)) between 2 and 160)
);
create index if not exists inventory_suppliers_active_idx on public.inventory_suppliers(is_active,name);
alter table public.inventory_suppliers enable row level security;
drop policy if exists "inventory supplier owner control" on public.inventory_suppliers;
drop policy if exists "inventory supplier manager read" on public.inventory_suppliers;
create policy "inventory supplier owner control" on public.inventory_suppliers
 for all to authenticated using(public.is_owner()) with check(public.is_owner());
create policy "inventory supplier manager read" on public.inventory_suppliers
 for select to authenticated using(public.current_user_role()='manager');

create table if not exists public.inventory_purchase_orders(
 id uuid primary key default gen_random_uuid(),
 order_number bigint generated always as identity unique,
 department_id uuid not null references public.departments(id),
 supplier_id uuid not null references public.inventory_suppliers(id),
 status text not null default 'pending' check(status in('pending','approved','rejected','partially_received','received')),
 notes text,
 review_note text,
 requested_by uuid not null references public.profiles(id),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 received_by uuid references public.profiles(id),
 received_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.inventory_purchase_order_items(
 id uuid primary key default gen_random_uuid(),
 purchase_order_id uuid not null references public.inventory_purchase_orders(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id),
 quantity_ordered numeric(14,3) not null check(quantity_ordered>0),
 quantity_received numeric(14,3) not null default 0 check(quantity_received>=0),
 unit_cost numeric(14,2) not null check(unit_cost>=0),
 unique(purchase_order_id,inventory_item_id),
 check(quantity_received<=quantity_ordered)
);
create index if not exists inventory_po_department_status_idx on public.inventory_purchase_orders(department_id,status,created_at desc);
create index if not exists inventory_po_items_order_idx on public.inventory_purchase_order_items(purchase_order_id);
alter table public.inventory_purchase_orders enable row level security;
alter table public.inventory_purchase_order_items enable row level security;
create policy "inventory purchase order scoped read" on public.inventory_purchase_orders
 for select to authenticated using(public.is_owner() or (public.current_user_role()='manager' and department_id=public.current_user_department()));
create policy "inventory purchase order items scoped read" on public.inventory_purchase_order_items
 for select to authenticated using(exists(select 1 from public.inventory_purchase_orders po where po.id=purchase_order_id and (public.is_owner() or (public.current_user_role()='manager' and po.department_id=public.current_user_department()))));
revoke insert,update,delete on public.inventory_purchase_orders,public.inventory_purchase_order_items from authenticated;
grant select on public.inventory_purchase_orders,public.inventory_purchase_order_items to authenticated;

create table if not exists public.inventory_transfers(
 id uuid primary key default gen_random_uuid(),
 source_item_id uuid not null references public.inventory_items(id),
 destination_department_id uuid not null references public.departments(id),
 destination_item_id uuid references public.inventory_items(id),
 quantity numeric(14,3) not null check(quantity>0),
 status text not null default 'requested' check(status in('requested','completed','rejected')),
 note text,
 decision_note text,
 requested_by uuid not null references public.profiles(id),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists inventory_transfers_status_idx on public.inventory_transfers(status,created_at desc);
alter table public.inventory_transfers enable row level security;
create policy "inventory transfer scoped read" on public.inventory_transfers
 for select to authenticated using(public.is_owner() or
  (public.current_user_role()='manager' and (
    exists(select 1 from public.inventory_items i where i.id=source_item_id and i.department_id=public.current_user_department())
    or destination_department_id=public.current_user_department()
  )));
revoke insert,update,delete on public.inventory_transfers from authenticated;
grant select on public.inventory_transfers to authenticated;

create table if not exists public.inventory_stocktakes(
 id uuid primary key default gen_random_uuid(),
 department_id uuid not null references public.departments(id),
 status text not null default 'draft' check(status in('draft','submitted','approved')),
 notes text,
 created_by uuid not null references public.profiles(id),
 submitted_at timestamptz,
 approved_by uuid references public.profiles(id),
 approved_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.inventory_stocktake_lines(
 id uuid primary key default gen_random_uuid(),
 stocktake_id uuid not null references public.inventory_stocktakes(id) on delete cascade,
 inventory_item_id uuid not null references public.inventory_items(id),
 system_quantity numeric(14,3) not null,
 counted_quantity numeric(14,3),
 unique(stocktake_id,inventory_item_id),
 check(system_quantity>=0 and (counted_quantity is null or counted_quantity>=0))
);
create index if not exists inventory_stocktakes_department_idx on public.inventory_stocktakes(department_id,status,created_at desc);
alter table public.inventory_stocktakes enable row level security;
alter table public.inventory_stocktake_lines enable row level security;
create policy "inventory stocktake scoped read" on public.inventory_stocktakes
 for select to authenticated using(public.is_owner() or (public.current_user_role()='manager' and department_id=public.current_user_department()));
create policy "inventory stocktake line scoped read" on public.inventory_stocktake_lines
 for select to authenticated using(exists(select 1 from public.inventory_stocktakes s where s.id=stocktake_id and (public.is_owner() or (public.current_user_role()='manager' and s.department_id=public.current_user_department()))));
revoke insert,update,delete on public.inventory_stocktakes,public.inventory_stocktake_lines from authenticated;
grant select on public.inventory_stocktakes,public.inventory_stocktake_lines to authenticated;

create or replace function public.create_inventory_purchase_order(p_supplier_id uuid,p_notes text,p_items jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare dept uuid; order_id uuid; entry jsonb; item public.inventory_items%rowtype; qty numeric; cost numeric;
begin
 if public.current_user_role() not in('owner','manager') then raise exception 'Manager or owner access required'; end if;
 dept:=case when public.is_owner() then null else public.current_user_department() end;
 if public.is_owner() then
   if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one purchase line'; end if;
   select (value->>'department_id')::uuid into dept from jsonb_array_elements(p_items) limit 1;
 end if;
 if dept is null then raise exception 'Select a department'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then raise exception 'Add between one and 100 purchase lines'; end if;
 if not exists(select 1 from public.inventory_suppliers where id=p_supplier_id and is_active) then raise exception 'Choose an active supplier'; end if;
 insert into public.inventory_purchase_orders(department_id,supplier_id,notes,requested_by)
 values(dept,p_supplier_id,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into order_id;
 for entry in select value from jsonb_array_elements(p_items) loop
   select * into item from public.inventory_items where id=(entry->>'inventory_item_id')::uuid and is_active for update;
   if not found or item.department_id<>dept then raise exception 'Every item must belong to the selected department'; end if;
   qty:=coalesce((entry->>'quantity')::numeric,0); cost:=coalesce((entry->>'unit_cost')::numeric,0);
   if qty<=0 or qty>1000000 or cost<0 then raise exception 'Check purchase quantities and unit costs'; end if;
   insert into public.inventory_purchase_order_items(purchase_order_id,inventory_item_id,quantity_ordered,unit_cost)
   values(order_id,item.id,qty,cost);
 end loop;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Created inventory purchase request','inventory_purchase_order',order_id,jsonb_build_object('department_id',dept,'line_count',jsonb_array_length(p_items)));
 insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
 select id,'Inventory purchase request','A purchase request is awaiting your review.','/owner/inventory','inventory_purchase_order',order_id
 from public.profiles where role='owner' and is_active;
 return order_id;
end; $$;

create or replace function public.review_inventory_purchase_order(p_order_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare po public.inventory_purchase_orders%rowtype;
begin
 if not public.is_owner() then raise exception 'Owner approval required'; end if;
 if p_decision not in('approved','rejected') then raise exception 'Choose approve or reject'; end if;
 if p_decision='rejected' and length(trim(coalesce(p_note,'')))<3 then raise exception 'Add a reason when rejecting'; end if;
 select * into po from public.inventory_purchase_orders where id=p_order_id for update;
 if not found or po.status<>'pending' then raise exception 'Only pending purchase requests can be reviewed'; end if;
 update public.inventory_purchase_orders set status=p_decision,review_note=nullif(trim(coalesce(p_note,'')),''),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=po.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Reviewed inventory purchase request','inventory_purchase_order',po.id,jsonb_build_object('decision',p_decision,'note',p_note));
 insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
 values(po.requested_by,'Purchase request '||p_decision,'Your inventory purchase request was '||p_decision||'.','/manager/inventory','inventory_purchase_order',po.id);
end; $$;

create or replace function public.receive_inventory_purchase_order(p_order_id uuid,p_receipts jsonb,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare po public.inventory_purchase_orders%rowtype; entry jsonb; line public.inventory_purchase_order_items%rowtype; item public.inventory_items%rowtype; qty numeric; new_qty numeric;
begin
 if public.current_user_role() not in('owner','manager') then raise exception 'Manager or owner access required'; end if;
 if jsonb_typeof(p_receipts)<>'array' or jsonb_array_length(p_receipts)=0 then raise exception 'Enter at least one received quantity'; end if;
 select * into po from public.inventory_purchase_orders where id=p_order_id for update;
 if not found or po.status not in('approved','partially_received') then raise exception 'Only approved purchase orders can be received'; end if;
 if not public.is_owner() and po.department_id<>public.current_user_department() then raise exception 'This purchase order belongs to another department'; end if;
 for entry in select value from jsonb_array_elements(p_receipts) loop
   select * into line from public.inventory_purchase_order_items where id=(entry->>'line_id')::uuid and purchase_order_id=po.id for update;
   if not found then raise exception 'Purchase order line not found'; end if;
   qty:=coalesce((entry->>'quantity')::numeric,0);
   if qty<=0 or line.quantity_received+qty>line.quantity_ordered then raise exception 'Received quantity exceeds the outstanding order quantity'; end if;
   select * into item from public.inventory_items where id=line.inventory_item_id for update;
   if not found then raise exception 'Inventory item no longer exists'; end if;
   new_qty:=item.quantity+qty;
   update public.inventory_items set quantity=new_qty,
     unit_cost=case when new_qty=0 then line.unit_cost else round(((item.quantity*item.unit_cost)+(qty*line.unit_cost))/new_qty,2) end,
     updated_at=now() where id=item.id;
   update public.inventory_purchase_order_items set quantity_received=quantity_received+qty where id=line.id;
   insert into public.inventory_movements(inventory_item_id,department_id,movement_type,quantity_delta,note,reference_id,created_by)
   values(item.id,po.department_id,'purchase',qty,'Received against PO #'||po.order_number||coalesce(': '||p_note,''),po.id,auth.uid());
 end loop;
 update public.inventory_purchase_orders set
   status=case when exists(select 1 from public.inventory_purchase_order_items where purchase_order_id=po.id and quantity_received<quantity_ordered) then 'partially_received' else 'received' end,
   received_by=auth.uid(),received_at=now(),updated_at=now()
 where id=po.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Received inventory purchase order','inventory_purchase_order',po.id,jsonb_build_object('receipt_lines',jsonb_array_length(p_receipts),'note',p_note));
end; $$;

create or replace function public.request_inventory_transfer(p_source_item_id uuid,p_destination_department_id uuid,p_quantity numeric,p_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare source_item public.inventory_items%rowtype; transfer_id uuid;
begin
 if public.current_user_role() not in('owner','manager') then raise exception 'Manager or owner access required'; end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'Transfer quantity must be greater than zero'; end if;
 select * into source_item from public.inventory_items where id=p_source_item_id and is_active for update;
 if not found then raise exception 'Source stock item not found'; end if;
 if not public.is_owner() and source_item.department_id<>public.current_user_department() then raise exception 'You can transfer only stock from your department'; end if;
 if source_item.department_id=p_destination_department_id or not exists(select 1 from public.departments where id=p_destination_department_id and not owner_only) then raise exception 'Choose another operational department'; end if;
 if source_item.quantity<p_quantity then raise exception 'Insufficient stock for this transfer'; end if;
 insert into public.inventory_transfers(source_item_id,destination_department_id,quantity,note,requested_by)
 values(source_item.id,p_destination_department_id,p_quantity,nullif(trim(coalesce(p_note,'')),''),auth.uid()) returning id into transfer_id;
 insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
 select id,'Stock transfer awaiting approval',source_item.name||' transfer requested for '||p_quantity||' '||source_item.unit||'.','/owner/inventory','inventory_transfer',transfer_id
 from public.profiles where role='owner' and is_active;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Requested interdepartment stock transfer','inventory_transfer',transfer_id,jsonb_build_object('source_department_id',source_item.department_id,'destination_department_id',p_destination_department_id,'quantity',p_quantity));
 return transfer_id;
end; $$;

create or replace function public.review_inventory_transfer(p_transfer_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare t public.inventory_transfers%rowtype; src public.inventory_items%rowtype; dst public.inventory_items%rowtype;
begin
 if not public.is_owner() then raise exception 'Owner approval required for interdepartment transfers'; end if;
 if p_decision not in('approved','rejected') then raise exception 'Choose approve or reject'; end if;
 if p_decision='rejected' and length(trim(coalesce(p_note,'')))<3 then raise exception 'Add a reason when rejecting'; end if;
 select * into t from public.inventory_transfers where id=p_transfer_id for update;
 if not found or t.status<>'requested' then raise exception 'Transfer is no longer awaiting review'; end if;
 select * into src from public.inventory_items where id=t.source_item_id and is_active for update;
 if not found or src.quantity<t.quantity then raise exception 'Source stock is no longer sufficient'; end if;
 if p_decision='rejected' then
   update public.inventory_transfers set status='rejected',decision_note=nullif(trim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now() where id=t.id;
 else
   select * into dst from public.inventory_items where department_id=t.destination_department_id and lower(name)=lower(src.name) and lower(unit)=lower(src.unit) and is_active for update limit 1;
   if not found then
     insert into public.inventory_items(name,department_id,quantity,unit,low_stock_threshold,is_active,sku,category,unit_cost)
     values(src.name,t.destination_department_id,0,src.unit,src.low_stock_threshold,true,null,src.category,src.unit_cost)
     returning * into dst;
   end if;
   update public.inventory_items set quantity=quantity-t.quantity,updated_at=now() where id=src.id;
   update public.inventory_items set quantity=quantity+t.quantity,updated_at=now(),unit_cost=src.unit_cost where id=dst.id;
   update public.inventory_transfers set status='completed',destination_item_id=dst.id,decision_note=nullif(trim(coalesce(p_note,'')),''),reviewed_by=auth.uid(),reviewed_at=now() where id=t.id;
   insert into public.inventory_movements(inventory_item_id,department_id,movement_type,quantity_delta,note,reference_id,created_by)
   values(src.id,src.department_id,'transfer_out',-t.quantity,'Transfer to '||(select name from public.departments where id=t.destination_department_id),t.id,auth.uid()),
         (dst.id,dst.department_id,'transfer_in',t.quantity,'Transfer from '||(select name from public.departments where id=src.department_id),t.id,auth.uid());
 end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Reviewed interdepartment stock transfer','inventory_transfer',t.id,jsonb_build_object('decision',p_decision,'quantity',t.quantity));
 insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
 values(t.requested_by,'Stock transfer '||case when p_decision='approved' then 'completed' else 'rejected' end,
   'Your stock transfer request has been '||case when p_decision='approved' then 'completed' else 'rejected' end||'.',
   '/manager/inventory','inventory_transfer',t.id);
end; $$;

create or replace function public.create_inventory_stocktake(p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare dept uuid; stocktake_id uuid;
begin
 if public.current_user_role() not in('owner','manager') then raise exception 'Manager or owner access required'; end if;
 dept:=case when public.is_owner() then null else public.current_user_department() end;
 if public.is_owner() then raise exception 'Owner must choose a department when creating a stocktake using the department page'; end if;
 if dept is null then raise exception 'Department is required'; end if;
 insert into public.inventory_stocktakes(department_id,notes,created_by)
 values(dept,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into stocktake_id;
 insert into public.inventory_stocktake_lines(stocktake_id,inventory_item_id,system_quantity)
 select stocktake_id,id,quantity from public.inventory_items where department_id=dept and is_active;
 if not exists(select 1 from public.inventory_stocktake_lines where stocktake_id=stocktake_id) then raise exception 'There are no active inventory items to count'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Created inventory stocktake','inventory_stocktake',stocktake_id,jsonb_build_object('department_id',dept));
 return stocktake_id;
end; $$;

create or replace function public.record_inventory_stocktake_count(p_line_id uuid,p_counted_quantity numeric)
returns void language plpgsql security definer set search_path=public as $$
declare line public.inventory_stocktake_lines%rowtype; stocktake public.inventory_stocktakes%rowtype;
begin
 if public.current_user_role() not in('owner','manager') then raise exception 'Manager or owner access required'; end if;
 if p_counted_quantity is null or p_counted_quantity<0 then raise exception 'Counted quantity cannot be negative'; end if;
 select * into line from public.inventory_stocktake_lines where id=p_line_id for update;
 if not found then raise exception 'Stocktake line not found'; end if;
 select * into stocktake from public.inventory_stocktakes where id=line.stocktake_id for update;
 if stocktake.status<>'draft' then raise exception 'Only draft stocktakes can be edited'; end if;
 if not public.is_owner() and stocktake.department_id<>public.current_user_department() then raise exception 'This stocktake belongs to another department'; end if;
 update public.inventory_stocktake_lines set counted_quantity=p_counted_quantity where id=line.id;
end; $$;

create or replace function public.submit_inventory_stocktake(p_stocktake_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.inventory_stocktakes%rowtype;
begin
 if public.current_user_role() not in('owner','manager') then raise exception 'Manager or owner access required'; end if;
 select * into s from public.inventory_stocktakes where id=p_stocktake_id for update;
 if not found or s.status<>'draft' then raise exception 'Only draft stocktakes can be submitted'; end if;
 if not public.is_owner() and s.department_id<>public.current_user_department() then raise exception 'This stocktake belongs to another department'; end if;
 if exists(select 1 from public.inventory_stocktake_lines where stocktake_id=s.id and counted_quantity is null) then raise exception 'Enter every physical count before submitting'; end if;
 update public.inventory_stocktakes set status='submitted',submitted_at=now() where id=s.id;
end; $$;

create or replace function public.approve_inventory_stocktake(p_stocktake_id uuid,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare s public.inventory_stocktakes%rowtype; line public.inventory_stocktake_lines%rowtype; item public.inventory_items%rowtype; delta numeric;
begin
 if not public.is_owner() then raise exception 'Owner approval required to post stocktake variances'; end if;
 select * into s from public.inventory_stocktakes where id=p_stocktake_id for update;
 if not found or s.status<>'submitted' then raise exception 'Only submitted stocktakes can be approved'; end if;
 for line in select * from public.inventory_stocktake_lines where stocktake_id=s.id order by inventory_item_id for update loop
   select * into item from public.inventory_items where id=line.inventory_item_id for update;
   if not found then raise exception 'An inventory item in this stocktake no longer exists'; end if;
   delta:=line.counted_quantity-item.quantity;
   if delta<>0 then
     update public.inventory_items set quantity=line.counted_quantity,updated_at=now() where id=item.id;
     insert into public.inventory_movements(inventory_item_id,department_id,movement_type,quantity_delta,note,reference_id,created_by)
     values(item.id,s.department_id,'stocktake',delta,'Approved stocktake variance'||coalesce(': '||p_note,''),s.id,auth.uid());
   end if;
 end loop;
 update public.inventory_stocktakes set status='approved',approved_by=auth.uid(),approved_at=now(),notes=concat_ws(E'\n',notes,nullif(trim(coalesce(p_note,'')),'')) where id=s.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 values(auth.uid(),'Approved inventory stocktake','inventory_stocktake',s.id,jsonb_build_object('department_id',s.department_id,'note',p_note));
end; $$;

revoke all on function public.create_inventory_purchase_order(uuid,text,jsonb) from public;
revoke all on function public.review_inventory_purchase_order(uuid,text,text) from public;
revoke all on function public.receive_inventory_purchase_order(uuid,jsonb,text) from public;
revoke all on function public.request_inventory_transfer(uuid,uuid,numeric,text) from public;
revoke all on function public.review_inventory_transfer(uuid,text,text) from public;
revoke all on function public.create_inventory_stocktake(text) from public;
revoke all on function public.record_inventory_stocktake_count(uuid,numeric) from public;
revoke all on function public.submit_inventory_stocktake(uuid) from public;
revoke all on function public.approve_inventory_stocktake(uuid,text) from public;
grant execute on function public.create_inventory_purchase_order(uuid,text,jsonb) to authenticated;
grant execute on function public.review_inventory_purchase_order(uuid,text,text) to authenticated;
grant execute on function public.receive_inventory_purchase_order(uuid,jsonb,text) to authenticated;
grant execute on function public.request_inventory_transfer(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.review_inventory_transfer(uuid,text,text) to authenticated;
grant execute on function public.create_inventory_stocktake(text) to authenticated;
grant execute on function public.record_inventory_stocktake_count(uuid,numeric) to authenticated;
grant execute on function public.submit_inventory_stocktake(uuid) to authenticated;
grant execute on function public.approve_inventory_stocktake(uuid,text) to authenticated;
