-- Adeldas IMS — Supabase Schema
-- Run this in the Supabase SQL editor to set up all tables and RLS policies.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users (extends Supabase auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null check (role in ('administrator', 'inventory_manager', 'staff', 'viewer')),
  created_at timestamptz default now()
);

-- Suppliers
create table if not exists public.suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  created_at timestamptz default now()
);

-- Products
create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  sku text not null unique,
  barcode text unique,
  qr_code text,
  brand text,
  category text not null check (category in ('Medical', 'Detection')),
  description text,
  batch_number text,
  expiry_date date,
  unit_cost numeric(12,2) default 0,
  selling_price numeric(12,2) default 0,
  reorder_level integer default 0,
  stock_quantity integer default 0,
  supplier_id uuid references public.suppliers(id),
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Purchase Orders
create table if not exists public.purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  order_number text not null unique,
  supplier_id uuid references public.suppliers(id),
  status text not null check (status in ('draft','pending','approved','received','cancelled')) default 'draft',
  total_cost numeric(14,2) default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Purchase Order Items
create table if not exists public.purchase_order_items (
  id uuid primary key default uuid_generate_v4(),
  purchase_order_id uuid references public.purchase_orders(id) on delete cascade,
  product_id uuid references public.products(id),
  quantity integer not null default 0,
  unit_cost numeric(12,2) default 0,
  subtotal numeric(14,2) generated always as (quantity * unit_cost) stored
);

-- Transactions
create table if not exists public.transactions (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.products(id),
  sku text,
  barcode text,
  type text not null check (type in ('inbound','outbound','adjustment','barcode_scan','purchase_order_received')),
  quantity integer not null,
  user_id uuid references public.users(id),
  notes text,
  created_at timestamptz default now()
);

-- Alerts
create table if not exists public.alerts (
  id uuid primary key default uuid_generate_v4(),
  type text not null check (type in ('low_stock','out_of_stock','expiring_product','new_purchase_order','inventory_discrepancy')),
  message text not null,
  status text not null check (status in ('unread','read')) default 'unread',
  product_id uuid references public.products(id),
  created_at timestamptz default now()
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger products_updated_at before update on public.products for each row execute procedure update_updated_at();
create trigger purchase_orders_updated_at before update on public.purchase_orders for each row execute procedure update_updated_at();

-- Row-Level Security
alter table public.users enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.transactions enable row level security;
alter table public.alerts enable row level security;

-- RLS: All authenticated users can read everything
create policy "Authenticated read" on public.products for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.suppliers for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.purchase_orders for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.purchase_order_items for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.transactions for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.alerts for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.users for select using (auth.role() = 'authenticated');

-- RLS: Write access via application (Administrators and Inventory Managers)
create policy "Staff can write products" on public.products for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
);
create policy "Manager can write POs" on public.purchase_orders for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager'))
);
create policy "Staff can write transactions" on public.transactions for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
);
create policy "Authenticated update alerts" on public.alerts for update using (auth.role() = 'authenticated');
