-- Restaurant and bar service: menu ownership, order lifecycle, recipes and stock ledger.
alter table public.restaurant_menu_items add column if not exists department_id uuid references public.departments(id);
create index if not exists restaurant_menu_department_idx on public.restaurant_menu_items(department_id,is_available);
drop policy if exists "public view available menu" on public.restaurant_menu_items;
create policy "public view available menu" on public.restaurant_menu_items for select to anon,authenticated using(is_available=true);
create policy "department menu management" on public.restaurant_menu_items for all to authenticated
using(public.is_owner() or (public.current_user_role()='manager' and department_id=public.current_user_department() and department_id in(select id from public.departments where slug in('restaurant-kitchen','bar'))))
with check(public.is_owner() or (public.current_user_role()='manager' and department_id=public.current_user_department() and department_id in(select id from public.departments where slug in('restaurant-kitchen','bar'))));
create table if not exists public.inventory_movements(id uuid primary key default gen_random_uuid(),inventory_item_id uuid not null references public.inventory_items(id),department_id uuid not null references public.departments(id),movement_type text not null check(movement_type in('opening','purchase','adjustment','waste','sale','reversal')),quantity_delta numeric(14,2) not null check(quantity_delta<>0),note text,reference_id uuid,created_by uuid references public.profiles(id),created_at timestamptz not null default now());
create index if not exists inventory_movements_item_date_idx on public.inventory_movements(inventory_item_id,created_at desc);
alter table public.inventory_movements enable row level security;
create policy "owner inventory movement read" on public.inventory_movements for select to authenticated using(public.is_owner());
create policy "manager department movement read" on public.inventory_movements for select to authenticated using(public.current_user_role()='manager' and department_id=public.current_user_department());
create table if not exists public.menu_item_ingredients(id uuid primary key default gen_random_uuid(),menu_item_id uuid not null references public.restaurant_menu_items(id) on delete cascade,inventory_item_id uuid not null references public.inventory_items(id),quantity_required numeric(14,3) not null check(quantity_required>0),unique(menu_item_id,inventory_item_id));
alter table public.menu_item_ingredients enable row level security;
create policy "owner recipe control" on public.menu_item_ingredients for all to authenticated using(public.is_owner()) with check(public.is_owner());
create policy "department recipe control" on public.menu_item_ingredients for all to authenticated using(public.current_user_role()='manager' and exists(select 1 from public.restaurant_menu_items m where m.id=menu_item_id and m.department_id=public.current_user_department())) with check(public.current_user_role()='manager' and exists(select 1 from public.restaurant_menu_items m where m.id=menu_item_id and m.department_id=public.current_user_department()));
create table if not exists public.restaurant_orders(id uuid primary key default gen_random_uuid(),department_id uuid not null references public.departments(id),order_number bigint generated always as identity unique,order_type text not null check(order_type in('dine_in','takeaway','room_service')),table_label text,guest_name text,status text not null default 'placed' check(status in('placed','preparing','ready','served','cancelled')),total_amount numeric(14,2) not null default 0 check(total_amount>=0),notes text,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),served_at timestamptz);
create index if not exists restaurant_orders_queue_idx on public.restaurant_orders(department_id,status,created_at desc);
create table if not exists public.restaurant_order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.restaurant_orders(id) on delete cascade,menu_item_id uuid references public.restaurant_menu_items(id),item_name text not null,quantity integer not null check(quantity>0),unit_price numeric(14,2) not null check(unit_price>=0),line_total numeric(14,2) not null check(line_total>=0),notes text);
alter table public.restaurant_orders enable row level security; alter table public.restaurant_order_items enable row level security;
create policy "department order read" on public.restaurant_orders for select to authenticated using(public.is_owner() or (public.current_user_role() in('manager','staff') and department_id=public.current_user_department()));
create policy "department order item read" on public.restaurant_order_items for select to authenticated using(exists(select 1 from public.restaurant_orders o where o.id=order_id and (public.is_owner() or (public.current_user_role() in('manager','staff') and o.department_id=public.current_user_department()))));
create or replace function public.create_restaurant_order(p_order_type text,p_table_label text,p_guest_name text,p_items jsonb,p_notes text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare d uuid; dept_slug text; oid uuid; item jsonb; menu public.restaurant_menu_items%rowtype; qty integer; total numeric(14,2):=0;
begin
 if public.current_user_role() not in('manager','staff') then raise exception 'Restaurant or bar staff access required'; end if;
 d:=public.current_user_department(); select dp.slug into dept_slug from public.departments dp where dp.id=d;
 if dept_slug not in('restaurant-kitchen','bar') then raise exception 'Only restaurant and bar staff can create orders'; end if;
 if p_order_type not in('dine_in','takeaway','room_service') then raise exception 'Invalid order type'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item'; end if;
 insert into public.restaurant_orders(department_id,order_type,table_label,guest_name,notes,created_by) values(d,p_order_type,nullif(trim(p_table_label),''),nullif(trim(p_guest_name),''),nullif(trim(p_notes),''),auth.uid()) returning id into oid;
 for item in select value from jsonb_array_elements(p_items) loop
  if coalesce(item->>'menu_item_id','')='' then raise exception 'Menu item is required'; end if;
  qty:=coalesce((item->>'quantity')::integer,0); if qty<1 or qty>50 then raise exception 'Quantity must be between 1 and 50'; end if;
  select * into menu from public.restaurant_menu_items where id=(item->>'menu_item_id')::uuid and department_id=d and is_available=true;
  if not found then raise exception 'Menu item is unavailable for this department'; end if;
  insert into public.restaurant_order_items(order_id,menu_item_id,item_name,quantity,unit_price,line_total,notes) values(oid,menu.id,menu.name,qty,menu.price,menu.price*qty,nullif(trim(item->>'notes'),''));
  total:=total+(menu.price*qty);
 end loop;
 update public.restaurant_orders set total_amount=total where id=oid;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'Created restaurant or bar order','restaurant_order',oid,jsonb_build_object('department_id',d,'total',total));
 return oid;
