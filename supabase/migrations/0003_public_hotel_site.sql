create table if not exists public.restaurant_menu_items(
 id uuid primary key default gen_random_uuid(),name text not null,description text,category text not null default 'Meals',price numeric(14,2) not null default 0 check(price>=0),image_url text,is_available boolean not null default true,created_at timestamptz not null default now()
);
create table if not exists public.contact_messages(
 id uuid primary key default gen_random_uuid(),name text not null,phone text not null,email text,message text not null,status text not null default 'new' check(status in('new','read','replied','closed')),created_at timestamptz not null default now()
);
alter table public.restaurant_menu_items enable row level security;
alter table public.contact_messages enable row level security;
create policy "public view available menu" on public.restaurant_menu_items for select to anon,authenticated using(is_available=true);
create policy "owner menu management" on public.restaurant_menu_items for all to authenticated using(public.is_owner()) with check(public.is_owner());
create policy "public send contact message" on public.contact_messages for insert to anon,authenticated with check(status='new');
create policy "owner contact inbox" on public.contact_messages for all to authenticated using(public.is_owner()) with check(public.is_owner());
