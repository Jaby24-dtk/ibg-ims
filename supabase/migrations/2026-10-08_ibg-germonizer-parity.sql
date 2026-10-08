-- I-BG CT Asia IMS — catch up with Germonizer IMS (2026-10-08)
-- Run ONCE in the Supabase SQL editor for the I-BG IMS project (ogtmoyievbbyefvqcfqx).
-- Combines Germonizer's migrations 2026-09-02 … 2026-10-08 in order, minus:
--   * the BeSuro Shopify location seeds + Shopify-only functions
--   * the Germonizer-only IDT9000T data repair
-- Every statement is guarded, so it is safe to re-run.


-- ════════════ from 2026-09-02_persistence.sql ════════════
-- Adeldas IMS — persistence migration (2026-09-02)
-- Run this ONCE in the Supabase SQL editor for the Adeldas project.
-- Brings the live DB in line with the app now that every page reads/writes Supabase
-- (ported from the I-BG CT Asia IMS, which received these changes 13–30 Aug 2026).
--
-- Safe to re-run: every statement is guarded.

begin;

-- 1. transactions: allow the 'sample' movement type (Mark as Sample on Inventory)
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check
  check (type in ('inbound','outbound','adjustment','barcode_scan','purchase_order_received','sample'));

-- 2. transactions: price snapshot columns, so later price edits don't rewrite
--    historical profit figures. Null on existing rows; the app falls back to the
--    product's current price for those.
alter table public.transactions add column if not exists unit_cost numeric(12,2);
alter table public.transactions add column if not exists selling_price numeric(12,2);

-- 3. alerts: the table only had select + update policies, so every insert/delete
--    was silently RLS-blocked. Alert generation (Dashboard) and dismiss/delete
--    (Alerts page) need these. Same scope as the existing alerts policies.
drop policy if exists "Authenticated insert alerts" on public.alerts;
create policy "Authenticated insert alerts" on public.alerts
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated delete alerts" on public.alerts;
create policy "Authenticated delete alerts" on public.alerts
  for delete using (auth.role() = 'authenticated');

commit;

-- ════════════ from 2026-09-02_categories.sql ════════════
-- Adeldas IMS — user-managed product categories (2026-09-02)
-- Run once in the Supabase SQL editor for the Adeldas project.
-- Replaces the fixed Medical/Detection CHECK with a categories table the
-- team manages from Settings → Categories. products.category stays a free
-- text column (matched by name, no FK) so existing rows are untouched.

begin;

create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz default now()
);

alter table public.categories enable row level security;

drop policy if exists "Authenticated read categories" on public.categories;
create policy "Authenticated read categories" on public.categories
  for select using (auth.role() = 'authenticated');

drop policy if exists "Manager can write categories" on public.categories;
create policy "Manager can write categories" on public.categories for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager'))
);

-- Seed from the categories products already use, plus the default.
insert into public.categories (name)
  select distinct category from public.products where coalesce(trim(category), '') <> ''
  on conflict (name) do nothing;
insert into public.categories (name) values ('General') on conflict (name) do nothing;

-- Drop the fixed-values constraint; category is now any name from the table.
alter table public.products drop constraint if exists products_category_check;
alter table public.products alter column category set default 'General';

commit;

-- ════════════ from 2026-09-02_po-items-write.sql ════════════
-- Adeldas IMS — purchase_order_items write access (2026-09-02)
-- Run once in the Supabase SQL editor for the Adeldas project.
-- purchase_order_items had only a select policy, so the new "Items" section
-- of the Create Purchase Order dialog couldn't save line items. This adds a
-- write policy scoped to Administrator + Inventory Manager (same as
-- purchase_orders / suppliers).

drop policy if exists "Manager can write PO items" on public.purchase_order_items;
create policy "Manager can write PO items" on public.purchase_order_items for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager'))
);

-- ════════════ from 2026-09-02_suppliers-write.sql ════════════
-- Adeldas IMS — suppliers write access (2026-09-02)
-- Run once in the Supabase SQL editor for the Adeldas project.
-- The suppliers table only had a "select" RLS policy, so the app could read
-- suppliers but never create/edit/delete them. This adds a write policy
-- scoped to Administrator + Inventory Manager (same as purchase_orders),
-- enabling the new Suppliers tab in Settings and the "+ New supplier"
-- shortcut in the Create Purchase Order dialog.

drop policy if exists "Manager can write suppliers" on public.suppliers;
create policy "Manager can write suppliers" on public.suppliers for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager'))
);

-- ════════════ from 2026-09-03_supplier-country-leadtime.sql ════════════
-- Germonizer IMS — supplier country + production lead time (2026-09-03)
-- (originally written for Germonizer IMS)
--
-- Adds two fields to the Add / Edit Supplier form:
--   country         — where the supplier ships / manufactures from
--   lead_time_days   — production lead time in days, so Purchase Orders can
--                      show when goods will be ready and the reorder point
--                      can account for it.
-- Safe to re-run.

alter table public.suppliers add column if not exists country text;
alter table public.suppliers add column if not exists lead_time_days integer;

alter table public.suppliers drop constraint if exists suppliers_lead_time_days_check;
alter table public.suppliers
  add constraint suppliers_lead_time_days_check
  check (lead_time_days is null or (lead_time_days >= 0 and lead_time_days <= 3650));

-- ════════════ from 2026-09-03_alert-email-digest.sql ════════════
-- Germonizer IMS — daily email alert digest (2026-09-03)
-- (originally written for Germonizer IMS)
--
-- Adds:
--   1. alert_recipients   — the list of email addresses that receive the
--                           daily digest (managed in Settings → Email Alerts,
--                           Administrator only).
--   2. alerts.emailed_at  — timestamp set once an alert has been included in a
--                           sent digest, so it is never emailed twice.
--
-- The digest itself is sent by the `send-alert-digest` Edge Function, which is
-- invoked once a day (see supabase/functions/send-alert-digest/README.md for the
-- deploy + schedule steps). Safe to re-run.