end; $$;
create or replace function public.update_restaurant_order_status(p_order_id uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$
declare o public.restaurant_orders%rowtype; rec record; available numeric(14,3);
begin
 if public.current_user_role()<>'manager' and not public.is_owner() then raise exception 'Manager access required to update order status'; end if;
 select * into o from public.restaurant_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if not public.is_owner() and o.department_id<>public.current_user_department() then raise exception 'This order belongs to another department'; end if;
 if p_status not in('placed','preparing','ready','served','cancelled') then raise exception 'Invalid order status'; end if;
 if o.status=p_status then return; end if;
 if o.status in('served','cancelled') then raise exception 'This order is already closed'; end if;
 if p_status='preparing' and o.status<>'placed' then raise exception 'Only placed orders can start preparation'; end if;
 if p_status='ready' and o.status<>'preparing' then raise exception 'Only preparing orders can be marked ready'; end if;
 if p_status='served' and o.status<>'ready' then raise exception 'Only ready orders can be served'; end if;
 if p_status='cancelled' and o.status not in('placed','preparing','ready') then raise exception 'Order cannot be cancelled now'; end if;
 if p_status='served' then
  for rec in select mi.inventory_item_id,sum(mi.quantity_required*oi.quantity)::numeric(14,3) as qty from public.restaurant_order_items oi join public.menu_item_ingredients mi on mi.menu_item_id=oi.menu_item_id where oi.order_id=p_order_id group by mi.inventory_item_id loop
   select quantity into available from public.inventory_items where id=rec.inventory_item_id and department_id=o.department_id and is_active=true for update;
   if not found then raise exception 'A recipe ingredient is missing from this department stock'; end if;
   if available<rec.qty then raise exception 'Insufficient stock for one or more recipe ingredients'; end if;
  end loop;
  for rec in select mi.inventory_item_id,sum(mi.quantity_required*oi.quantity)::numeric(14,3) as qty from public.restaurant_order_items oi join public.menu_item_ingredients mi on mi.menu_item_id=oi.menu_item_id where oi.order_id=p_order_id group by mi.inventory_item_id loop
   update public.inventory_items set quantity=quantity-rec.qty,updated_at=now() where id=rec.inventory_item_id;
   insert into public.inventory_movements(inventory_item_id,department_id,movement_type,quantity_delta,note,reference_id,created_by) values(rec.inventory_item_id,o.department_id,'sale',-rec.qty,'Ingredients consumed for order #'||o.order_number,p_order_id,auth.uid());
  end loop;
 end if;
 update public.restaurant_orders set status=p_status,updated_at=now(),served_at=case when p_status='served' then now() else served_at end where id=p_order_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'Updated restaurant order status','restaurant_order',p_order_id,jsonb_build_object('from',o.status,'to',p_status));
end; $$;
create or replace function public.adjust_department_stock(p_inventory_item_id uuid,p_quantity_delta numeric,p_movement_type text,p_note text default null) returns void language plpgsql security definer set search_path=public as $$
declare it public.inventory_items%rowtype;
begin
 if public.current_user_role()<>'manager' and not public.is_owner() then raise exception 'Manager access required'; end if;
 if p_quantity_delta=0 or p_quantity_delta is null then raise exception 'Enter a non-zero quantity'; end if;
 if p_movement_type not in('purchase','adjustment','waste','opening') then raise exception 'Invalid stock movement'; end if;
 if p_movement_type in('purchase','opening') and p_quantity_delta<0 then raise exception 'Purchases and opening balances must increase stock'; end if;
 if p_movement_type='waste' and p_quantity_delta>0 then raise exception 'Wastage must reduce stock'; end if;
 select * into it from public.inventory_items where id=p_inventory_item_id and is_active=true for update;
 if not found then raise exception 'Stock item not found'; end if;
 if not public.is_owner() and it.department_id<>public.current_user_department() then raise exception 'This stock item belongs to another department'; end if;
 if it.quantity+p_quantity_delta<0 then raise exception 'Stock cannot become negative'; end if;
 update public.inventory_items set quantity=quantity+p_quantity_delta,updated_at=now() where id=p_inventory_item_id;
 insert into public.inventory_movements(inventory_item_id,department_id,movement_type,quantity_delta,note,created_by) values(it.id,it.department_id,p_movement_type,p_quantity_delta,nullif(trim(p_note),''),auth.uid());
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'Recorded stock movement','inventory_item',it.id,jsonb_build_object('movement_type',p_movement_type,'quantity_delta',p_quantity_delta));
end; $$;
revoke all on function public.create_restaurant_order(text,text,text,jsonb,text) from public;
revoke all on function public.update_restaurant_order_status(uuid,text) from public;
revoke all on function public.adjust_department_stock(uuid,numeric,text,text) from public;
grant execute on function public.create_restaurant_order(text,text,text,jsonb,text) to authenticated;
grant execute on function public.update_restaurant_order_status(uuid,text) to authenticated;
grant execute on function public.adjust_department_stock(uuid,numeric,text,text) to authenticated;
