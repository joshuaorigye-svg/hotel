-- Private supplier invoice evidence storage.
-- Apply after 0023_supplier_invoice_reconciliation.sql.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'supplier-invoice-documents',
  'supplier-invoice-documents',
  false,
  10485760,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.inventory_supplier_invoice_documents(
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.inventory_supplier_invoices(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760),
  document_type text not null default 'invoice'
    check(document_type in ('invoice','delivery_note','receipt','other')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint inventory_supplier_invoice_document_name_check
    check(char_length(trim(file_name)) between 1 and 180 and file_name !~ '[/\\]')
);

create index if not exists inventory_supplier_invoice_documents_invoice_idx
  on public.inventory_supplier_invoice_documents(invoice_id,created_at desc);

alter table public.inventory_supplier_invoice_documents enable row level security;
drop policy if exists "supplier invoice documents scoped read"
  on public.inventory_supplier_invoice_documents;
create policy "supplier invoice documents scoped read"
  on public.inventory_supplier_invoice_documents
  for select to authenticated using(exists(
    select 1 from public.inventory_supplier_invoices i
    where i.id=invoice_id and (
      public.is_owner()
      or (public.current_user_role()='manager'
        and i.department_id=public.current_user_department())
    )
  ));

revoke insert,update,delete on public.inventory_supplier_invoice_documents from authenticated;
grant select on public.inventory_supplier_invoice_documents to authenticated;

create or replace function public.register_supplier_invoice_document(
  p_invoice_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_document_type text default 'invoice'
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  invoice public.inventory_supplier_invoices%rowtype;
  document_id uuid;
begin
  if public.current_user_role() not in ('owner','manager') then
    raise exception 'Owner or department manager access required';
  end if;
  if p_document_type is null or p_document_type not in ('invoice','delivery_note','receipt','other') then
    raise exception 'Choose a valid document type';
  end if;
  if p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')
     or p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>10485760 then
    raise exception 'Only PDF, JPG, PNG or WEBP files up to 10 MB are accepted';
  end if;
  if nullif(trim(coalesce(p_file_name,'')),'') is null
     or char_length(p_file_name)>180 or p_file_name ~ '[/\\]' then
    raise exception 'Enter a valid file name';
  end if;
  if p_storage_path is null
     or p_storage_path !~ ('^'||p_invoice_id::text||'/[A-Za-z0-9._-]{1,180}$') then
    raise exception 'Invalid document storage path';
  end if;

  select * into invoice
  from public.inventory_supplier_invoices
  where id=p_invoice_id for update;
  if not found then raise exception 'Supplier invoice not found'; end if;
  if public.current_user_role()='manager'
     and invoice.department_id is distinct from public.current_user_department() then
    raise exception 'You can only upload documents for your department';
  end if;
  if public.current_user_role()='manager' and invoice.status not in ('pending','rejected') then
    raise exception 'Managers can only attach documents to pending or rejected invoices';
  end if;
  if not exists(
    select 1 from storage.objects
    where bucket_id='supplier-invoice-documents' and name=p_storage_path
  ) then raise exception 'Uploaded file was not found in private storage'; end if;

  insert into public.inventory_supplier_invoice_documents(
    invoice_id,storage_path,file_name,mime_type,size_bytes,document_type,uploaded_by
  ) values(
    p_invoice_id,p_storage_path,trim(p_file_name),p_mime_type,p_size_bytes,p_document_type,auth.uid()
  ) returning id into document_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Uploaded supplier invoice supporting document',
    'inventory_supplier_invoice_document',document_id,
    jsonb_build_object('invoice_id',p_invoice_id,'file_name',trim(p_file_name),
      'mime_type',p_mime_type,'size_bytes',p_size_bytes,'document_type',p_document_type));
  return document_id;
end;
$$;
revoke all on function public.register_supplier_invoice_document(uuid,text,text,text,bigint,text) from public;
grant execute on function public.register_supplier_invoice_document(uuid,text,text,text,bigint,text) to authenticated;

-- Storage object access follows the invoice's department scope and registered
-- document metadata. Unregistered uploads can be removed by their uploader
-- after a failed metadata registration.
drop policy if exists "supplier invoice evidence read" on storage.objects;
create policy "supplier invoice evidence read" on storage.objects
for select to authenticated using(
  bucket_id='supplier-invoice-documents'
  and exists(
    select 1
    from public.inventory_supplier_invoice_documents d
    join public.inventory_supplier_invoices i on i.id=d.invoice_id
    where d.storage_path=name and (
      public.is_owner()
      or (public.current_user_role()='manager'
        and i.department_id=public.current_user_department())
    )
  )
);

drop policy if exists "supplier invoice evidence upload" on storage.objects;
create policy "supplier invoice evidence upload" on storage.objects
for insert to authenticated with check(
  bucket_id='supplier-invoice-documents'
  and split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists(
    select 1 from public.inventory_supplier_invoices i
    where i.id::text=split_part(name,'/',1)
      and (
        public.is_owner()
        or (public.current_user_role()='manager'
          and i.department_id=public.current_user_department()
          and i.status in ('pending','rejected'))
      )
  )
);

drop policy if exists "supplier invoice evidence cleanup unregistered" on storage.objects;
create policy "supplier invoice evidence cleanup unregistered" on storage.objects
for delete to authenticated using(
  bucket_id='supplier-invoice-documents'
  and not exists(
    select 1 from public.inventory_supplier_invoice_documents d
    where d.storage_path=name
  )
  and split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists(
    select 1 from public.inventory_supplier_invoices i
    where i.id::text=split_part(name,'/',1)
      and (
        public.is_owner()
        or (public.current_user_role()='manager'
          and i.department_id=public.current_user_department()
          and i.status in ('pending','rejected'))
      )
  )
);