-- 1. recipients -------------------------------------------------------------
create table if not exists public.alert_recipients (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists alert_recipients_email_key
  on public.alert_recipients (lower(email));

alter table public.alert_recipients enable row level security;

drop policy if exists "Authenticated read alert_recipients" on public.alert_recipients;
create policy "Authenticated read alert_recipients" on public.alert_recipients
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admin write alert_recipients" on public.alert_recipients;
create policy "Admin write alert_recipients" on public.alert_recipients
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'administrator')
  );

-- 2. de-dupe guard on alerts ---------------------------------------------------
alter table public.alerts add column if not exists emailed_at timestamptz;

create index if not exists alerts_emailed_at_idx
  on public.alerts (emailed_at) where emailed_at is null;

-- ════════════ from 2026-09-03_audit-log.sql ════════════
-- Germonizer IMS — audit log + force-delete for products & suppliers (2026-09-03)
-- (originally written for Germonizer IMS)
--
-- Problem: products / suppliers with any history (a transaction, a PO line, an
-- alert, a linked product) could not be deleted at all — the FK constraints
-- rejected it and the app just showed "can't be deleted".
--
-- This adds:
--   1. public.audit_log        — append-only record of who deleted what, with a
--                                full JSON snapshot of the row.
--   2. delete_product_cascade  — SECURITY DEFINER function: writes the audit row,
--      delete_supplier_cascade   detaches dependents (nulls product_id / supplier_id
--                                on transactions, PO items and POs; drops the
--                                product's alerts), then deletes the row. Role-gated
--                                to match the existing write policies.
-- Safe to re-run.

-- 1. audit_log ---------------------------------------------------------------
create table if not exists public.audit_log (
  id           uuid primary key default uuid_generate_v4(),
  actor_id     uuid references public.users(id),
  actor_name   text,
  actor_email  text,
  action       text not null,          -- 'delete'
  entity_type  text not null,          -- 'product' | 'supplier'
  entity_id    uuid,
  entity_label text,                   -- human name at time of the action
  snapshot     jsonb,                  -- the full row, as it was
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

-- Any signed-in user can read the log; inserts happen inside the SECURITY DEFINER
-- functions below. No update/delete policy => rows are append-only from the app.
drop policy if exists "Authenticated read audit_log" on public.audit_log;
create policy "Authenticated read audit_log" on public.audit_log
  for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated insert audit_log" on public.audit_log;
create policy "Authenticated insert audit_log" on public.audit_log
  for insert with check (auth.role() = 'authenticated');

-- 2. force-delete functions ------------------------------------------------
create or replace function public.delete_product_cascade(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.products%rowtype;
  v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('administrator','inventory_manager','staff') then
    raise exception 'Not permitted to delete products';
  end if;

  select * into v_row from public.products where id = p_id;
  if v_row.id is null then
    raise exception 'Product not found';
  end if;

  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (v_actor.id, v_actor.name, v_actor.email, 'delete', 'product', v_row.id, v_row.name, to_jsonb(v_row));

  -- keep the ledger, just detach it from the now-gone product
  update public.transactions         set product_id = null where product_id = p_id;
  update public.purchase_order_items set product_id = null where product_id = p_id;
  delete from public.alerts where product_id = p_id;

  delete from public.products where id = p_id;
end;
$$;

create or replace function public.delete_supplier_cascade(s_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.suppliers%rowtype;
  v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('administrator','inventory_manager') then
    raise exception 'Not permitted to delete suppliers';
  end if;

  select * into v_row from public.suppliers where id = s_id;
  if v_row.id is null then
    raise exception 'Supplier not found';
  end if;

  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (v_actor.id, v_actor.name, v_actor.email, 'delete', 'supplier', v_row.id, v_row.name, to_jsonb(v_row));

  update public.products        set supplier_id = null where supplier_id = s_id;
  update public.purchase_orders set supplier_id = null where supplier_id = s_id;

  delete from public.suppliers where id = s_id;
end;
$$;

revoke all on function public.delete_product_cascade(uuid)  from public, anon;
revoke all on function public.delete_supplier_cascade(uuid) from public, anon;
grant execute on function public.delete_product_cascade(uuid)  to authenticated;
grant execute on function public.delete_supplier_cascade(uuid) to authenticated;

-- ════════════ from 2026-09-24_product-images.sql ════════════
-- Product photos: public-read Storage bucket for products.image_url.
-- Uploads are resized client-side (≤800px JPEG) before they get here.
-- Write access mirrors "Staff can write products" (administrator / inventory_manager / staff).
-- Run once in the Supabase SQL editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Product images: public read" on storage.objects;
create policy "Product images: public read" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "Product images: staff insert" on storage.objects;
create policy "Product images: staff insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
  );

drop policy if exists "Product images: staff update" on storage.objects;
create policy "Product images: staff update" on storage.objects
  for update to authenticated using (
    bucket_id = 'product-images'
    and exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
  );

drop policy if exists "Product images: staff delete" on storage.objects;
create policy "Product images: staff delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'product-images'
    and exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
  );

-- ════════════ from 2026-10-05_shopify-sync.sql (locations/stock core only) ════════════
-- 2026-10-05 — Shopify ↔ IMS stock sync (BeSuro products only) + per-location stock.
-- Run once in the Supabase SQL editor.
--
-- Model:
--   * stock_locations     — physical stock locations; each can map to a Shopify location.
--   * product_stock       — per-location quantity. Only products that have rows here are
--                           "located" (today: BeSuro SKUs linked to Shopify). For them,
--                           products.stock_quantity is kept = SUM(product_stock) by trigger.
--                           Every other product keeps using products.stock_quantity directly.
--   * transactions        — gains location_id, signed stock_delta, source ('ims'|'shopify'),
--                           external_ref (Shopify webhook dedupe) and Shopify push status.
--                           An IMS-side movement on a linked product/location is an outbox
--                           row: it's pending until shopify_synced_at is set by the push job.

create table if not exists public.stock_locations (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  -- Numeric Shopify location id (as text), e.g. '88566071486'. Null = IMS-only location.
  shopify_location_id text unique,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);


-- Numeric Shopify InventoryItem id (as text). Set by the "Link products" step, only for
-- BeSuro-brand products whose SKU matches a Shopify variant.
alter table public.products add column if not exists shopify_inventory_item_id text unique;

create table if not exists public.product_stock (
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete cascade,
  quantity integer not null default 0,
  updated_at timestamptz default now(),
  primary key (product_id, location_id)
);

alter table public.transactions add column if not exists location_id uuid references public.stock_locations(id);
alter table public.transactions add column if not exists stock_delta integer;
alter table public.transactions add column if not exists source text not null default 'ims';
alter table public.transactions add column if not exists external_ref text;
alter table public.transactions add column if not exists shopify_synced_at timestamptz;
alter table public.transactions add column if not exists shopify_error text;
do $$ begin
  alter table public.transactions add constraint transactions_source_check check (source in ('ims','shopify'));
exception when duplicate_object then null; end $$;
create unique index if not exists transactions_external_ref_key on public.transactions (external_ref) where external_ref is not null;
create index if not exists transactions_shopify_pending_idx on public.transactions (created_at)
  where source = 'ims' and location_id is not null and shopify_synced_at is null;

-- ── Keep products.stock_quantity = SUM(product_stock) for located products ──
create or replace function public.product_stock_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products
     set stock_quantity = coalesce((select sum(quantity) from public.product_stock where product_id = pid), 0)
   where id = pid;
  return null;
end $$;

drop trigger if exists product_stock_rollup on public.product_stock;
create trigger product_stock_rollup after insert or update or delete on public.product_stock
  for each row execute function public.product_stock_rollup();

-- ── RLS ──
alter table public.stock_locations enable row level security;
alter table public.product_stock enable row level security;

drop policy if exists "Authenticated read" on public.stock_locations;
create policy "Authenticated read" on public.stock_locations for select using (auth.role() = 'authenticated');
drop policy if exists "Admin can write locations" on public.stock_locations;
create policy "Admin can write locations" on public.stock_locations for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'administrator')
);

