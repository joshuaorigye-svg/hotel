-- Supplier invoice capture and purchase-to-expense reconciliation.
-- Apply after 0022_inventory_management.sql.

alter table public.inventory_purchase_order_items
  add column if not exists quantity_invoiced numeric(14,3) not null default 0;
alter table public.inventory_purchase_order_items
  drop constraint if exists inventory_po_quantity_invoiced_check;
alter table public.inventory_purchase_order_items
  add constraint inventory_po_quantity_invoiced_check
  check(quantity_invoiced >= 0 and quantity_invoiced <= quantity_received);

create table if not exists public.inventory_supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  supplier_id uuid not null references public.inventory_suppliers(id),
  purchase_order_id uuid not null references public.inventory_purchase_orders(id),
  department_id uuid not null references public.departments(id),
  invoice_date date not null,
  due_date date,
  notes text,
  total_amount numeric(14,2) not null default 0 check(total_amount > 0),
  status text not null default 'pending' check(status in ('pending','approved','rejected','paid')),
  expense_id uuid references public.expenses(id),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  paid_by uuid references public.profiles(id),
  paid_at timestamptz,
  payment_method text,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_supplier_invoice_number_check
    check(char_length(trim(invoice_number)) between 1 and 100),
  constraint inventory_supplier_invoice_due_date_check
    check(due_date is null or due_date >= invoice_date),
  constraint inventory_supplier_invoice_supplier_number_unique
    unique(supplier_id, invoice_number)
);

create table if not exists public.inventory_supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.inventory_supplier_invoices(id) on delete cascade,
  purchase_order_item_id uuid not null references public.inventory_purchase_order_items(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,3) not null check(quantity > 0),
  unit_price numeric(14,2) not null check(unit_price >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  unique(invoice_id, purchase_order_item_id)
);

create index if not exists inventory_supplier_invoices_status_idx
  on public.inventory_supplier_invoices(status, created_at desc);
create index if not exists inventory_supplier_invoices_department_idx
  on public.inventory_supplier_invoices(department_id, created_at desc);
create index if not exists inventory_supplier_invoice_lines_invoice_idx
  on public.inventory_supplier_invoice_lines(invoice_id);

alter table public.inventory_supplier_invoices enable row level security;
alter table public.inventory_supplier_invoice_lines enable row level security;

drop policy if exists "supplier invoice scoped read" on public.inventory_supplier_invoices;
create policy "supplier invoice scoped read" on public.inventory_supplier_invoices
  for select to authenticated using(
    public.is_owner()
    or (public.current_user_role()='manager' and department_id=public.current_user_department())
  );

drop policy if exists "supplier invoice line scoped read" on public.inventory_supplier_invoice_lines;
create policy "supplier invoice line scoped read" on public.inventory_supplier_invoice_lines
  for select to authenticated using(exists(
    select 1 from public.inventory_supplier_invoices i
    where i.id=invoice_id and (
      public.is_owner()
      or (public.current_user_role()='manager' and i.department_id=public.current_user_department())
    )
  ));

revoke insert, update, delete on public.inventory_supplier_invoices,
  public.inventory_supplier_invoice_lines from authenticated;
grant select on public.inventory_supplier_invoices,
  public.inventory_supplier_invoice_lines to authenticated;