drop policy if exists "Authenticated read" on public.product_stock;
create policy "Authenticated read" on public.product_stock for select using (auth.role() = 'authenticated');
drop policy if exists "Staff can write product stock" on public.product_stock;
create policy "Staff can write product stock" on public.product_stock for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
);

-- Transaction quantity convention (unchanged): inbound/outbound/sample/PO-received store a
-- positive quantity; adjustment stores the signed change. stock_delta is always signed.
create or replace function public.tx_quantity(p_type text, p_delta integer)
returns integer language sql immutable as $$
  select case when p_type = 'adjustment' then p_delta else abs(p_delta) end
$$;

-- ── IMS-side movement (called by the app as the signed-in user; RLS applies) ──
-- p_location_id null → non-located product, changes products.stock_quantity directly.
-- Returns the new quantity (at the location, or the product total).
create or replace function public.ims_move_stock(
  p_product_id uuid,
  p_location_id uuid,
  p_delta integer,
  p_type text,
  p_notes text default null,
  p_unit_cost numeric default null,
  p_selling_price numeric default null,
  p_barcode text default null
) returns integer
language plpgsql security invoker set search_path = public as $$
declare v_new integer; v_sku text; v_barcode text; v_cost numeric; v_price numeric;
begin
  if p_location_id is null then
    update public.products set stock_quantity = coalesce(stock_quantity, 0) + p_delta
     where id = p_product_id returning stock_quantity into v_new;
  else
    insert into public.product_stock (product_id, location_id, quantity)
    values (p_product_id, p_location_id, p_delta)
    on conflict (product_id, location_id)
      do update set quantity = public.product_stock.quantity + excluded.quantity, updated_at = now()
    returning quantity into v_new;
  end if;
  if v_new is null then raise exception 'Product not found or not permitted'; end if;
  if v_new < 0 then raise exception 'Not enough stock (only % left)', v_new - p_delta; end if;

  if p_delta <> 0 then
    select sku, barcode, unit_cost, selling_price into v_sku, v_barcode, v_cost, v_price
      from public.products where id = p_product_id;
    insert into public.transactions
      (product_id, sku, barcode, type, quantity, stock_delta, user_id, notes,
       unit_cost, selling_price, location_id, source)
    values
      (p_product_id, v_sku, coalesce(p_barcode, v_barcode), p_type, public.tx_quantity(p_type, p_delta), p_delta,
       auth.uid(), p_notes, coalesce(p_unit_cost, v_cost), coalesce(p_selling_price, v_price), p_location_id, 'ims');
  end if;
  return v_new;
end $$;

grant execute on function public.ims_move_stock(uuid, uuid, integer, text, text, numeric, numeric, text) to authenticated;

-- ── Live updates in the IMS UI ──
do $$ begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.product_stock;
exception when duplicate_object then null; end $$;

-- ════════════ from 2026-10-08_product-batches.sql ════════════
-- 2026-10-08 — Batch / expiry tracking (FEFO) + merge duplicate products.
-- Run once in the Supabase SQL editor, AFTER 2026-10-05_shopify-sync.sql. Safe to re-run.
--
-- Before: one expiry_date + batch_number per product row, so a second delivery of the same
-- item with a different expiry either became a duplicate product or overwrote the date.
--
-- Model:
--   * product_batches     — stock of one product split by batch number + expiry date.
--   * products.stock_quantity stays the source of truth for the total. Batches hold up to
--                           that many units; any remainder is stock with no expiry recorded.
--   * Every decrease of stock_quantity (sale, sample, count, Shopify, table editor…) takes
--                           units from the earliest-expiring batches first (FEFO), by trigger.
--   * products.expiry_date / batch_number become a summary of the earliest batch for any
--                           product that has batches, so dashboard / alerts / reports keep
--                           working unchanged.
--   * ims_move_stock gains p_batch_number / p_expiry_date (stock in → that batch) and
--                           p_batch_id (stock out of one specific batch, e.g. a write-off).
--   * merge_products      — folds a duplicate product (stock, batches, history) into another.

create table if not exists public.product_batches (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  batch_number text not null default '',
  expiry_date date,
  quantity integer not null check (quantity > 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists product_batches_key
  on public.product_batches (product_id, batch_number, expiry_date) nulls not distinct;

-- ── Take p_qty units from a product's batches, earliest expiry first ──
create or replace function public.consume_batches_fefo(p_product_id uuid, p_qty integer)
returns void language plpgsql security definer set search_path = public as $$
declare b record; v_left integer := p_qty;
begin
  for b in select id, quantity from public.product_batches
            where product_id = p_product_id
            order by expiry_date asc nulls last, created_at, id
            for update loop
    exit when v_left <= 0;
    if b.quantity <= v_left then
      delete from public.product_batches where id = b.id;
      v_left := v_left - b.quantity;
    else
      update public.product_batches set quantity = quantity - v_left, updated_at = now() where id = b.id;
      v_left := 0;
    end if;
  end loop;
end $$;

-- ── Batches follow the product total ──
-- A decrease is taken FEFO (unless ims_move_stock already took it from a named batch), then
-- batches are capped at the new total.
create or replace function public.batches_follow_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_excess integer;
begin
  if coalesce(new.stock_quantity, 0) < coalesce(old.stock_quantity, 0)
     and coalesce(current_setting('ims.skip_fefo', true), '') <> 'on' then
    perform public.consume_batches_fefo(new.id, coalesce(old.stock_quantity, 0) - coalesce(new.stock_quantity, 0));
  end if;
  select coalesce(sum(quantity), 0) - greatest(coalesce(new.stock_quantity, 0), 0) into v_excess
    from public.product_batches where product_id = new.id;
  if v_excess > 0 then perform public.consume_batches_fefo(new.id, v_excess); end if;
  return null;
end $$;

drop trigger if exists batches_follow_stock on public.products;
create trigger batches_follow_stock after update of stock_quantity on public.products
  for each row when (new.stock_quantity is distinct from old.stock_quantity)
  execute function public.batches_follow_stock();

-- ── A new product created with stock + expiry (Add Product, import) starts as one batch ──
create or replace function public.product_initial_batch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.stock_quantity, 0) > 0
     and (new.expiry_date is not null or nullif(trim(coalesce(new.batch_number, '')), '') is not null) then
    insert into public.product_batches (product_id, batch_number, expiry_date, quantity)
    values (new.id, trim(coalesce(new.batch_number, '')), new.expiry_date, new.stock_quantity);
  end if;
  return null;
end $$;

drop trigger if exists product_initial_batch on public.products;
create trigger product_initial_batch after insert on public.products
  for each row execute function public.product_initial_batch();

-- ── products.expiry_date / batch_number = earliest batch, for products that have batches ──
create or replace function public.product_batch_summary()
returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  select batch_number, expiry_date into b from public.product_batches
   where product_id = new.id order by expiry_date asc nulls last, created_at, id limit 1;
  if found then
    new.expiry_date := b.expiry_date;
    new.batch_number := nullif(b.batch_number, '');
  end if;
  return new;
end $$;

drop trigger if exists product_batch_summary on public.products;
create trigger product_batch_summary before update on public.products
  for each row execute function public.product_batch_summary();

-- Batch rows changed → refresh the product summary (the BEFORE trigger above fills it in;
-- when the last batch is gone the product has no recorded expiry any more).
create or replace function public.product_batches_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.product_id, old.product_id);
begin
  if exists (select 1 from public.product_batches where product_id = pid) then
    update public.products set updated_at = now() where id = pid;
  else
    update public.products set expiry_date = null, batch_number = null, updated_at = now() where id = pid;
  end if;
  if tg_op = 'UPDATE' and old.product_id <> new.product_id then
    update public.products set updated_at = now() where id = old.product_id;
  end if;
  return null;
end $$;

drop trigger if exists product_batches_changed on public.product_batches;
create trigger product_batches_changed after insert or update or delete on public.product_batches
  for each row execute function public.product_batches_changed();

-- Batches can never hold more units than the product has in stock.
create or replace function public.product_batches_check()
returns trigger language plpgsql set search_path = public as $$
declare v_stock integer; v_other integer;
begin
  new.batch_number := trim(coalesce(new.batch_number, ''));
  if tg_op = 'UPDATE' and new.quantity <= old.quantity and new.product_id = old.product_id then
    return new;
  end if;
  select coalesce(stock_quantity, 0) into v_stock from public.products where id = new.product_id;
  select coalesce(sum(quantity), 0) into v_other from public.product_batches
   where product_id = new.product_id and id <> new.id;
  if v_other + new.quantity > v_stock then
    raise exception 'Only % unit(s) of this product have no batch yet', greatest(v_stock - v_other, 0);
  end if;
  return new;