create or replace function public.submit_supplier_invoice(
  p_purchase_order_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_due_date date,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  po public.inventory_purchase_orders%rowtype;
  po_line public.inventory_purchase_order_items%rowtype;
  entry jsonb;
  invoice_id uuid;
  invoice_total numeric(14,2) := 0;
  qty numeric(14,3);
  price numeric(14,2);
  pending_qty numeric(14,3);
  actor_role text;
  line_count integer;
begin
  actor_role:=public.current_user_role();
  if actor_role not in ('owner','manager') then
    raise exception 'Manager or owner access required';
  end if;
  if nullif(trim(coalesce(p_invoice_number,'')),'') is null
     or char_length(trim(p_invoice_number))>100 then
    raise exception 'Enter a valid supplier invoice number';
  end if;
  if p_invoice_date is null or (p_due_date is not null and p_due_date<p_invoice_date) then
    raise exception 'Check the invoice and due dates';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0
     or jsonb_array_length(p_lines)>100 then
    raise exception 'Add between one and 100 invoice lines';
  end if;

  select * into po from public.inventory_purchase_orders
  where id=p_purchase_order_id for update;
  if not found or po.status not in ('partially_received','received') then
    raise exception 'Invoices can only be submitted against partially or fully received purchase orders';
  end if;
  if actor_role='manager' and po.department_id is distinct from public.current_user_department() then
    raise exception 'You can only invoice purchases for your department';
  end if;

  if exists(
    select 1 from public.inventory_supplier_invoices
    where supplier_id=po.supplier_id and lower(invoice_number)=lower(trim(p_invoice_number))
  ) then raise exception 'This supplier invoice number has already been recorded'; end if;

  insert into public.inventory_supplier_invoices(
    invoice_number,supplier_id,purchase_order_id,department_id,
    invoice_date,due_date,notes,requested_by
  ) values (
    trim(p_invoice_number),po.supplier_id,po.id,po.department_id,
    p_invoice_date,p_due_date,nullif(trim(coalesce(p_notes,'')),''),auth.uid()
  ) returning id into invoice_id;

  line_count:=0;
  for entry in select value from jsonb_array_elements(p_lines) loop
    select * into po_line
    from public.inventory_purchase_order_items
    where id=(entry->>'purchase_order_item_id')::uuid
      and purchase_order_id=po.id
    for update;
    if not found then raise exception 'An invoice line does not belong to this purchase order'; end if;

    qty:=coalesce((entry->>'quantity')::numeric,0);
    price:=coalesce((entry->>'unit_price')::numeric,0);
    select coalesce(sum(l.quantity),0) into pending_qty
    from public.inventory_supplier_invoice_lines l
    join public.inventory_supplier_invoices i on i.id=l.invoice_id
    where l.purchase_order_item_id=po_line.id and i.status='pending';

    if qty<=0 or qty>po_line.quantity_received-po_line.quantity_invoiced-pending_qty then
      raise exception 'Invoice quantity exceeds the received, uninvoiced quantity for an item';
    end if;
    if price<0 or price>1000000000 then raise exception 'Enter a valid unit price'; end if;

    insert into public.inventory_supplier_invoice_lines(
      invoice_id,purchase_order_item_id,inventory_item_id,quantity,unit_price
    ) values(invoice_id,po_line.id,po_line.inventory_item_id,qty,price);
    invoice_total:=invoice_total+round(qty*price,2);
    line_count:=line_count+1;
  end loop;

  if line_count=0 or invoice_total<=0 then
    raise exception 'Invoice total must be greater than zero';
  end if;
  update public.inventory_supplier_invoices
  set total_amount=invoice_total,updated_at=now()
  where id=invoice_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Submitted supplier invoice','inventory_supplier_invoice',invoice_id,
    jsonb_build_object('purchase_order_id',po.id,'invoice_number',trim(p_invoice_number),
      'total_amount',invoice_total,'line_count',line_count));

  insert into public.user_notifications(user_id,title,message,href,entity_type,entity_id)
  select id,'Supplier invoice awaiting review',
    'A supplier invoice has been submitted for owner review.',
    '/owner/inventory/invoices','inventory_supplier_invoice',invoice_id
  from public.profiles where role='owner' and is_active;

  return invoice_id;
end;
$$;
revoke all on function public.submit_supplier_invoice(uuid,text,date,date,text,jsonb) from public;
grant execute on function public.submit_supplier_invoice(uuid,text,date,date,text,jsonb) to authenticated;