end $$;

drop trigger if exists product_batches_check on public.product_batches;
create trigger product_batches_check before insert or update on public.product_batches
  for each row execute function public.product_batches_check();

-- ── RLS ──
alter table public.product_batches enable row level security;
drop policy if exists "Authenticated read" on public.product_batches;
create policy "Authenticated read" on public.product_batches for select using (auth.role() = 'authenticated');
drop policy if exists "Staff can write batches" on public.product_batches;
create policy "Staff can write batches" on public.product_batches for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
);

-- ── Backfill: each product's current expiry/batch becomes its first batch ──
insert into public.product_batches (product_id, batch_number, expiry_date, quantity)
select p.id, trim(coalesce(p.batch_number, '')), p.expiry_date, p.stock_quantity
  from public.products p
 where coalesce(p.stock_quantity, 0) > 0
   and (p.expiry_date is not null or nullif(trim(coalesce(p.batch_number, '')), '') is not null)
   and not exists (select 1 from public.product_batches b where b.product_id = p.id);

-- ── ims_move_stock: same as 2026-10-05 plus batch handling ──
drop function if exists public.ims_move_stock(uuid, uuid, integer, text, text, numeric, numeric, text);
create or replace function public.ims_move_stock(
  p_product_id uuid,
  p_location_id uuid,
  p_delta integer,
  p_type text,
  p_notes text default null,
  p_unit_cost numeric default null,
  p_selling_price numeric default null,
  p_barcode text default null,
  p_batch_number text default null,  -- stock in: the delivery's batch number
  p_expiry_date date default null,   -- stock in: the delivery's expiry date
  p_batch_id uuid default null       -- stock in or out of this exact batch
) returns integer
language plpgsql security invoker set search_path = public as $$
declare v_new integer; v_sku text; v_barcode text; v_cost numeric; v_price numeric; v_left integer;
begin
  -- Stock out of a named batch: take it there first, so the FEFO trigger doesn't pick another.
  if p_delta < 0 and p_batch_id is not null then
    select quantity + p_delta into v_left from public.product_batches
     where id = p_batch_id and product_id = p_product_id for update;
    if v_left is null then raise exception 'Batch not found'; end if;
    if v_left < 0 then raise exception 'Only % unit(s) left in that batch', v_left - p_delta; end if;
    if v_left = 0 then delete from public.product_batches where id = p_batch_id;
    else update public.product_batches set quantity = v_left, updated_at = now() where id = p_batch_id; end if;
    perform set_config('ims.skip_fefo', 'on', true);
  end if;

  if p_location_id is null then
    update public.products set stock_quantity = coalesce(stock_quantity, 0) + p_delta
     where id = p_product_id returning stock_quantity into v_new;
  else
    insert into public.product_stock (product_id, location_id, quantity)
    values (p_product_id, p_location_id, p_delta)
    on conflict (product_id, location_id)
      do update set quantity = public.product_stock.quantity + excluded.quantity, updated_at = now()
    returning quantity into v_new;
  end if;
  perform set_config('ims.skip_fefo', '', true);
  if v_new is null then raise exception 'Product not found or not permitted'; end if;
  if v_new < 0 then raise exception 'Not enough stock (only % left)', v_new - p_delta; end if;

  -- Stock in with a batch / expiry: add to that batch (created if new).
  if p_delta > 0 and p_batch_id is not null then
    update public.product_batches set quantity = quantity + p_delta, updated_at = now()
     where id = p_batch_id and product_id = p_product_id;
    if not found then raise exception 'Batch not found'; end if;
  elsif p_delta > 0 and (p_expiry_date is not null or nullif(trim(coalesce(p_batch_number, '')), '') is not null) then
    insert into public.product_batches (product_id, batch_number, expiry_date, quantity)
    values (p_product_id, trim(coalesce(p_batch_number, '')), p_expiry_date, p_delta)
    on conflict (product_id, batch_number, expiry_date)
      do update set quantity = public.product_batches.quantity + excluded.quantity, updated_at = now();
  end if;

  if p_delta <> 0 then
    select sku, barcode, unit_cost, selling_price into v_sku, v_barcode, v_cost, v_price
      from public.products where id = p_product_id;
    insert into public.transactions
      (product_id, sku, barcode, type, quantity, stock_delta, user_id, notes,
       unit_cost, selling_price, location_id, source)
    values
      (p_product_id, v_sku, coalesce(p_barcode, v_barcode), p_type, public.tx_quantity(p_type, p_delta), p_delta,
       auth.uid(), p_notes, coalesce(p_unit_cost, v_cost), coalesce(p_selling_price, v_price), p_location_id, 'ims');
  end if;
  return v_new;
end $$;

grant execute on function public.ims_move_stock(uuid, uuid, integer, text, text, numeric, numeric, text, text, date, uuid) to authenticated;

-- ── Merge a duplicate product into another ──
-- Moves stock + batches onto p_keep, re-points movement history / PO lines, fills blank
-- details on p_keep from the duplicate, logs a snapshot in audit_log, deletes the duplicate.
create or replace function public.merge_products(p_keep uuid, p_merge uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor public.users%rowtype;
  v_keep public.products%rowtype;
  v_dup public.products%rowtype;
  b record;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('administrator','inventory_manager','staff') then
    raise exception 'Not permitted to merge products';
  end if;
  if p_keep = p_merge then raise exception 'Choose two different products'; end if;
  select * into v_keep from public.products where id = p_keep for update;
  select * into v_dup from public.products where id = p_merge for update;
  if v_keep.id is null or v_dup.id is null then raise exception 'Product not found'; end if;
  if v_keep.shopify_inventory_item_id is not null or v_dup.shopify_inventory_item_id is not null
     or exists (select 1 from public.product_stock where product_id in (p_keep, p_merge)) then
    raise exception 'Shopify-synced products can''t be merged here — adjust their stock per location instead';
  end if;

  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (v_actor.id, v_actor.name, v_actor.email, 'merge', 'product', v_dup.id,
          v_dup.name || ' (' || v_dup.sku || ') → ' || v_keep.sku,
          to_jsonb(v_dup) || jsonb_build_object('merged_into', p_keep,
            'batches', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.product_batches x where x.product_id = p_merge)));

  -- Stock first (an increase — no FEFO), then the batches it now has room for.
  update public.products set stock_quantity = coalesce(stock_quantity, 0) + greatest(coalesce(v_dup.stock_quantity, 0), 0)
   where id = p_keep;
  for b in select * from public.product_batches where product_id = p_merge loop
    insert into public.product_batches (product_id, batch_number, expiry_date, quantity, created_at)
    values (p_keep, b.batch_number, b.expiry_date, b.quantity, b.created_at)
    on conflict (product_id, batch_number, expiry_date)
      do update set quantity = public.product_batches.quantity + excluded.quantity, updated_at = now();
  end loop;

  update public.transactions         set product_id = p_keep where product_id = p_merge;
  update public.purchase_order_items set product_id = p_keep where product_id = p_merge;
  delete from public.alerts where product_id = p_merge;
  delete from public.products where id = p_merge;

  update public.products set
    barcode     = coalesce(nullif(barcode, ''), nullif(v_dup.barcode, '')),
    brand       = coalesce(nullif(brand, ''), v_dup.brand),
    description = coalesce(nullif(description, ''), v_dup.description),
    image_url   = coalesce(nullif(image_url, ''), v_dup.image_url),
    supplier_id = coalesce(supplier_id, v_dup.supplier_id),
    unit_cost   = case when coalesce(unit_cost, 0) = 0 then v_dup.unit_cost else unit_cost end,
    selling_price = case when coalesce(selling_price, 0) = 0 then v_dup.selling_price else selling_price end
   where id = p_keep;
end $$;