create or replace function public.review_supplier_invoice(
  p_invoice_id uuid,
  p_decision text,
  p_note text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  invoice public.inventory_supplier_invoices%rowtype;
  line record;
  expense_id uuid;
begin
  if not public.is_owner() then raise exception 'Owner approval required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
  if p_decision='rejected' and char_length(trim(coalesce(p_note,'')))<3 then
    raise exception 'Add a reason when rejecting this invoice';
  end if;

  select * into invoice from public.inventory_supplier_invoices
  where id=p_invoice_id for update;
  if not found or invoice.status<>'pending' then
    raise exception 'Only pending supplier invoices can be reviewed';
  end if;

  if p_decision='rejected' then
    update public.inventory_supplier_invoices
    set status='rejected',review_note=trim(p_note),reviewed_by=auth.uid(),
      reviewed_at=now(),updated_at=now()
    where id=invoice.id;
  else
    -- Lock and recheck every purchase line before committing the invoice.
    for line in
      select l.purchase_order_item_id,l.quantity
      from public.inventory_supplier_invoice_lines l
      where l.invoice_id=invoice.id
      order by l.purchase_order_item_id
    loop
      perform 1 from public.inventory_purchase_order_items p
      where p.id=line.purchase_order_item_id
        and p.quantity_invoiced+line.quantity<=p.quantity_received
      for update;
      if not found then
        raise exception 'Received quantities changed. Reconcile this invoice before approval';
      end if;
      update public.inventory_purchase_order_items
      set quantity_invoiced=quantity_invoiced+line.quantity
      where id=line.purchase_order_item_id;
    end loop;

    insert into public.expenses(
      title,description,amount,department_id,created_by,approval_status,
      category,payment_method,receipt_reference,approved_by,reviewed_at,payment_status
    ) values (
      'Supplier invoice '||invoice.invoice_number,
      'Supplier invoice linked to purchase order '||invoice.purchase_order_id::text,
      invoice.total_amount,invoice.department_id,auth.uid(),'approved',
      'supplies',null,invoice.invoice_number,auth.uid(),now(),'unpaid'
    ) returning id into expense_id;

    update public.inventory_supplier_invoices
    set status='approved',expense_id=expense_id,review_note=nullif(trim(coalesce(p_note,'')),''),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=invoice.id;

    insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'Approved supplier invoice and created payable expense',
      'inventory_supplier_invoice',invoice.id,
      jsonb_build_object('expense_id',expense_id,'amount',invoice.total_amount));
  end if;
end;
$$;
revoke all on function public.review_supplier_invoice(uuid,text,text) from public;
grant execute on function public.review_supplier_invoice(uuid,text,text) to authenticated;

create or replace function public.pay_supplier_invoice(
  p_invoice_id uuid,
  p_payment_method text,
  p_payment_reference text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  invoice public.inventory_supplier_invoices%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner payment authority required'; end if;
  if p_payment_method not in ('cash','mobile_money','card','bank_transfer','pesapal') then
    raise exception 'Choose a valid payment method';
  end if;
  select * into invoice from public.inventory_supplier_invoices
  where id=p_invoice_id for update;
  if not found or invoice.status<>'approved' or invoice.expense_id is null then
    raise exception 'Only approved, unpaid supplier invoices can be paid';
  end if;

  perform public.mark_expense_paid(invoice.expense_id,p_payment_method,p_payment_reference);

  update public.inventory_supplier_invoices
  set status='paid',payment_method=p_payment_method,
    payment_reference=nullif(trim(coalesce(p_payment_reference,'')),''),
    paid_by=auth.uid(),paid_at=now(),updated_at=now()
  where id=invoice.id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Paid supplier invoice','inventory_supplier_invoice',invoice.id,
    jsonb_build_object('expense_id',invoice.expense_id,'amount',invoice.total_amount,
      'payment_method',p_payment_method,'payment_reference',p_payment_reference));
end;
$$;
revoke all on function public.pay_supplier_invoice(uuid,text,text) from public;
grant execute on function public.pay_supplier_invoice(uuid,text,text) to authenticated;