revoke execute on function public.merge_products(uuid, uuid) from public, anon;
grant execute on function public.merge_products(uuid, uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.product_batches;
exception when duplicate_object then null; end $$;

-- ════════════ from 2026-10-08_merge-keeps-expiry.sql ════════════
-- 2026-10-08 (later) — Merge no longer loses expiry dates. Run once in the Supabase SQL editor,
-- AFTER 2026-10-08_product-batches.sql. Safe to re-run.
--
-- Bug: merge_products only moved product_batches rows. A product whose expiry date sat on the
-- product row itself (no batch row — e.g. stock received without a batch, or an expiry set
-- while it had 0 stock) lost that date when merged.
--
-- 1. Helper: turn a product's row-level expiry/batch into a real batch for its unbatched units.
-- 2. merge_products calls it on both products before moving batches.
-- 3. Repair: restore the expiry of products already merged, from the audit-log snapshot.
-- 4. Backfill: any other product still holding an expiry only on its row gets a batch.

create or replace function public.materialize_row_batch(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.products%rowtype; v_room integer;
begin
  select * into v_p from public.products where id = p_id;
  if v_p.id is null
     or (v_p.expiry_date is null and nullif(trim(coalesce(v_p.batch_number, '')), '') is null) then
    return;
  end if;
  select coalesce(v_p.stock_quantity, 0) - coalesce(sum(quantity), 0) into v_room
    from public.product_batches where product_id = p_id;
  if v_room <= 0 then return; end if;
  -- Only when this exact batch isn't already recorded (then the row is just the summary of it).
  if exists (select 1 from public.product_batches where product_id = p_id
              and batch_number = trim(coalesce(v_p.batch_number, ''))
              and expiry_date is not distinct from v_p.expiry_date) then
    return;
  end if;
  insert into public.product_batches (product_id, batch_number, expiry_date, quantity)
  values (p_id, trim(coalesce(v_p.batch_number, '')), v_p.expiry_date, v_room);
end $$;

revoke execute on function public.materialize_row_batch(uuid) from public, anon, authenticated;

create or replace function public.merge_products(p_keep uuid, p_merge uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor public.users%rowtype;
  v_keep public.products%rowtype;
  v_dup public.products%rowtype;
  b record;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('administrator','inventory_manager','staff') then
    raise exception 'Not permitted to merge products';
  end if;
  if p_keep = p_merge then raise exception 'Choose two different products'; end if;
  select * into v_keep from public.products where id = p_keep for update;
  select * into v_dup from public.products where id = p_merge for update;
  if v_keep.id is null or v_dup.id is null then raise exception 'Product not found'; end if;
  if v_keep.shopify_inventory_item_id is not null or v_dup.shopify_inventory_item_id is not null
     or exists (select 1 from public.product_stock where product_id in (p_keep, p_merge)) then
    raise exception 'Shopify-synced products can''t be merged here — adjust their stock per location instead';
  end if;

  -- Expiry held only on the product row → a real batch first, so it travels with the stock.
  perform public.materialize_row_batch(p_keep);
  perform public.materialize_row_batch(p_merge);

  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (v_actor.id, v_actor.name, v_actor.email, 'merge', 'product', v_dup.id,
          v_dup.name || ' (' || v_dup.sku || ') → ' || v_keep.sku,
          to_jsonb(v_dup) || jsonb_build_object('merged_into', p_keep,
            'batches', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.product_batches x where x.product_id = p_merge)));

  update public.products set stock_quantity = coalesce(stock_quantity, 0) + greatest(coalesce(v_dup.stock_quantity, 0), 0)
   where id = p_keep;
  for b in select * from public.product_batches where product_id = p_merge loop
    insert into public.product_batches (product_id, batch_number, expiry_date, quantity, created_at)
    values (p_keep, b.batch_number, b.expiry_date, b.quantity, b.created_at)
    on conflict (product_id, batch_number, expiry_date)
      do update set quantity = public.product_batches.quantity + excluded.quantity, updated_at = now();
  end loop;

  update public.transactions         set product_id = p_keep where product_id = p_merge;
  update public.purchase_order_items set product_id = p_keep where product_id = p_merge;
  delete from public.alerts where product_id = p_merge;
  delete from public.products where id = p_merge;

  update public.products set
    barcode     = coalesce(nullif(barcode, ''), nullif(v_dup.barcode, '')),
    brand       = coalesce(nullif(brand, ''), v_dup.brand),
    description = coalesce(nullif(description, ''), v_dup.description),
    image_url   = coalesce(nullif(image_url, ''), v_dup.image_url),
    supplier_id = coalesce(supplier_id, v_dup.supplier_id),
    unit_cost   = case when coalesce(unit_cost, 0) = 0 then v_dup.unit_cost else unit_cost end,
    selling_price = case when coalesce(selling_price, 0) = 0 then v_dup.selling_price else selling_price end
   where id = p_keep;
end $$;

revoke execute on function public.merge_products(uuid, uuid) from public, anon;
grant execute on function public.merge_products(uuid, uuid) to authenticated;

-- ── Repair past merges: the merged-away product's row-level expiry, from its audit snapshot ──
do $$
declare a record; v_keep uuid; v_exp date; v_bn text; v_qty integer; v_room integer; v_kexp date; v_kbn text;
begin
  for a in select snapshot from public.audit_log
            where action = 'merge' and entity_type = 'product'
              and coalesce(jsonb_array_length(snapshot->'batches'), 0) = 0
              and (nullif(snapshot->>'expiry_date', '') is not null
                   or nullif(trim(coalesce(snapshot->>'batch_number', '')), '') is not null)
            order by created_at loop
    v_keep := (a.snapshot->>'merged_into')::uuid;
    v_exp  := nullif(a.snapshot->>'expiry_date', '')::date;
    v_bn   := trim(coalesce(a.snapshot->>'batch_number', ''));
    v_qty  := greatest(coalesce((a.snapshot->>'stock_quantity')::integer, 0), 0);
    continue when v_qty = 0 or not exists (select 1 from public.products where id = v_keep);
    continue when exists (select 1 from public.product_batches where product_id = v_keep
                           and batch_number = v_bn and expiry_date is not distinct from v_exp);
    select coalesce(p.stock_quantity, 0) - coalesce((select sum(quantity) from public.product_batches where product_id = v_keep), 0)
      into v_room from public.products p where p.id = v_keep;
    v_qty := least(v_qty, v_room);
    continue when v_qty <= 0;
    -- The kept product's own row-level expiry covers its other unbatched units — record it as a
    -- batch first, or inserting the restored batch would overwrite it (row = earliest batch).
    select expiry_date, trim(coalesce(batch_number, '')) into v_kexp, v_kbn from public.products where id = v_keep;
    if v_room - v_qty > 0 and (v_kexp is not null or v_kbn <> '')
       and not exists (select 1 from public.product_batches where product_id = v_keep
                        and batch_number = v_kbn and expiry_date is not distinct from v_kexp) then
      insert into public.product_batches (product_id, batch_number, expiry_date, quantity)
      values (v_keep, v_kbn, v_kexp, v_room - v_qty);
    end if;
    insert into public.product_batches (product_id, batch_number, expiry_date, quantity)
    values (v_keep, v_bn, v_exp, v_qty)
    on conflict (product_id, batch_number, expiry_date)
      do update set quantity = public.product_batches.quantity + excluded.quantity, updated_at = now();
  end loop;
end $$;

-- ── Every other product with an expiry only on its row (and stock) gets a real batch ──
do $$
declare r record;
begin
  for r in select id from public.products p
            where coalesce(p.stock_quantity, 0) > 0
              and (p.expiry_date is not null or nullif(trim(coalesce(p.batch_number, '')), '') is not null)
              and not exists (select 1 from public.product_stock s where s.product_id = p.id) loop
    perform public.materialize_row_batch(r.id);
  end loop;
end $$;

-- Check: the merged product(s) and their batches.
select p.name, p.sku, p.stock_quantity, b.batch_number, b.expiry_date, b.quantity
  from public.products p left join public.product_batches b on b.product_id = p.id
 where p.id in (select (snapshot->>'merged_into')::uuid from public.audit_log where action = 'merge')
 order by p.name, b.expiry_date nulls last;

-- ════════════ from 2026-10-08_expired-stock-stays.sql (minus IDT9000T repair) ════════════
-- 2026-10-08 (later) — Expired stock is never sent out as samples or sold. Run once in the
-- Supabase SQL editor, AFTER 2026-10-08_merge-keeps-expiry.sql. Safe to re-run.
--
-- Bug: every stock decrease took the earliest-expiring batch first — so an expired batch was
-- the FIRST thing a "Mark as sample" / sale used up. Carol received 4 expired IDT9000T units
-- (expiry Aug 2021) twice and marked 4 as samples each time; both times the expired units
-- were the ones removed, so they vanished instead of showing as expired.
--
-- 1. FEFO now skips expired batches: unexpired stock is used first (earliest expiry first);
--    expired batches are only touched by a write-off of that batch or when nothing else is left.
-- 2. ims_move_stock refuses a sample / sale larger than the unexpired stock.
-- 3. Repair IDT9000T: the samples come out of the good batches, the expired units come back.

create or replace function public.consume_batches_fefo(p_product_id uuid, p_qty integer)
returns void language plpgsql security definer set search_path = public as $$
declare b record; v_left integer := p_qty;
begin
  for b in select id, quantity from public.product_batches
            where product_id = p_product_id
            order by (expiry_date is not null and expiry_date < current_date), -- expired last
                     expiry_date asc nulls last, created_at, id
            for update loop
    exit when v_left <= 0;
    if b.quantity <= v_left then
      delete from public.product_batches where id = b.id;
      v_left := v_left - b.quantity;
    else
      update public.product_batches set quantity = quantity - v_left, updated_at = now() where id = b.id;
      v_left := 0;
    end if;
  end loop;
end $$;

-- ── ims_move_stock: same as 2026-10-08_product-batches.sql + the unexpired-stock check ──
create or replace function public.ims_move_stock(
  p_product_id uuid,
  p_location_id uuid,
  p_delta integer,
  p_type text,
  p_notes text default null,
  p_unit_cost numeric default null,
  p_selling_price numeric default null,
  p_barcode text default null,
  p_batch_number text default null,
  p_expiry_date date default null,
  p_batch_id uuid default null
) returns integer
language plpgsql security invoker set search_path = public as $$
declare v_new integer; v_sku text; v_barcode text; v_cost numeric; v_price numeric; v_left integer;
        v_expired integer; v_stock integer;
begin
  -- Samples and sales never go out expired.
  if p_delta < 0 and p_type in ('sample', 'outbound') and p_location_id is null then
    if p_batch_id is not null then
      if exists (select 1 from public.product_batches where id = p_batch_id
                  and expiry_date is not null and expiry_date < current_date) then
        raise exception 'That batch has expired — it can''t be sent out as a sample or sold';
      end if;
    else
      select coalesce(stock_quantity, 0) into v_stock from public.products where id = p_product_id;
      select coalesce(sum(quantity), 0) into v_expired from public.product_batches
       where product_id = p_product_id and expiry_date is not null and expiry_date < current_date;
      if v_expired > 0 and -p_delta > v_stock - v_expired then
        raise exception 'Only % unexpired unit(s) — the other % unit(s) have expired and can''t be sent out as samples or sold',
          greatest(v_stock - v_expired, 0), v_expired;
      end if;
    end if;
  end if;

  if p_delta < 0 and p_batch_id is not null then
    select quantity + p_delta into v_left from public.product_batches
     where id = p_batch_id and product_id = p_product_id for update;
    if v_left is null then raise exception 'Batch not found'; end if;
    if v_left < 0 then raise exception 'Only % unit(s) left in that batch', v_left - p_delta; end if;
    if v_left = 0 then delete from public.product_batches where id = p_batch_id;
    else update public.product_batches set quantity = v_left, updated_at = now() where id = p_batch_id; end if;
    perform set_config('ims.skip_fefo', 'on', true);
  end if;

  if p_location_id is null then
    update public.products set stock_quantity = coalesce(stock_quantity, 0) + p_delta
     where id = p_product_id returning stock_quantity into v_new;
  else
    insert into public.product_stock (product_id, location_id, quantity)
    values (p_product_id, p_location_id, p_delta)
    on conflict (product_id, location_id)
      do update set quantity = public.product_stock.quantity + excluded.quantity, updated_at = now()
    returning quantity into v_new;
  end if;
  perform set_config('ims.skip_fefo', '', true);
  if v_new is null then raise exception 'Product not found or not permitted'; end if;
  if v_new < 0 then raise exception 'Not enough stock (only % left)', v_new - p_delta; end if;

  if p_delta > 0 and p_batch_id is not null then
    update public.product_batches set quantity = quantity + p_delta, updated_at = now()
     where id = p_batch_id and product_id = p_product_id;
    if not found then raise exception 'Batch not found'; end if;
  elsif p_delta > 0 and (p_expiry_date is not null or nullif(trim(coalesce(p_batch_number, '')), '') is not null) then
    insert into public.product_batches (product_id, batch_number, expiry_date, quantity)
    values (p_product_id, trim(coalesce(p_batch_number, '')), p_expiry_date, p_delta)
    on conflict (product_id, batch_number, expiry_date)
      do update set quantity = public.product_batches.quantity + excluded.quantity, updated_at = now();
  end if;

  if p_delta <> 0 then
    select sku, barcode, unit_cost, selling_price into v_sku, v_barcode, v_cost, v_price
      from public.products where id = p_product_id;
    insert into public.transactions
      (product_id, sku, barcode, type, quantity, stock_delta, user_id, notes,
       unit_cost, selling_price, location_id, source)
    values
      (p_product_id, v_sku, coalesce(p_barcode, v_barcode), p_type, public.tx_quantity(p_type, p_delta), p_delta,
       auth.uid(), p_notes, coalesce(p_unit_cost, v_cost), coalesce(p_selling_price, v_price), p_location_id, 'ims');
  end if;
  return v_new;
end $$;

grant execute on function public.ims_move_stock(uuid, uuid, integer, text, text, numeric, numeric, text, text, date, uuid) to authenticated;


-- ════════════ from 2026-10-08_product-currency.sql ════════════
-- Per-product currency. NULL = priced in the home currency (Settings → Currency).
alter table public.products add column if not exists currency text
  check (currency is null or currency ~ '^[A-Z]{3}$');
