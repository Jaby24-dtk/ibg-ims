-- I-BG IMS ← Germonizer IMS parity, part 2 (Germonizer work from 16 Oct – 3 Nov 2026).
-- Run ONCE in the Supabase SQL editor for the I-BG IMS project (ogtmoyievbbyefvqcfqx),
-- AFTER 2026-10-08_ibg-germonizer-parity.sql. The whole script runs as one transaction:
-- if anything fails, nothing is changed.
--
-- Contents, in order (each section is the Germonizer migration of the same name, with
-- I-BG naming; the Shopee-sync migration is deliberately left out):
--   1. 2026-10-16_expired-samples          — edit batch qty, send expired batches out as samples
--   2. 2026-10-22_supplier-brand-sku       — supplier brand + supplier SKU/model on products
--   3. 2026-10-22_iso-locations-contacts   — storage bins (country-rack-level-slot), suppliers/customers
--   4. 2026-10-22_iso-forms                — digital PO / quotation forms + approvals + notifications
--   5. 2026-10-23_cycle-counts             — scheduled blind stock counts, variance review, recounts
--   6. 2026-10-23_traceability             — batch movement ledger, traceability, recalls
--   7. 2026-10-23_audit-pack               — audit & compliance pack
--   8. 2026-10-23_approval-matrix          — admins choose who approves what
--   9. 2026-10-23_recall-sop               — complaints, holds/NC, dispositions, recalls, mock recalls, CAPA

begin;

do $$ begin
  if to_regclass('public.product_batches') is null or to_regclass('public.stock_locations') is null then
    raise exception 'Run 2026-10-08_ibg-germonizer-parity.sql first (product_batches / stock_locations are missing).';
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 2026-10-16_expired-samples
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-16 — Expired batches can be sent out as samples, when picked on purpose.
-- Run once in the Supabase SQL editor, AFTER 2026-10-08_expired-stock-stays.sql. Safe to re-run.
--
-- Same ims_move_stock as 2026-10-08_expired-stock-stays.sql with one change: a 'sample' move
-- that names a specific batch (p_batch_id) is allowed even if that batch has expired.
-- Unchanged: plain "Mark as Sample" / sales (no batch named) still never take expired units,
-- and nothing is ever SOLD from an expired batch.

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
  -- Sales never go out expired; samples only from an expired batch picked on purpose.
  if p_delta < 0 and p_type in ('sample', 'outbound') and p_location_id is null then
    if p_batch_id is not null then
      -- A sample may be given from an expired batch when that batch is picked on purpose
      -- (Batches & expiry → gift icon). Sales from an expired batch are still refused.
      if p_type = 'outbound' and exists (select 1 from public.product_batches where id = p_batch_id
                  and expiry_date is not null and expiry_date < current_date) then
        raise exception 'That batch has expired — it can''t be sold';
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 2026-10-22_supplier-brand-sku
-- ═══════════════════════════════════════════════════════════════════════════

-- Supplier's own brand + SKU/model for each product, next to I-BG's
-- brand (products.brand) and SKU (products.sku). Mirrors the team's
-- stock-out sheet: Supplier Brand · Supplier SKU/Model · I-BG Brand · I-BG SKU.
alter table public.products add column if not exists supplier_brand text;
alter table public.products add column if not exists supplier_sku text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 2026-10-22_iso-locations-contacts
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-22 — ISO phase 1: storage locations (warehouse / rack / shelf / bin) and the
-- supplier / vendor / customer master lists.
-- Run once in the Supabase SQL editor, AFTER 2026-10-08_product-batches.sql. Safe to re-run.
--
--   * storage_bins        — every physical place stock can sit, e.g. "WH1-A-R01-S02".
--                           Optionally tied to a site (stock_locations: Singapore, Australia…).
--   * products.bin_id     — the product's default / pick-face location.
--   * product_batches.bin_id — where that batch physically is. New batches start in the
--                           product's default location (trigger below), so receiving keeps
--                           working unchanged.
--   * suppliers           — gains kind (supplier | vendor), registration no., terms,
--                           currency, approved-supplier status + evaluation date (ISO 9001 8.4 /
--                           ISO 13485 7.4), notes.
--   * customers           — new master list.
--   * audit_row_change    — every insert / update / delete on these tables is written to
--                           audit_log with who did it and the before/after row.

-- ── Storage locations ──────────────────────────────────────────────────────────
create table if not exists public.storage_bins (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  site_id uuid references public.stock_locations(id) on delete set null,
  warehouse text not null default '',
  zone text not null default '',
  rack text not null default '',
  shelf text not null default '',
  bin text not null default '',
  notes text,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.products add column if not exists bin_id uuid references public.storage_bins(id) on delete set null;
alter table public.product_batches add column if not exists bin_id uuid references public.storage_bins(id) on delete set null;
create index if not exists products_bin_idx on public.products (bin_id);
create index if not exists product_batches_bin_idx on public.product_batches (bin_id);

create or replace function public.batch_default_bin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bin_id is null then
    select bin_id into new.bin_id from public.products where id = new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists product_batches_default_bin on public.product_batches;
create trigger product_batches_default_bin before insert on public.product_batches
  for each row execute function public.batch_default_bin();

-- ── Suppliers / vendors ────────────────────────────────────────────────────────
alter table public.suppliers add column if not exists kind text not null default 'supplier';
alter table public.suppliers add column if not exists registration_no text;
alter table public.suppliers add column if not exists website text;
alter table public.suppliers add column if not exists payment_terms text;
alter table public.suppliers add column if not exists currency text;
alter table public.suppliers add column if not exists approval_status text not null default 'approved';
alter table public.suppliers add column if not exists evaluated_on date;
alter table public.suppliers add column if not exists notes text;
alter table public.suppliers add column if not exists updated_at timestamptz default now();
do $$ begin
  alter table public.suppliers add constraint suppliers_kind_check check (kind in ('supplier','vendor'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.suppliers add constraint suppliers_approval_check
    check (approval_status in ('approved','conditional','pending','disqualified'));
exception when duplicate_object then null; end $$;

-- ── Customers ──────────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  contact_person text,
  email text,
  phone text,
  billing_address text,
  shipping_address text,
  country text,
  registration_no text,
  payment_terms text,
  currency text,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists customers_name_key on public.customers (lower(name));

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.storage_bins enable row level security;
alter table public.customers enable row level security;

drop policy if exists "Authenticated read" on public.storage_bins;
create policy "Authenticated read" on public.storage_bins for select using (auth.role() = 'authenticated');
drop policy if exists "Manager can write bins" on public.storage_bins;
create policy "Manager can write bins" on public.storage_bins for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager'))
);

drop policy if exists "Authenticated read" on public.customers;
create policy "Authenticated read" on public.customers for select using (auth.role() = 'authenticated');
-- Sales staff keep the customer list up to date.
drop policy if exists "Staff can write customers" on public.customers;
create policy "Staff can write customers" on public.customers for all using (
  exists (select 1 from public.users where id = auth.uid() and role in ('administrator','inventory_manager','staff'))
);

-- ── Change history (ISO record control) ────────────────────────────────────────
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor public.users%rowtype; v_row jsonb; v_label text;
begin
  select * into v_actor from public.users where id = auth.uid();
  v_row := to_jsonb(coalesce(new, old));
  v_label := coalesce(v_row->>'name', v_row->>'code', v_row->>'id');
  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (
    v_actor.id, v_actor.name, v_actor.email, lower(tg_op), tg_argv[0], (v_row->>'id')::uuid, v_label,
    case tg_op when 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
               else v_row end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists audit_storage_bins on public.storage_bins;
create trigger audit_storage_bins after insert or update or delete on public.storage_bins
  for each row execute function public.audit_row_change('storage_bin');
drop trigger if exists audit_customers on public.customers;
create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function public.audit_row_change('customer');
drop trigger if exists audit_suppliers on public.suppliers;
create trigger audit_suppliers after insert or update on public.suppliers
  for each row execute function public.audit_row_change('supplier');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 2026-10-22_iso-forms
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-22 — ISO phase 2: digital forms (Purchase Order, Quotation, Invoice) with
-- approval workflow, person-in-charge, remarks, e-sign-off trail, notifications, archive.
-- Run once in the Supabase SQL editor, AFTER 2026-10-22_iso-locations-contacts.sql. Safe to re-run.
--
--   documents          — one row per form. doc_type purchase_order | quotation | invoice.
--   document_lines     — its line items. Locked once the form leaves Draft / Rejected, except
--                        the receiving / shipping fields (received_qty, batch, expiry, bin).
--   document_remarks   — comment thread. Anyone with access adds; approvers (Administrator /
--                        Inventory Manager) can edit anyone's remark — the first original text
--                        and who edited it are kept.
--   document_events    — the signed trail: who created / submitted / approved / issued / … and when.
--                        Replaces the printed chop + signature.
--   notifications      — in-app inbox per user; emailed by /api/notifications/send.
--   company_profile    — our letterhead, bill-to / ship-to defaults and GST rate.
--
--   document_action()  — the only way to move a form between statuses. Enforces the state
--                        machine, who may do what (preparer can't approve their own form),
--                        snapshots the supplier/customer at submission, logs the event,
--                        notifies the right people, and archives finished forms (read-only).

-- ── Company profile (single row) ───────────────────────────────────────────────
create table if not exists public.company_profile (
  id integer primary key default 1 check (id = 1),
  name text not null default 'I-BG Consultancy & Trading (S) Pte Ltd',
  address text,
  registration_no text,
  gst_no text,
  phone text,
  email text,
  default_bill_to text,
  default_ship_to text,
  gst_rate numeric(5,2) not null default 9,
  updated_at timestamptz default now()
);
insert into public.company_profile (id) values (1) on conflict (id) do nothing;

-- ── Documents ──────────────────────────────────────────────────────────────────
create table if not exists public.documents (
  id uuid primary key default uuid_generate_v4(),
  doc_type text not null check (doc_type in ('purchase_order','quotation','invoice')),
  doc_number text unique,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','rejected','issued','completed','cancelled')),
  -- How a completed form ended: PO received, quotation accepted/declined/expired, invoice paid.
  outcome text,
  currency text not null default 'SGD',
  supplier_id uuid references public.suppliers(id) on delete set null,   -- PO vendor
  customer_id uuid references public.customers(id) on delete set null,   -- quotation / invoice
  -- Frozen copy of the supplier / customer at submission, so later edits to the master list
  -- never change an issued record.
  party jsonb,
  bill_to text,
  ship_to text,
  issue_date date not null default current_date,
  due_date date,          -- PO: delivery by · quotation: valid until · invoice: payment due
  payment_terms text,
  reference text,         -- supplier quote no., customer PO no., …
  source_document_id uuid references public.documents(id) on delete set null,
  discount numeric(14,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  prepared_by uuid references public.users(id),
  assigned_to uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_type_status_idx on public.documents (doc_type, status);
create index if not exists documents_assigned_idx on public.documents (assigned_to);

create table if not exists public.document_lines (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents(id) on delete cascade,
  line_no integer not null default 1,
  product_id uuid references public.products(id) on delete set null,
  sku text,
  description text not null default '',
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit text not null default 'pcs',
  unit_price numeric(14,4) not null default 0,
  amount numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  -- Receiving (PO) / shipping (invoice): filled after approval.
  received_qty numeric(14,3) not null default 0,
  batch_number text,
  expiry_date date,
  bin_id uuid references public.storage_bins(id) on delete set null
);
create index if not exists document_lines_doc_idx on public.document_lines (document_id, line_no);

create table if not exists public.document_remarks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents(id) on delete cascade,
  author_id uuid references public.users(id),
  author_name text,
  body text not null check (length(trim(body)) > 0),
  original_body text,
  edited_by uuid references public.users(id),
  edited_by_name text,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists document_remarks_doc_idx on public.document_remarks (document_id, created_at);

create table if not exists public.document_events (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents(id) on delete cascade,
  actor_id uuid references public.users(id),
  actor_name text,
  actor_role text,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists document_events_doc_idx on public.document_events (document_id, created_at);

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unsent_idx on public.notifications (created_at) where emailed_at is null;

-- ── Helpers ────────────────────────────────────────────────────────────────────
create or replace function public.ims_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;
create or replace function public.ims_is_approver() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ims_role() in ('administrator','inventory_manager'), false)
$$;

-- True inside document_action() / the one-time import below: the locks step aside.
create or replace function public.ims_doc_bypass() returns boolean language sql stable as $$
  select coalesce(current_setting('ims.doc_action', true), '') = 'on'
$$;

create or replace function public.doc_label(t text) returns text language sql immutable as $$
  select case t when 'purchase_order' then 'Purchase Order' when 'quotation' then 'Quotation' else 'Invoice' end
$$;

-- Numbering: PO-2026-0001, QT-2026-0001, INV-2026-0001 (per type, per year).
create table if not exists public.doc_counters (
  doc_type text not null,
  year integer not null,
  last integer not null default 0,
  primary key (doc_type, year)
);

create or replace function public.documents_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_year integer := extract(year from coalesce(new.issue_date, current_date)); v_n integer;
begin
  if new.doc_number is null or new.doc_number = '' then
    insert into public.doc_counters (doc_type, year, last) values (new.doc_type, v_year, 1)
      on conflict (doc_type, year) do update set last = doc_counters.last + 1
      returning last into v_n;
    new.doc_number := (case new.doc_type when 'purchase_order' then 'PO' when 'quotation' then 'QT' else 'INV' end)
      || '-' || v_year || '-' || lpad(v_n::text, 4, '0');
  end if;
  new.prepared_by := coalesce(new.prepared_by, auth.uid());
  return new;
end $$;
drop trigger if exists documents_before_insert on public.documents;
create trigger documents_before_insert before insert on public.documents
  for each row execute function public.documents_before_insert();

-- Totals always come from the lines (never typed), so the PDF, list and approval agree.
create or replace function public.document_recalc(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_sub numeric; d record;
begin
  select coalesce(sum(amount), 0) into v_sub from public.document_lines where document_id = p_doc;
  select discount, tax_rate into d from public.documents where id = p_doc;
  perform set_config('ims.recalc', 'on', true);
  update public.documents set
    subtotal = v_sub,
    tax_amount = round(greatest(v_sub - coalesce(d.discount, 0), 0) * coalesce(d.tax_rate, 0) / 100, 2),
    total = greatest(v_sub - coalesce(d.discount, 0), 0)
            + round(greatest(v_sub - coalesce(d.discount, 0), 0) * coalesce(d.tax_rate, 0) / 100, 2)
  where id = p_doc;
  perform set_config('ims.recalc', 'off', true);
end $$;

create or replace function public.notify_user(p_user uuid, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.notifications (user_id, title, body, link) values (p_user, p_title, p_body, p_link);
end $$;

create or replace function public.log_document_event(p_doc uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare u public.users%rowtype;
begin
  select * into u from public.users where id = auth.uid();
  insert into public.document_events (document_id, actor_id, actor_name, actor_role, action, note)
  values (p_doc, u.id, u.name, u.role, p_action, p_note);
end $$;

-- ── Locks ──────────────────────────────────────────────────────────────────────
-- Header: once submitted, the commercial content is frozen (send it back via Reject to change
-- it). Status / approval / archive fields only change through document_action().
create or replace function public.documents_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.ims_doc_bypass() or coalesce(current_setting('ims.recalc', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if old.archived_at is not null then
    raise exception '% is archived and can''t be changed', old.doc_number;
  end if;
  if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at or new.archived_at is distinct from old.archived_at
     or new.outcome is distinct from old.outcome or new.party is distinct from old.party
     or new.doc_number is distinct from old.doc_number or new.prepared_by is distinct from old.prepared_by then
    raise exception 'Use the form''s workflow buttons to change its status';
  end if;
  if old.status not in ('draft','rejected') and (
       new.doc_type, new.currency, new.supplier_id, new.customer_id, new.bill_to, new.ship_to, new.issue_date,
       new.due_date, new.payment_terms, new.reference, new.discount, new.tax_rate)
     is distinct from (
       old.doc_type, old.currency, old.supplier_id, old.customer_id, old.bill_to, old.ship_to, old.issue_date,
       old.due_date, old.payment_terms, old.reference, old.discount, old.tax_rate) then
    raise exception '% has been submitted — it can''t be edited. Ask an approver to reject it back to you.', old.doc_number;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists documents_guard on public.documents;
create trigger documents_guard before update on public.documents
  for each row execute function public.documents_guard();

create or replace function public.document_lines_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare d record; v_doc uuid := coalesce(new.document_id, old.document_id);
begin
  if public.ims_doc_bypass() then return coalesce(new, old); end if;
  select status, archived_at, doc_number into d from public.documents where id = v_doc;
  if d.archived_at is not null then raise exception '% is archived and can''t be changed', d.doc_number; end if;
  if d.status not in ('draft','rejected') then
    if tg_op <> 'UPDATE' or (new.product_id, new.sku, new.description, new.quantity, new.unit, new.unit_price, new.line_no)
         is distinct from (old.product_id, old.sku, old.description, old.quantity, old.unit, old.unit_price, old.line_no) then
      raise exception '% has been submitted — its lines can''t be changed', d.doc_number;
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists document_lines_guard on public.document_lines;
create trigger document_lines_guard before insert or update or delete on public.document_lines
  for each row execute function public.document_lines_guard();

create or replace function public.document_lines_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.document_recalc(coalesce(new.document_id, old.document_id));
  return null;
end $$;
drop trigger if exists document_lines_after on public.document_lines;
create trigger document_lines_after after insert or update or delete on public.document_lines
  for each row execute function public.document_lines_after();

create or replace function public.documents_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.discount, new.tax_rate) is distinct from (old.discount, old.tax_rate) then
    perform public.document_recalc(new.id);
  end if;
  -- New person in charge → tell them.
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    perform public.notify_user(new.assigned_to,
      'You''re in charge of ' || new.doc_number,
      public.doc_label(new.doc_type) || ' ' || new.doc_number || ' has been assigned to you.',
      '/forms/' || new.id);
    perform public.log_document_event(new.id, 'assigned',
      (select name from public.users where id = new.assigned_to));
  end if;
  return null;
end $$;
drop trigger if exists documents_after_update on public.documents;
create trigger documents_after_update after update on public.documents
  for each row execute function public.documents_after_update();

create or replace function public.documents_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_document_event(new.id, 'created', null);
  if new.assigned_to is not null then
    perform public.notify_user(new.assigned_to,
      'You''re in charge of ' || new.doc_number,
      public.doc_label(new.doc_type) || ' ' || new.doc_number || ' has been created and assigned to you.',
      '/forms/' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists documents_after_insert on public.documents;
create trigger documents_after_insert after insert on public.documents
  for each row execute function public.documents_after_insert();

-- Remarks: approvers may edit anyone's; the first original wording is kept.
create or replace function public.document_remarks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare d record; u public.users%rowtype;
begin
  if public.ims_doc_bypass() then return new; end if;
  select archived_at, doc_number into d from public.documents where id = coalesce(new.document_id, old.document_id);
  if d.archived_at is not null then raise exception '% is archived — remarks are closed', d.doc_number; end if;
  select * into u from public.users where id = auth.uid();
  if tg_op = 'INSERT' then
    new.author_id := u.id; new.author_name := u.name; new.created_at := now();
    new.original_body := null; new.edited_by := null; new.edited_by_name := null; new.edited_at := null;
  else
    if new.body is distinct from old.body then
      new.original_body := coalesce(old.original_body, old.body);
      new.edited_by := u.id; new.edited_by_name := u.name; new.edited_at := now();
    end if;
    new.author_id := old.author_id; new.author_name := old.author_name; new.created_at := old.created_at;
    new.document_id := old.document_id;
  end if;
  return new;
end $$;
drop trigger if exists document_remarks_guard on public.document_remarks;
create trigger document_remarks_guard before insert or update on public.document_remarks
  for each row execute function public.document_remarks_guard();

create or replace function public.document_remarks_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.documents where id = new.document_id;
  if tg_op = 'INSERT' then
    -- Tell the other people on the form.
    perform public.notify_user(d.prepared_by, 'New remark on ' || d.doc_number, left(new.author_name || ': ' || new.body, 300), '/forms/' || d.id);
    if d.assigned_to is distinct from d.prepared_by then
      perform public.notify_user(d.assigned_to, 'New remark on ' || d.doc_number, left(new.author_name || ': ' || new.body, 300), '/forms/' || d.id);
    end if;
  elsif new.body is distinct from old.body then
    perform public.log_document_event(d.id, 'remark_edited', 'Remark by ' || coalesce(old.author_name, '?') || ' edited');
    perform public.notify_user(old.author_id, 'Your remark on ' || d.doc_number || ' was edited',
      'Edited by ' || coalesce(new.edited_by_name, '?') || ': ' || left(new.body, 250), '/forms/' || d.id);
  end if;
  return null;
end $$;
drop trigger if exists document_remarks_after on public.document_remarks;
create trigger document_remarks_after after insert or update on public.document_remarks
  for each row execute function public.document_remarks_after();

-- ── Workflow ───────────────────────────────────────────────────────────────────
-- p_action: submit | approve | reject | issue | complete | cancel
-- p_outcome (complete): received | accepted | declined | expired | paid
create or replace function public.document_action(p_doc uuid, p_action text, p_note text default null, p_outcome text default null)
returns public.documents
language plpgsql security definer set search_path = public as $$
declare d public.documents%rowtype; v_role text := public.ims_role(); v_party jsonb; v_next text;
        v_label text; v_who text; a record;
begin
  select * into d from public.documents where id = p_doc for update;
  if d.id is null then raise exception 'Form not found'; end if;
  if d.archived_at is not null then raise exception '% is archived', d.doc_number; end if;
  if v_role is null or v_role = 'viewer' then raise exception 'Viewers can''t change forms'; end if;
  v_label := public.doc_label(d.doc_type) || ' ' || d.doc_number;
  select name into v_who from public.users where id = auth.uid();

  if p_action = 'submit' then
    if d.status not in ('draft','rejected') then raise exception 'Only a draft or rejected form can be submitted'; end if;
    if not exists (select 1 from public.document_lines where document_id = d.id) then raise exception 'Add at least one line first'; end if;
    if d.doc_type = 'purchase_order' and d.supplier_id is null then raise exception 'Choose the vendor first'; end if;
    if d.doc_type <> 'purchase_order' and d.customer_id is null then raise exception 'Choose the customer first'; end if;
    if d.doc_type = 'purchase_order' then
      select to_jsonb(s) - 'created_at' - 'updated_at' into v_party from public.suppliers s where id = d.supplier_id;
    else
      select to_jsonb(c) - 'created_at' - 'updated_at' into v_party from public.customers c where id = d.customer_id;
    end if;
    v_next := 'pending_approval';
  elsif p_action in ('approve','reject') then
    if not public.ims_is_approver() then raise exception 'Only an Administrator or Inventory Manager can %', p_action; end if;
    if d.status <> 'pending_approval' then raise exception 'This form isn''t waiting for approval'; end if;
    if p_action = 'approve' and d.prepared_by = auth.uid() then
      raise exception 'You prepared this form, so someone else has to approve it';
    end if;
    if p_action = 'reject' and coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for rejecting'; end if;
    v_next := case p_action when 'approve' then 'approved' else 'rejected' end;
  elsif p_action = 'issue' then
    if d.status <> 'approved' then raise exception 'Only an approved form can be issued'; end if;
    if not (public.ims_is_approver() or auth.uid() in (d.assigned_to, d.prepared_by)) then
      raise exception 'Only the person in charge, the preparer or an approver can issue it';
    end if;
    v_next := 'issued';
  elsif p_action = 'complete' then
    if d.status not in ('approved','issued') then raise exception 'Only an approved or issued form can be completed'; end if;
    if not (public.ims_is_approver() or auth.uid() in (d.assigned_to, d.prepared_by)) then
      raise exception 'Only the person in charge, the preparer or an approver can complete it';
    end if;
    if p_outcome is null or not (p_outcome = any (case d.doc_type
         when 'purchase_order' then array['received']
         when 'quotation' then array['accepted','declined','expired']
         else array['paid'] end)) then
      raise exception 'Unknown result "%" for a %', p_outcome, public.doc_label(d.doc_type);
    end if;
    v_next := 'completed';
  elsif p_action = 'cancel' then
    if d.status in ('completed','cancelled') then raise exception 'Already closed'; end if;
    if not (public.ims_is_approver() or (d.status in ('draft','rejected') and d.prepared_by = auth.uid())) then
      raise exception 'Only an approver can cancel a submitted form';
    end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for cancelling'; end if;
    v_next := 'cancelled';
  else
    raise exception 'Unknown action %', p_action;
  end if;

  perform set_config('ims.doc_action', 'on', true);
  update public.documents set
    status = v_next,
    party = coalesce(v_party, party),
    approved_by = case when p_action = 'approve' then auth.uid() when p_action in ('submit','reject') then null else approved_by end,
    approved_at = case when p_action = 'approve' then now() when p_action in ('submit','reject') then null else approved_at end,
    outcome = case when p_action = 'complete' then p_outcome else outcome end,
    archived_at = case when v_next in ('completed','cancelled') then now() else null end
  where id = d.id
  returning * into d;
  perform set_config('ims.doc_action', 'off', true);

  perform public.log_document_event(d.id, coalesce(p_outcome, p_action), nullif(trim(p_note), ''));
  if v_next in ('completed','cancelled') then perform public.log_document_event(d.id, 'archived', null); end if;

  -- Who to tell.
  if p_action = 'submit' then
    for a in select id from public.users where role in ('administrator','inventory_manager') and id <> d.prepared_by loop
      perform public.notify_user(a.id, 'Approval needed: ' || d.doc_number, v_label || ' was submitted by ' || coalesce(v_who, '?') || '.', '/forms/' || d.id);
    end loop;
    -- (An approver in charge already got "Approval needed" above.)
    if d.assigned_to is distinct from d.prepared_by
       and not exists (select 1 from public.users where id = d.assigned_to and role in ('administrator','inventory_manager')) then
      perform public.notify_user(d.assigned_to, d.doc_number || ' submitted for approval', v_label || ' is waiting for approval.', '/forms/' || d.id);
    end if;
  else
    perform public.notify_user(d.prepared_by, d.doc_number || ': ' || replace(v_next, '_', ' '),
      v_label || ' — ' || coalesce(p_outcome, p_action) || ' by ' || coalesce(v_who, '?') || coalesce('. ' || nullif(trim(p_note), ''), '.'),
      '/forms/' || d.id);
    if d.assigned_to is distinct from d.prepared_by then
      perform public.notify_user(d.assigned_to, d.doc_number || ': ' || replace(v_next, '_', ' '),
        v_label || ' — ' || coalesce(p_outcome, p_action) || ' by ' || coalesce(v_who, '?') ||
        case when p_action = 'approve' then '. You can now go ahead.' else coalesce('. ' || nullif(trim(p_note), ''), '.') end,
        '/forms/' || d.id);
    end if;
  end if;
  return d;
end $$;
grant execute on function public.document_action(uuid, text, text, text) to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.company_profile enable row level security;
alter table public.documents enable row level security;
alter table public.document_lines enable row level security;
alter table public.document_remarks enable row level security;
alter table public.document_events enable row level security;
alter table public.notifications enable row level security;
alter table public.doc_counters enable row level security;

drop policy if exists "Authenticated read" on public.company_profile;
create policy "Authenticated read" on public.company_profile for select using (auth.role() = 'authenticated');
drop policy if exists "Admin can write" on public.company_profile;
create policy "Admin can write" on public.company_profile for update using (public.ims_role() = 'administrator');

drop policy if exists "Authenticated read" on public.documents;
create policy "Authenticated read" on public.documents for select using (auth.role() = 'authenticated');
drop policy if exists "Staff can create" on public.documents;
create policy "Staff can create" on public.documents for insert
  with check (public.ims_role() in ('administrator','inventory_manager','staff'));
drop policy if exists "Staff can edit" on public.documents;
create policy "Staff can edit" on public.documents for update
  using (public.ims_role() in ('administrator','inventory_manager','staff'));
-- Only an unsubmitted draft can be deleted, by whoever prepared it. Everything else is cancelled
-- (and archived) so the record stays.
drop policy if exists "Preparer can delete draft" on public.documents;
create policy "Preparer can delete draft" on public.documents for delete
  using (status = 'draft' and prepared_by = auth.uid());

drop policy if exists "Authenticated read" on public.document_lines;
create policy "Authenticated read" on public.document_lines for select using (auth.role() = 'authenticated');
drop policy if exists "Staff can write" on public.document_lines;
create policy "Staff can write" on public.document_lines for all
  using (public.ims_role() in ('administrator','inventory_manager','staff'));

drop policy if exists "Authenticated read" on public.document_remarks;
create policy "Authenticated read" on public.document_remarks for select using (auth.role() = 'authenticated');
drop policy if exists "Staff can add" on public.document_remarks;
create policy "Staff can add" on public.document_remarks for insert
  with check (public.ims_role() in ('administrator','inventory_manager','staff'));
drop policy if exists "Approvers can edit" on public.document_remarks;
create policy "Approvers can edit" on public.document_remarks for update using (public.ims_is_approver());

drop policy if exists "Authenticated read" on public.document_events;
create policy "Authenticated read" on public.document_events for select using (auth.role() = 'authenticated');

drop policy if exists "Own notifications" on public.notifications;
create policy "Own notifications" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "Mark own read" on public.notifications;
create policy "Mark own read" on public.notifications for update using (user_id = auth.uid());

-- ── Bring the existing purchase orders across ─────────────────────────────────
select set_config('ims.doc_action', 'on', false);
insert into public.documents (id, doc_type, doc_number, status, outcome, currency, supplier_id, issue_date, reference,
                              archived_at, created_at, updated_at)
select po.id, 'purchase_order', po.order_number,
       case po.status when 'pending' then 'pending_approval' when 'received' then 'completed' else po.status end,
       case po.status when 'received' then 'received' end,
       'SGD', po.supplier_id, po.created_at::date, null,
       case when po.status in ('received','cancelled') then po.updated_at end,
       po.created_at, po.updated_at
  from public.purchase_orders po
 where not exists (select 1 from public.documents d where d.id = po.id);

insert into public.document_lines (document_id, line_no, product_id, sku, description, quantity, unit_price, received_qty)
select i.purchase_order_id,
       row_number() over (partition by i.purchase_order_id order by i.id),
       i.product_id, p.sku, coalesce(p.name, 'Item'), i.quantity, i.unit_cost,
       case when po.status = 'received' then i.quantity else 0 end
  from public.purchase_order_items i
  join public.purchase_orders po on po.id = i.purchase_order_id
  left join public.products p on p.id = i.product_id
 where i.quantity > 0
   and not exists (select 1 from public.document_lines l where l.document_id = i.purchase_order_id);

insert into public.document_remarks (document_id, author_name, body, created_at)
select po.id, 'Imported', po.notes, po.created_at
  from public.purchase_orders po
 where coalesce(trim(po.notes), '') <> ''
   and not exists (select 1 from public.document_remarks r where r.document_id = po.id);

select public.document_recalc(id) from public.documents where doc_type = 'purchase_order';
select set_config('ims.doc_action', 'off', false);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 2026-10-23_cycle-counts
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-23 — ISO phase 3: cycle counts (scheduled and ad-hoc stock counts).
-- Run once in the Supabase SQL editor, AFTER 2026-10-22_iso-forms.sql. Safe to re-run.
--
--   * count_schedules      — "count X every month / quarter / year / N days". Due counts are
--                            created by count_generate_due(), which the app calls on load.
--   * stock_counts         — one count sheet, CC-2026-0001. open → submitted → approved
--                            (stock adjusted) · or back to open for a recount · or cancelled.
--   * stock_count_lines    — one line per product (per site for products with per-site stock).
--                            The system quantity is snapshotted when each line is counted, so
--                            sales during the count don't create false variances.
--   * stock_count_events   — the signed trail (who did what, when, why).
-- Rules: counting is blind (counters never see the expected quantity until submitted); every
-- variance needs a reason; whoever counted a line can't approve the count; approving posts
-- one 'adjustment' movement per variance through ims_move_stock.

-- ── Tables ─────────────────────────────────────────────────────────────────────
create table if not exists public.count_schedules (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  frequency text not null default 'monthly'
    check (frequency in ('weekly','monthly','quarterly','annual','custom')),
  interval_days integer check (interval_days is null or interval_days between 1 and 3650),
  scope text not null default 'all' check (scope in ('all','category','brand','warehouse','site','products')),
  scope_value text,
  product_ids uuid[],
  next_due date not null default current_date,
  assigned_to uuid references public.users(id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_counts (
  id uuid primary key default uuid_generate_v4(),
  count_number text unique,
  schedule_id uuid references public.count_schedules(id) on delete set null,
  title text not null,
  scope text not null default 'all',
  scope_value text,
  status text not null default 'open' check (status in ('open','submitted','approved','cancelled')),
  due_date date,
  assigned_to uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) default auth.uid(),
  submitted_by uuid references public.users(id),
  submitted_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  recount_round integer not null default 0,
  overdue_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_counts_status_idx on public.stock_counts (status, due_date);

create table if not exists public.stock_count_lines (
  id uuid primary key default uuid_generate_v4(),
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  location_id uuid references public.stock_locations(id) on delete set null,
  -- Snapshot so the record survives product renames / deletes.
  sku text not null default '',
  name text not null default '',
  bin_code text not null default '',
  unit_cost numeric(14,2) not null default 0,
  currency text,                -- the product's price currency (null = home currency)
  sort_key integer not null default 0,
  counted_qty integer check (counted_qty is null or counted_qty >= 0),
  system_qty integer,
  counted_by uuid references public.users(id),
  counted_at timestamptz,
  first_count integer,          -- the count before a recount was asked for
  recount boolean not null default false,
  reason text,
  note text,
  posted_delta integer          -- what was actually adjusted on approval
);
alter table public.stock_count_lines add column if not exists currency text;
create index if not exists stock_count_lines_count_idx on public.stock_count_lines (count_id, sort_key);

create table if not exists public.stock_count_events (
  id uuid primary key default uuid_generate_v4(),
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  actor_id uuid references public.users(id),
  actor_name text,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists stock_count_events_idx on public.stock_count_events (count_id, created_at);

-- ── Helpers ────────────────────────────────────────────────────────────────────
create or replace function public.count_log(p_count uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.stock_count_events (count_id, actor_id, actor_name, action, note)
  values (p_count, auth.uid(), (select name from public.users where id = auth.uid()), p_action, nullif(trim(coalesce(p_note, '')), ''));
end $$;
revoke execute on function public.count_log(uuid, text, text) from public, anon, authenticated;

-- Current system quantity for a line: per-site stock, or the product total.
create or replace function public.count_system_qty(p_product uuid, p_location uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when p_location is null
    then (select coalesce(stock_quantity, 0) from public.products where id = p_product)
    else coalesce((select quantity from public.product_stock where product_id = p_product and location_id = p_location), 0)
  end
$$;

create or replace function public.count_next_due(p_from date, p_frequency text, p_days integer)
returns date language sql immutable as $$
  select case p_frequency
    when 'weekly' then p_from + 7
    when 'monthly' then (p_from + interval '1 month')::date
    when 'quarterly' then (p_from + interval '3 months')::date
    when 'annual' then (p_from + interval '1 year')::date
    else p_from + greatest(coalesce(p_days, 30), 1)
  end
$$;

-- ── Create a count (ad-hoc or from a schedule) ────────────────────────────────
-- count_build is internal (not callable from the browser): count_create (approvers) and
-- count_generate_due (schedules) both go through it.
create or replace function public.count_build(
  p_title text, p_scope text, p_scope_value text, p_product_ids uuid[],
  p_due date, p_assigned uuid, p_schedule uuid
) returns public.stock_counts
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts%rowtype; v_year integer := extract(year from current_date); v_n integer;
        v_lines integer; a record;
begin
  if p_scope not in ('all','category','brand','warehouse','site','products') then raise exception 'Unknown scope %', p_scope; end if;
  if p_scope in ('category','brand','warehouse','site') and coalesce(trim(p_scope_value), '') = '' then
    raise exception 'Choose which % to count', p_scope;
  end if;
  if p_scope = 'products' and coalesce(array_length(p_product_ids, 1), 0) = 0 then raise exception 'Choose at least one product'; end if;

  insert into public.doc_counters (doc_type, year, last) values ('stock_count', v_year, 1)
    on conflict (doc_type, year) do update set last = doc_counters.last + 1 returning last into v_n;

  insert into public.stock_counts (count_number, schedule_id, title, scope, scope_value, due_date, assigned_to, created_by)
  values ('CC-' || v_year || '-' || lpad(v_n::text, 4, '0'), p_schedule, coalesce(nullif(trim(p_title), ''), 'Stock count'),
          p_scope, nullif(trim(coalesce(p_scope_value, '')), ''), coalesce(p_due, current_date + 7), p_assigned, auth.uid())
  returning * into c;

  -- Products in scope. Products with per-site stock get one line per site they're stocked at
  -- (or just the chosen site); everything else gets one line.
  with scoped as (
    select p.*, b.code as bcode, b.warehouse as bwarehouse
      from public.products p left join public.storage_bins b on b.id = p.bin_id
     where case p_scope
       when 'all' then true
       when 'category' then p.category = p_scope_value
       when 'brand' then lower(coalesce(p.brand, '')) = lower(p_scope_value)
       when 'warehouse' then b.warehouse = p_scope_value
       when 'site' then exists (select 1 from public.product_stock ps where ps.product_id = p.id and ps.location_id::text = p_scope_value)
                        or b.site_id::text = p_scope_value
       when 'products' then p.id = any (p_product_ids)
     end
  ), expanded as (
    select s.id, s.sku, s.name, coalesce(s.bcode, '') as bcode, coalesce(s.unit_cost, 0) as unit_cost, s.currency, ps.location_id
      from scoped s join public.product_stock ps on ps.product_id = s.id
     where p_scope <> 'site' or ps.location_id::text = p_scope_value
    union all
    select s.id, s.sku, s.name, coalesce(s.bcode, ''), coalesce(s.unit_cost, 0), s.currency, null
      from scoped s where not exists (select 1 from public.product_stock ps where ps.product_id = s.id)
  )
  insert into public.stock_count_lines (count_id, product_id, location_id, sku, name, bin_code, unit_cost, currency, sort_key)
  select c.id, e.id, e.location_id, coalesce(e.sku, ''), coalesce(e.name, ''), e.bcode, e.unit_cost, nullif(trim(coalesce(e.currency, '')), ''),
         row_number() over (order by (e.bcode = ''), e.bcode, e.name, e.location_id)
    from expanded e;
  get diagnostics v_lines = row_count;
  if v_lines = 0 then raise exception 'No products match that scope'; end if;

  perform public.count_log(c.id, 'created', v_lines || ' line(s)' || case when p_schedule is not null then ' · scheduled' else '' end);
  if p_assigned is not null and p_schedule is not null then
    insert into public.notifications (user_id, title, body, link)
    values (p_assigned, 'Stock count to do: ' || c.count_number,
      c.title || ' — ' || v_lines || ' line(s), due ' || to_char(c.due_date, 'DD Mon YYYY') || '.', '/cycle-counts/' || c.id);
  elsif p_assigned is not null then
    perform public.notify_user(p_assigned, 'Stock count to do: ' || c.count_number,
      c.title || ' — ' || v_lines || ' line(s), due ' || to_char(c.due_date, 'DD Mon YYYY') || '.', '/cycle-counts/' || c.id);
  else
    for a in select id from public.users where role in ('administrator','inventory_manager') loop
      perform public.notify_user(a.id, 'Stock count to do: ' || c.count_number,
        c.title || ' — ' || v_lines || ' line(s), due ' || to_char(c.due_date, 'DD Mon YYYY') || '. Nobody is assigned yet.',
        '/cycle-counts/' || c.id);
    end loop;
  end if;
  return c;
end $$;
revoke execute on function public.count_build(text, text, text, uuid[], date, uuid, uuid) from public, anon, authenticated;

create or replace function public.count_create(
  p_title text, p_scope text, p_scope_value text default null, p_product_ids uuid[] default null,
  p_due date default null, p_assigned uuid default null
) returns public.stock_counts
language plpgsql security definer set search_path = public as $$
begin
  if not public.ims_is_approver() then raise exception 'Only an Administrator or Inventory Manager can start a count'; end if;
  return public.count_build(p_title, p_scope, p_scope_value, p_product_ids, p_due, p_assigned, null);
end $$;
grant execute on function public.count_create(text, text, text, uuid[], date, uuid) to authenticated;

-- ── Scheduled counts + overdue reminders (called by the app when someone opens it) ──
create or replace function public.count_generate_due() returns integer
language plpgsql security definer set search_path = public as $$
declare s record; v_made integer := 0; v_next date; c record; a record;
begin
  if public.ims_role() is null then return 0; end if;
  for s in select * from public.count_schedules where active and next_due <= current_date for update skip locked loop
    -- Don't stack counts: wait until the previous one from this schedule is closed.
    if exists (select 1 from public.stock_counts where schedule_id = s.id and status in ('open','submitted')) then continue; end if;
    begin
      perform public.count_build(s.name, s.scope, s.scope_value, s.product_ids, current_date + 7, s.assigned_to, s.id);
      v_made := v_made + 1;
    exception when others then
      -- e.g. scope matches nothing any more — skip this round, try next time.
      null;
    end;
    v_next := s.next_due;
    while v_next <= current_date loop v_next := public.count_next_due(v_next, s.frequency, s.interval_days); end loop;
    update public.count_schedules set next_due = v_next, updated_at = now() where id = s.id;
  end loop;

  for c in select * from public.stock_counts where status = 'open' and due_date < current_date and overdue_notified_at is null loop
    update public.stock_counts set overdue_notified_at = now() where id = c.id;
    for a in select distinct u from unnest(array[c.assigned_to] ||
             array(select id from public.users where role in ('administrator','inventory_manager'))) u where u is not null loop
      insert into public.notifications (user_id, title, body, link)
      values (a.u, 'Overdue stock count: ' || c.count_number, c.title || ' was due ' || to_char(c.due_date, 'DD Mon YYYY') || '.', '/cycle-counts/' || c.id);
    end loop;
  end loop;
  return v_made;
end $$;
grant execute on function public.count_generate_due() to authenticated;

-- ── Record one line's count (blind: system qty is captured here, never shown to the counter) ──
create or replace function public.count_record(p_line uuid, p_qty integer)
returns void language plpgsql security definer set search_path = public as $$
declare l public.stock_count_lines%rowtype; v_status text;
begin
  if public.ims_role() is null or public.ims_role() = 'viewer' then raise exception 'Viewers can''t count stock'; end if;
  select * into l from public.stock_count_lines where id = p_line for update;
  if l.id is null then raise exception 'Line not found'; end if;
  select status into v_status from public.stock_counts where id = l.count_id;
  if v_status <> 'open' then raise exception 'This count has been submitted — it can''t be changed'; end if;
  if p_qty is not null and p_qty < 0 then raise exception 'Quantity can''t be negative'; end if;
  update public.stock_count_lines set
    counted_qty = p_qty,
    system_qty = case when p_qty is null then null else public.count_system_qty(l.product_id, l.location_id) end,
    counted_by = case when p_qty is null then null else auth.uid() end,
    counted_at = case when p_qty is null then null else now() end
  where id = p_line;
  update public.stock_counts set updated_at = now() where id = l.count_id;
end $$;
grant execute on function public.count_record(uuid, integer) to authenticated;

-- ── Reviewer explains a variance ───────────────────────────────────────────────
create or replace function public.count_set_reason(p_line uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.ims_is_approver() then raise exception 'Only an approver can record variance reasons'; end if;
  select c.status into v_status from public.stock_count_lines l join public.stock_counts c on c.id = l.count_id where l.id = p_line;
  if v_status <> 'submitted' then raise exception 'Reasons are recorded while the count is awaiting review'; end if;
  update public.stock_count_lines set reason = nullif(trim(coalesce(p_reason, '')), ''), note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_line;
end $$;
grant execute on function public.count_set_reason(uuid, text, text) to authenticated;

-- ── Workflow: submit | approve | recount | cancel | assign ─────────────────────
create or replace function public.count_action(p_count uuid, p_action text, p_note text default null,
                                               p_lines uuid[] default null, p_assigned uuid default null)
returns public.stock_counts
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts%rowtype; v_role text := public.ims_role(); v_who text; l record; a record;
        v_open integer; v_posted integer := 0; v_net integer := 0; v_n integer; v_counters uuid[];
begin
  select * into c from public.stock_counts where id = p_count for update;
  if c.id is null then raise exception 'Count not found'; end if;
  -- Who counted (captured now — a recount clears it).
  select array_agg(distinct counted_by) into v_counters from public.stock_count_lines where count_id = c.id and counted_by is not null;
  if v_role is null or v_role = 'viewer' then raise exception 'Viewers can''t change counts'; end if;
  select name into v_who from public.users where id = auth.uid();

  if p_action = 'assign' then
    if not public.ims_is_approver() then raise exception 'Only an approver can assign counts'; end if;
    if c.status <> 'open' then raise exception 'Only an open count can be reassigned'; end if;
    update public.stock_counts set assigned_to = p_assigned, updated_at = now() where id = c.id returning * into c;
    perform public.count_log(c.id, 'assigned', (select name from public.users where id = p_assigned));
    perform public.notify_user(p_assigned, 'Stock count to do: ' || c.count_number,
      c.title || ', due ' || to_char(c.due_date, 'DD Mon YYYY') || '.', '/cycle-counts/' || c.id);
    return c;

  elsif p_action = 'submit' then
    if c.status <> 'open' then raise exception 'Only an open count can be submitted'; end if;
    select count(*) into v_open from public.stock_count_lines where count_id = c.id and counted_qty is null;
    if v_open > 0 then raise exception '% line(s) not counted yet — enter 0 if there are none', v_open; end if;
    update public.stock_counts set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
     where id = c.id returning * into c;
    perform public.count_log(c.id, 'submitted', p_note);
    for a in select id from public.users where role in ('administrator','inventory_manager')
               and id not in (select counted_by from public.stock_count_lines where count_id = c.id and counted_by is not null) loop
      perform public.notify_user(a.id, 'Count to review: ' || c.count_number,
        c.title || ' was submitted by ' || coalesce(v_who, '?') || '.', '/cycle-counts/' || c.id);
    end loop;

  elsif p_action = 'approve' then
    if not public.ims_is_approver() then raise exception 'Only an Administrator or Inventory Manager can approve'; end if;
    if c.status <> 'submitted' then raise exception 'This count isn''t waiting for review'; end if;
    if exists (select 1 from public.stock_count_lines where count_id = c.id and counted_by = auth.uid()) then
      raise exception 'You counted lines on this sheet, so someone else has to approve it';
    end if;
    select count(*) into v_n from public.stock_count_lines
     where count_id = c.id and counted_qty <> system_qty and reason is null;
    if v_n > 0 then raise exception 'Give a reason for each variance first (% missing)', v_n; end if;
    for l in select * from public.stock_count_lines where count_id = c.id and counted_qty <> system_qty and product_id is not null loop
      perform public.ims_move_stock(l.product_id, l.location_id, l.counted_qty - l.system_qty, 'adjustment',
        'Cycle count ' || c.count_number || ' — ' || l.reason || coalesce(' (' || l.note || ')', ''));
      update public.stock_count_lines set posted_delta = l.counted_qty - l.system_qty where id = l.id;
      v_posted := v_posted + 1; v_net := v_net + (l.counted_qty - l.system_qty);
    end loop;
    update public.stock_counts set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
     where id = c.id returning * into c;
    perform public.count_log(c.id, 'approved', v_posted || ' adjustment(s), net ' || case when v_net > 0 then '+' else '' end || v_net
      || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''));

  elsif p_action = 'recount' then
    if not public.ims_is_approver() then raise exception 'Only an approver can ask for a recount'; end if;
    if c.status <> 'submitted' then raise exception 'This count isn''t waiting for review'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why a recount is needed'; end if;
    update public.stock_count_lines set
      first_count = coalesce(first_count, counted_qty), counted_qty = null, system_qty = null,
      counted_by = null, counted_at = null, recount = true
     where count_id = c.id and (case when p_lines is null then counted_qty <> system_qty else id = any (p_lines) end);
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'Nothing to recount — choose the lines to count again'; end if;
    update public.stock_counts set status = 'open', submitted_by = null, submitted_at = null,
      recount_round = recount_round + 1, updated_at = now() where id = c.id returning * into c;
    perform public.count_log(c.id, 'recount', v_n || ' line(s): ' || p_note);

  elsif p_action = 'cancel' then
    if not public.ims_is_approver() then raise exception 'Only an approver can cancel a count'; end if;
    if c.status in ('approved','cancelled') then raise exception 'Already closed'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for cancelling'; end if;
    update public.stock_counts set status = 'cancelled', updated_at = now() where id = c.id returning * into c;
    perform public.count_log(c.id, 'cancelled', p_note);
  else
    raise exception 'Unknown action %', p_action;
  end if;

  -- Tell the counters and the person assigned what happened.
  if p_action in ('approve','recount','cancel') then
    for a in select distinct u from unnest(array[c.assigned_to] || coalesce(v_counters, '{}')) u where u is not null loop
      perform public.notify_user(a.u, c.count_number || ': ' || case p_action when 'approve' then 'approved'
                                   when 'recount' then 'recount needed' else 'cancelled' end,
        c.title || ' — ' || case p_action when 'approve' then 'approved' when 'recount' then 'please count the flagged lines again'
                                 else 'cancelled' end || ' by ' || coalesce(v_who, '?') || coalesce('. ' || nullif(trim(coalesce(p_note, '')), ''), '.'),
        '/cycle-counts/' || c.id);
    end loop;
  end if;
  return c;
end $$;
grant execute on function public.count_action(uuid, text, text, uuid[], uuid) to authenticated;

-- ── RLS: everything is read-only to the browser except schedules (approvers); all changes to
-- counts go through the functions above. ─────────────────────────────────────
alter table public.count_schedules enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.stock_count_events enable row level security;

drop policy if exists "Authenticated read" on public.count_schedules;
create policy "Authenticated read" on public.count_schedules for select using (auth.role() = 'authenticated');
drop policy if exists "Approvers write" on public.count_schedules;
create policy "Approvers write" on public.count_schedules for all using (public.ims_is_approver()) with check (public.ims_is_approver());

drop policy if exists "Authenticated read" on public.stock_counts;
create policy "Authenticated read" on public.stock_counts for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated read" on public.stock_count_lines;
create policy "Authenticated read" on public.stock_count_lines for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated read" on public.stock_count_events;
create policy "Authenticated read" on public.stock_count_events for select using (auth.role() = 'authenticated');

-- Schedule changes are part of the ISO change history.
drop trigger if exists audit_count_schedules on public.count_schedules;
create trigger audit_count_schedules after insert or update or delete on public.count_schedules
  for each row execute function public.audit_row_change('count_schedule');

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 2026-10-23_traceability
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-23 — ISO phase 4: batch traceability + stock recall.
-- Run once in the Supabase SQL editor, AFTER 2026-10-23_cycle-counts.sql. Safe to re-run.
--
--   * batch_movements   — permanent ledger: every change to a batch's quantity (receipt, sale,
--                         sample, Shopify / Shopee order, count, write-off, merge…), linked to the
--                         stock movement (transactions row) that caused it. Batches that reach 0
--                         disappear from product_batches but their history stays here.
--                         Existing batches start with an "opening balance" row.
--   * product_batches.status — released | on_hold | recalled. Held / recalled units are never
--                         sold or sampled, and FEFO takes them last.
--   * recalls           — RC-2026-0001: product + batch(es), reason, class. Opening one puts the
--                         batches on "recalled"; follow-ups record each recipient contacted and
--                         stock returned; closing keeps the stock blocked (completed) or
--                         releases it (withdrawn — false alarm).
--   * batch_index       — one row per product + batch ever seen (ledger, current batches and PO
--                         receipts), for the Traceability page.

-- ── Batch status ───────────────────────────────────────────────────────────────
alter table public.product_batches add column if not exists status text not null default 'released';
alter table public.product_batches add column if not exists hold_reason text;
alter table public.product_batches add column if not exists status_changed_at timestamptz;
alter table public.product_batches add column if not exists status_changed_by uuid references public.users(id) on delete set null;
do $$ begin
  alter table public.product_batches add constraint product_batches_status_check check (status in ('released','on_hold','recalled'));
exception when duplicate_object then null; end $$;

-- ── Ledger ─────────────────────────────────────────────────────────────────────
create table if not exists public.batch_movements (
  id uuid primary key default uuid_generate_v4(),
  batch_id uuid,                       -- product_batches.id at the time (gone once the batch hits 0)
  product_id uuid,                     -- no FK: history outlives deleted products
  sku text,
  batch_number text not null default '',
  expiry_date date,
  delta integer not null,
  balance integer not null,            -- the batch's quantity after this change
  transaction_id uuid references public.transactions(id) on delete set null,
  tx_group bigint not null default txid_current(),
  note text,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists batch_movements_label_idx on public.batch_movements (product_id, batch_number, expiry_date, created_at);
create index if not exists batch_movements_tx_idx on public.batch_movements (transaction_id);
create index if not exists batch_movements_group_idx on public.batch_movements (tx_group) where transaction_id is null;

create or replace function public.batch_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sku text;
begin
  select sku into v_sku from public.products where id = coalesce(new.product_id, old.product_id);
  if tg_op = 'INSERT' then
    insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance)
    values (new.id, new.product_id, v_sku, new.batch_number, new.expiry_date, new.quantity, new.quantity);
  elsif tg_op = 'DELETE' then
    insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance)
    values (old.id, old.product_id, v_sku, old.batch_number, old.expiry_date, -old.quantity, 0);
  else
    if new.product_id <> old.product_id then
      -- Duplicate products merged: the batch moves across with its units.
      insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
      values (old.id, old.product_id, (select sku from public.products where id = old.product_id), old.batch_number, old.expiry_date,
              -old.quantity, 0, 'Moved to another product (merge)'),
             (new.id, new.product_id, v_sku, new.batch_number, new.expiry_date, new.quantity, new.quantity, 'Merged in from a duplicate product');
      return null;
    end if;
    if (new.batch_number, new.expiry_date) is distinct from (old.batch_number, old.expiry_date) then
      -- A correction of the batch's label: earlier history is re-labelled, the change itself recorded.
      update public.batch_movements set batch_number = new.batch_number, expiry_date = new.expiry_date where batch_id = new.id;
      insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
      values (new.id, new.product_id, v_sku, new.batch_number, new.expiry_date, 0, old.quantity,
              'Label corrected from ' || coalesce(nullif(old.batch_number, ''), '(no number)') || ' / ' || coalesce(old.expiry_date::text, 'no expiry'));
    end if;
    if new.quantity <> old.quantity then
      insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance)
      values (new.id, new.product_id, v_sku, new.batch_number, new.expiry_date, new.quantity - old.quantity, new.quantity);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists batch_ledger on public.product_batches;
create trigger batch_ledger after insert or update or delete on public.product_batches
  for each row execute function public.batch_ledger();

-- The stock movement is written after its batch changes, in the same database transaction:
-- link them up.
create or replace function public.batch_ledger_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.batch_movements set transaction_id = new.id
   where tx_group = txid_current() and product_id = new.product_id and transaction_id is null;
  return null;
end $$;
drop trigger if exists batch_ledger_link on public.transactions;
create trigger batch_ledger_link after insert on public.transactions
  for each row execute function public.batch_ledger_link();

-- Opening balances (once): where tracking starts for batches that already exist.
insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, tx_group, note, actor_id)
select b.id, b.product_id, p.sku, b.batch_number, b.expiry_date, b.quantity, b.quantity, 0, 'Opening balance — batch tracking started', null
  from public.product_batches b join public.products p on p.id = b.product_id
 where not exists (select 1 from public.batch_movements m where m.batch_id = b.id);

-- ── Who may change a batch's status ──────────────────────────────────────────────
create or replace function public.product_batches_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- New stock of a batch that's under an open recall arrives recalled (e.g. a customer return).
    if exists (select 1 from public.recall_batches rb join public.recalls r on r.id = rb.recall_id
                where r.status = 'open' and r.product_id = new.product_id
                  and rb.batch_number = new.batch_number and rb.expiry_date is not distinct from new.expiry_date) then
      new.status := 'recalled';
      new.hold_reason := coalesce(new.hold_reason, 'Under recall');
    elsif coalesce(current_setting('ims.batch_status', true), '') <> 'on' then
      new.status := 'released';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('ims.batch_status', true), '') <> 'on' then
    raise exception 'Use Hold / Release or a recall to change a batch''s status';
  end if;
  return new;
end $$;
drop trigger if exists product_batches_status_guard on public.product_batches;
create trigger product_batches_status_guard before insert or update on public.product_batches
  for each row execute function public.product_batches_status_guard();

-- ── FEFO: released + unexpired first, then expired, held / recalled last ────────
create or replace function public.consume_batches_fefo(p_product_id uuid, p_qty integer)
returns void language plpgsql security definer set search_path = public as $$
declare b record; v_left integer := p_qty;
begin
  for b in select id, quantity from public.product_batches
            where product_id = p_product_id
            order by (status <> 'released'),                                        -- held / recalled last
                     (expiry_date is not null and expiry_date < current_date),      -- expired next-to-last
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

-- ── ims_move_stock: as 2026-10-16_expired-samples.sql, plus held / recalled batches are
-- never sold or sampled (neither picked on purpose nor taken automatically). ──────
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
        v_expired integer; v_blocked integer; v_stock integer; v_bstatus text;
begin
  if p_delta < 0 and p_type in ('sample', 'outbound') then
    if p_batch_id is not null then
      select status into v_bstatus from public.product_batches where id = p_batch_id;
      if v_bstatus = 'recalled' then raise exception 'That batch is under recall — it can''t be sent out'; end if;
      if v_bstatus = 'on_hold' then raise exception 'That batch is on hold — it can''t be sent out'; end if;
      -- A sample may be given from an expired batch picked on purpose; a sale never.
      if p_type = 'outbound' and exists (select 1 from public.product_batches where id = p_batch_id
                  and expiry_date is not null and expiry_date < current_date) then
        raise exception 'That batch has expired — it can''t be sold';
      end if;
    elsif p_location_id is null then
      select coalesce(stock_quantity, 0) into v_stock from public.products where id = p_product_id;
      select coalesce(sum(quantity) filter (where status <> 'released'), 0),
             coalesce(sum(quantity) filter (where status = 'released' and expiry_date is not null and expiry_date < current_date), 0)
        into v_blocked, v_expired
        from public.product_batches where product_id = p_product_id;
      if v_blocked + v_expired > 0 and -p_delta > v_stock - v_blocked - v_expired then
        raise exception 'Only % unit(s) can be sent out — % are on hold or under recall and % have expired',
          greatest(v_stock - v_blocked - v_expired, 0), v_blocked, v_expired;
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

-- ── Recalls ────────────────────────────────────────────────────────────────────
create table if not exists public.recalls (
  id uuid primary key default uuid_generate_v4(),
  recall_number text unique,
  title text not null,
  reason text not null,
  source text not null default 'internal' check (source in ('supplier','internal','customer_complaint','regulator','other')),
  severity text not null default 'class_2' check (severity in ('class_1','class_2','class_3')),
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  sku text,
  status text not null default 'open' check (status in ('open','closed')),
  outcome text check (outcome in ('completed','withdrawn')),
  units_on_hand_at_start integer not null default 0,
  created_by uuid references public.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  close_note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.recall_batches (
  recall_id uuid not null references public.recalls(id) on delete cascade,
  batch_number text not null default '',
  expiry_date date,
  unique nulls not distinct (recall_id, batch_number, expiry_date)
);

-- One row per stock movement that sent affected units out (or might have — before tracking).
create table if not exists public.recall_followups (
  id uuid primary key default uuid_generate_v4(),
  recall_id uuid not null references public.recalls(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','notified','returned','unreachable','not_affected')),
  note text,
  returned_qty integer not null default 0,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  unique (recall_id, transaction_id)
);

create table if not exists public.recall_events (
  id uuid primary key default uuid_generate_v4(),
  recall_id uuid not null references public.recalls(id) on delete cascade,
  actor_id uuid references public.users(id),
  actor_name text,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists recall_events_idx on public.recall_events (recall_id, created_at);

create or replace function public.recall_log(p_recall uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.recall_events (recall_id, actor_id, actor_name, action, note)
  values (p_recall, auth.uid(), (select name from public.users where id = auth.uid()), p_action, nullif(trim(coalesce(p_note, '')), ''));
end $$;
revoke execute on function public.recall_log(uuid, text, text) from public, anon, authenticated;

-- Manual hold / release of one batch (quality hold, damaged delivery, investigation…).
create or replace function public.batch_set_status(p_batch uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.product_batches%rowtype;
begin
  if not public.ims_is_approver() then raise exception 'Only an Administrator or Inventory Manager can hold or release a batch'; end if;
  if p_status not in ('released','on_hold') then raise exception 'Use a recall to recall a batch'; end if;
  select * into b from public.product_batches where id = p_batch for update;
  if b.id is null then raise exception 'Batch not found'; end if;
  if b.status = 'recalled' then raise exception 'This batch is under recall — close the recall to change it'; end if;
  if p_status = 'on_hold' and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the hold'; end if;
  perform set_config('ims.batch_status', 'on', true);
  update public.product_batches set status = p_status,
    hold_reason = case when p_status = 'on_hold' then trim(p_reason) else null end,
    status_changed_at = now(), status_changed_by = auth.uid()
   where id = p_batch;
  perform set_config('ims.batch_status', '', true);
  insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
  values (b.id, b.product_id, (select sku from public.products where id = b.product_id), b.batch_number, b.expiry_date, 0, b.quantity,
          case when p_status = 'on_hold' then 'Put on hold: ' || trim(p_reason) else 'Released from hold' || coalesce(': ' || nullif(trim(coalesce(p_reason, '')), ''), '') end);
end $$;
grant execute on function public.batch_set_status(uuid, text, text) to authenticated;

-- p_batches: [{"batch_number": "26A017", "expiry_date": "2027-01-31" | null}, …]
create or replace function public.recall_open(p_title text, p_reason text, p_source text, p_severity text,
                                              p_product uuid, p_batches jsonb)
returns public.recalls
language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; v_year integer := extract(year from current_date); v_n integer; p record;
        v_onhand integer; a record; v_labels text;
begin
  if not public.ims_is_approver() then raise exception 'Only an Administrator or Inventory Manager can open a recall'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for the recall'; end if;
  if coalesce(jsonb_array_length(p_batches), 0) = 0 then raise exception 'Choose at least one batch'; end if;
  select id, name, sku into p from public.products where id = p_product;
  if p.id is null then raise exception 'Product not found'; end if;

  insert into public.doc_counters (doc_type, year, last) values ('recall', v_year, 1)
    on conflict (doc_type, year) do update set last = doc_counters.last + 1 returning last into v_n;
  insert into public.recalls (recall_number, title, reason, source, severity, product_id, product_name, sku)
  values ('RC-' || v_year || '-' || lpad(v_n::text, 4, '0'), coalesce(nullif(trim(p_title), ''), 'Recall — ' || p.name),
          trim(p_reason), coalesce(p_source, 'internal'), coalesce(p_severity, 'class_2'), p.id, p.name, p.sku)
  returning * into r;

  insert into public.recall_batches (recall_id, batch_number, expiry_date)
  select r.id, trim(coalesce(x->>'batch_number', '')), nullif(x->>'expiry_date', '')::date
    from jsonb_array_elements(p_batches) x
  on conflict do nothing;

  -- Block what's still in stock.
  perform set_config('ims.batch_status', 'on', true);
  update public.product_batches b set status = 'recalled', hold_reason = 'Recall ' || r.recall_number,
         status_changed_at = now(), status_changed_by = auth.uid()
    from public.recall_batches rb
   where rb.recall_id = r.id and b.product_id = p.id
     and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date;
  perform set_config('ims.batch_status', '', true);

  select coalesce(sum(b.quantity), 0) into v_onhand from public.product_batches b
    join public.recall_batches rb on rb.recall_id = r.id and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date
   where b.product_id = p.id;
  update public.recalls set units_on_hand_at_start = v_onhand where id = r.id returning * into r;

  insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
  select b.id, b.product_id, p.sku, b.batch_number, b.expiry_date, 0, b.quantity, 'Recalled — ' || r.recall_number
    from public.product_batches b join public.recall_batches rb
      on rb.recall_id = r.id and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date
   where b.product_id = p.id;

  select string_agg(coalesce(nullif(batch_number, ''), '(no number)') || coalesce(' exp ' || to_char(expiry_date, 'DD Mon YYYY'), ''), ', ')
    into v_labels from public.recall_batches where recall_id = r.id;
  perform public.recall_log(r.id, 'opened', v_labels || ' · ' || v_onhand || ' unit(s) in stock blocked');
  -- Everyone who can move stock must know not to ship it.
  for a in select id from public.users where role in ('administrator','inventory_manager','staff') loop
    perform public.notify_user(a.id, 'RECALL ' || r.recall_number || ': ' || p.name,
      'Do not sell or ship batch ' || v_labels || '. ' || left(trim(p_reason), 200), '/traceability/recalls/' || r.id);
  end loop;
  return r;
end $$;
grant execute on function public.recall_open(text, text, text, text, uuid, jsonb) to authenticated;

-- Record contact with one recipient (staff can do this).
create or replace function public.recall_followup(p_recall uuid, p_transaction uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if public.ims_role() is null or public.ims_role() = 'viewer' then raise exception 'Viewers can''t update a recall'; end if;
  select status into v_status from public.recalls where id = p_recall;
  if v_status is null then raise exception 'Recall not found'; end if;
  if v_status <> 'open' then raise exception 'This recall is closed'; end if;
  if p_status not in ('pending','notified','returned','unreachable','not_affected') then raise exception 'Unknown status %', p_status; end if;
  insert into public.recall_followups (recall_id, transaction_id, status, note, updated_by, updated_at)
  values (p_recall, p_transaction, p_status, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (recall_id, transaction_id) do update
    set status = excluded.status, note = excluded.note, updated_by = auth.uid(), updated_at = now();
  perform public.recall_log(p_recall, 'followup', replace(p_status, '_', ' ') || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''));
end $$;
grant execute on function public.recall_followup(uuid, uuid, text, text) to authenticated;

-- Book units a recipient sent back: into the recalled batch (blocked), logged as inbound.
create or replace function public.recall_return(p_recall uuid, p_transaction uuid, p_qty integer,
                                                p_batch_number text, p_expiry date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; t record;
begin
  if public.ims_role() is null or public.ims_role() = 'viewer' then raise exception 'Viewers can''t book returns'; end if;
  select * into r from public.recalls where id = p_recall;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.status <> 'open' then raise exception 'This recall is closed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many units came back'; end if;
  if not exists (select 1 from public.recall_batches where recall_id = r.id and batch_number = trim(coalesce(p_batch_number, ''))
                   and expiry_date is not distinct from p_expiry) then
    raise exception 'That batch isn''t part of this recall';
  end if;
  select * into t from public.transactions where id = p_transaction;
  if t.id is null then raise exception 'Shipment not found'; end if;
  perform public.ims_move_stock(r.product_id, t.location_id, p_qty, 'inbound',
    'Recall return ' || r.recall_number || coalesce(' — ' || nullif(trim(coalesce(t.notes, '')), ''), '') || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''),
    null, null, null, trim(coalesce(p_batch_number, '')), p_expiry, null);
  insert into public.recall_followups (recall_id, transaction_id, status, returned_qty, note, updated_by, updated_at)
  values (r.id, p_transaction, 'returned', p_qty, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (recall_id, transaction_id) do update
    set status = 'returned', returned_qty = recall_followups.returned_qty + p_qty,
        note = coalesce(excluded.note, recall_followups.note), updated_by = auth.uid(), updated_at = now();
  perform public.recall_log(r.id, 'returned', p_qty || ' unit(s) back' || coalesce(' — ' || nullif(trim(coalesce(t.notes, '')), ''), ''));
end $$;
grant execute on function public.recall_return(uuid, uuid, integer, text, date, text) to authenticated;

-- completed: stock stays blocked (write it off when disposed) · withdrawn: false alarm, release it.
create or replace function public.recall_close(p_recall uuid, p_outcome text, p_note text)
returns public.recalls
language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; a record;
begin
  if not public.ims_is_approver() then raise exception 'Only an Administrator or Inventory Manager can close a recall'; end if;
  select * into r from public.recalls where id = p_recall for update;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.status <> 'open' then raise exception 'Already closed'; end if;
  if p_outcome not in ('completed','withdrawn') then raise exception 'Unknown outcome %', p_outcome; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write a closing summary'; end if;
  update public.recalls set status = 'closed', outcome = p_outcome, closed_by = auth.uid(), closed_at = now(),
         close_note = trim(p_note), updated_at = now() where id = r.id returning * into r;
  if p_outcome = 'withdrawn' then
    perform set_config('ims.batch_status', 'on', true);
    update public.product_batches b set status = 'released', hold_reason = null, status_changed_at = now(), status_changed_by = auth.uid()
      from public.recall_batches rb
     where rb.recall_id = r.id and b.product_id = r.product_id and b.status = 'recalled'
       and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date
       -- …unless another open recall still covers it.
       and not exists (select 1 from public.recall_batches rb2 join public.recalls r2 on r2.id = rb2.recall_id
                        where r2.status = 'open' and r2.product_id = b.product_id
                          and rb2.batch_number = b.batch_number and rb2.expiry_date is not distinct from b.expiry_date);
    perform set_config('ims.batch_status', '', true);
  end if;
  perform public.recall_log(r.id, 'closed_' || p_outcome, p_note);
  for a in select id from public.users where role in ('administrator','inventory_manager','staff') loop
    perform public.notify_user(a.id, r.recall_number || ' closed (' || p_outcome || ')',
      coalesce(r.product_name, '') || ' — ' || case p_outcome when 'withdrawn' then 'recall withdrawn, batches released for sale again.'
        else 'recall completed; remaining recalled stock stays blocked until written off.' end, '/traceability/recalls/' || r.id);
  end loop;
  return r;
end $$;
grant execute on function public.recall_close(uuid, text, text) to authenticated;

-- ── Every batch ever seen, for the Traceability page ─────────────────────────────
create or replace view public.batch_index with (security_invoker = true) as
with labels as (
  select product_id, batch_number, expiry_date from public.batch_movements where product_id is not null
  union
  select product_id, batch_number, expiry_date from public.product_batches
  union
  select dl.product_id, trim(coalesce(dl.batch_number, '')), dl.expiry_date
    from public.document_lines dl join public.documents d on d.id = dl.document_id
   where d.doc_type = 'purchase_order' and dl.product_id is not null and dl.received_qty > 0
     and (trim(coalesce(dl.batch_number, '')) <> '' or dl.expiry_date is not null)
)
select l.product_id, l.batch_number, l.expiry_date, p.name as product_name, p.sku,
  coalesce((select sum(b.quantity) from public.product_batches b
             where b.product_id = l.product_id and b.batch_number = l.batch_number and b.expiry_date is not distinct from l.expiry_date), 0)::integer as on_hand,
  (select b.status from public.product_batches b
    where b.product_id = l.product_id and b.batch_number = l.batch_number and b.expiry_date is not distinct from l.expiry_date limit 1) as status,
  coalesce((select sum(m.delta) from public.batch_movements m
             where m.product_id = l.product_id and m.batch_number = l.batch_number and m.expiry_date is not distinct from l.expiry_date
               and m.delta < 0), 0)::integer as units_out,
  (select min(m.created_at) from public.batch_movements m
    where m.product_id = l.product_id and m.batch_number = l.batch_number and m.expiry_date is not distinct from l.expiry_date) as first_seen,
  (select max(m.created_at) from public.batch_movements m
    where m.product_id = l.product_id and m.batch_number = l.batch_number and m.expiry_date is not distinct from l.expiry_date) as last_movement,
  exists (select 1 from public.recall_batches rb join public.recalls r on r.id = rb.recall_id
           where r.product_id = l.product_id and rb.batch_number = l.batch_number and rb.expiry_date is not distinct from l.expiry_date) as ever_recalled
from labels l join public.products p on p.id = l.product_id;

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.batch_movements enable row level security;
alter table public.recalls enable row level security;
alter table public.recall_batches enable row level security;
alter table public.recall_followups enable row level security;
alter table public.recall_events enable row level security;
drop policy if exists "Authenticated read" on public.batch_movements;
create policy "Authenticated read" on public.batch_movements for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated read" on public.recalls;
create policy "Authenticated read" on public.recalls for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated read" on public.recall_batches;
create policy "Authenticated read" on public.recall_batches for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated read" on public.recall_followups;
create policy "Authenticated read" on public.recall_followups for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated read" on public.recall_events;
create policy "Authenticated read" on public.recall_events for select using (auth.role() = 'authenticated');
grant select on public.batch_index to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 2026-10-23_audit-pack
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-23 — ISO phase 5: audit pack.
-- Run once in the Supabase SQL editor, AFTER 2026-10-23_traceability.sql. Safe to re-run.
--
-- 1. The audit log becomes a permanent record: entries can't be edited or deleted, and the
--    app can no longer write to it directly (only the database's own triggers / functions).
-- 2. Changes to master data that had no history yet — products, sites, categories and the
--    company details — are now logged with who / when / before → after.

-- ── 1. Audit log: append-only ────────────────────────────────────────────────────
-- Only database functions add entries (SECURITY DEFINER), so the client insert policy goes.
drop policy if exists "Authenticated insert audit_log" on public.audit_log;

create or replace function public.audit_log_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Audit log entries are permanent and can''t be deleted'; end if;
  -- The one allowed change: clearing actor_id when a user account is removed (name/email stay).
  if (to_jsonb(new) - 'actor_id') is distinct from (to_jsonb(old) - 'actor_id') or new.actor_id is not null then
    raise exception 'Audit log entries are permanent and can''t be changed';
  end if;
  return new;
end $$;

drop trigger if exists audit_log_guard on public.audit_log;
create trigger audit_log_guard before update or delete on public.audit_log
  for each row execute function public.audit_log_guard();

create or replace function public.audit_log_no_truncate()
returns trigger language plpgsql as $$
begin
  raise exception 'Audit log entries are permanent and can''t be deleted';
end $$;
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_no_truncate();

create index if not exists audit_log_entity_idx on public.audit_log (entity_type, created_at desc);
create index if not exists audit_log_entity_id_idx on public.audit_log (entity_id);

-- ── 2. Change history for more master data ──────────────────────────────────────
-- Like audit_row_change(), but: logs only the fields that changed, skips updates where
-- nothing that matters changed (trigger args after the entity type = fields to ignore,
-- e.g. stock levels that move with every sale), and copes with non-uuid ids.
create or replace function public.audit_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor public.users%rowtype;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_before jsonb := '{}'; v_after jsonb := '{}';
  k text; i int;
begin
  if tg_op = 'UPDATE' then
    for i in 1 .. tg_nargs - 1 loop
      v_old := v_old - tg_argv[i]; v_new := v_new - tg_argv[i];
    end loop;
    for k in select jsonb_object_keys(v_new) loop
      if v_new->k is distinct from v_old->k then
        v_before := v_before || jsonb_build_object(k, v_old->k);
        v_after := v_after || jsonb_build_object(k, v_new->k);
      end if;
    end loop;
    if v_after = '{}'::jsonb then return new; end if;
  end if;
  select * into v_actor from public.users where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (
    v_actor.id, v_actor.name, v_actor.email, lower(tg_op), tg_argv[0],
    case when v_row->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_row->>'id')::uuid end,
    concat_ws(' · ', coalesce(v_row->>'name', v_row->>'code', v_row->>'id'), v_row->>'sku'),
    case tg_op when 'UPDATE' then jsonb_build_object('before', v_before, 'after', v_after) else v_row end
  );
  return coalesce(new, old);
end $$;
revoke execute on function public.audit_changes() from public, anon, authenticated;

-- Products: stock level, the expiry/batch summary (kept in step with batches, which have
-- their own ledger) and timestamps change constantly — ignore them. Deletes are already
-- logged with a full snapshot by delete_product_cascade().
drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update on public.products
  for each row execute function public.audit_changes('product', 'stock_quantity', 'expiry_date', 'batch_number', 'updated_at');

drop trigger if exists audit_stock_locations on public.stock_locations;
create trigger audit_stock_locations after insert or update or delete on public.stock_locations
  for each row execute function public.audit_changes('site');

drop trigger if exists audit_company_profile on public.company_profile;
create trigger audit_company_profile after insert or update on public.company_profile
  for each row execute function public.audit_changes('company_profile', 'updated_at');

do $$ begin
  if to_regclass('public.categories') is not null then
    execute 'drop trigger if exists audit_categories on public.categories';
    execute 'create trigger audit_categories after insert or update or delete on public.categories
               for each row execute function public.audit_changes(''category'')';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 2026-10-23_approval-matrix
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-23 — Approval matrix: an Administrator chooses who approves what.
-- Run once in the Supabase SQL editor, AFTER 2026-10-23_audit-pack.sql. Safe to re-run.
--
-- approval_rules: one row per kind of approval with the chosen approvers. No row / nobody
-- chosen = as before (every Administrator and Inventory Manager). When people are chosen,
-- only they can approve that kind — and only they get the "approval needed" notifications.
-- The existing rules still apply on top: nobody approves their own form or their own count.

create table if not exists public.approval_rules (
  approval_type text primary key
    check (approval_type in ('purchase_order','quotation','invoice','cycle_count','batch_hold','recall')),
  approver_ids uuid[] not null default '{}',
  updated_by uuid references public.users(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.approval_rules enable row level security;
drop policy if exists "Authenticated read" on public.approval_rules;
create policy "Authenticated read" on public.approval_rules for select using (auth.role() = 'authenticated');
drop policy if exists "Admins write" on public.approval_rules;
create policy "Admins write" on public.approval_rules for all
  using (public.ims_role() = 'administrator') with check (public.ims_role() = 'administrator');

-- Who changed the approvers, and from whom to whom, goes in the permanent audit log
-- (audit_changes() re-created so the entry is labelled with the approval type).
create or replace function public.audit_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor public.users%rowtype;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_before jsonb := '{}'; v_after jsonb := '{}';
  k text; i int;
begin
  if tg_op = 'UPDATE' then
    for i in 1 .. tg_nargs - 1 loop
      v_old := v_old - tg_argv[i]; v_new := v_new - tg_argv[i];
    end loop;
    for k in select jsonb_object_keys(v_new) loop
      if v_new->k is distinct from v_old->k then
        v_before := v_before || jsonb_build_object(k, v_old->k);
        v_after := v_after || jsonb_build_object(k, v_new->k);
      end if;
    end loop;
    if v_after = '{}'::jsonb then return new; end if;
  end if;
  select * into v_actor from public.users where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (
    v_actor.id, v_actor.name, v_actor.email, lower(tg_op), tg_argv[0],
    case when v_row->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_row->>'id')::uuid end,
    concat_ws(' · ', coalesce(v_row->>'name', v_row->>'code', v_row->>'approval_type', v_row->>'id'), v_row->>'sku'),
    case tg_op when 'UPDATE' then jsonb_build_object('before', v_before, 'after', v_after) else v_row end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists audit_approval_rules on public.approval_rules;
create trigger audit_approval_rules after insert or update or delete on public.approval_rules
  for each row execute function public.audit_changes('approval_rule', 'updated_at', 'updated_by');

-- The people who approve p_type: the chosen ones (still active, not viewers), or by default
-- every Administrator and Inventory Manager.
create or replace function public.ims_approvers(p_type text) returns setof uuid
language sql stable security definer set search_path = public as $$
  with chosen as (
    select u.id from public.approval_rules r join public.users u on u.id = any (r.approver_ids)
     where r.approval_type = p_type and u.role in ('administrator','inventory_manager','staff')
  )
  select id from chosen
  union all
  select id from public.users
   where role in ('administrator','inventory_manager') and not exists (select 1 from chosen)
$$;
grant execute on function public.ims_approvers(text) to authenticated;

create or replace function public.ims_can_approve(p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.ims_approvers(p_type) id where id = auth.uid())
$$;
grant execute on function public.ims_can_approve(text) to authenticated;

-- ── The approval steps now ask ims_can_approve() instead of "is admin / inventory manager" ──

create or replace function public.document_action(p_doc uuid, p_action text, p_note text default null, p_outcome text default null)
returns public.documents
language plpgsql security definer set search_path = public as $$
declare d public.documents%rowtype; v_role text := public.ims_role(); v_party jsonb; v_next text;
        v_label text; v_who text; a record;
begin
  select * into d from public.documents where id = p_doc for update;
  if d.id is null then raise exception 'Form not found'; end if;
  if d.archived_at is not null then raise exception '% is archived', d.doc_number; end if;
  if v_role is null or v_role = 'viewer' then raise exception 'Viewers can''t change forms'; end if;
  v_label := public.doc_label(d.doc_type) || ' ' || d.doc_number;
  select name into v_who from public.users where id = auth.uid();

  if p_action = 'submit' then
    if d.status not in ('draft','rejected') then raise exception 'Only a draft or rejected form can be submitted'; end if;
    if not exists (select 1 from public.document_lines where document_id = d.id) then raise exception 'Add at least one line first'; end if;
    if d.doc_type = 'purchase_order' and d.supplier_id is null then raise exception 'Choose the vendor first'; end if;
    if d.doc_type <> 'purchase_order' and d.customer_id is null then raise exception 'Choose the customer first'; end if;
    if d.doc_type = 'purchase_order' then
      select to_jsonb(s) - 'created_at' - 'updated_at' into v_party from public.suppliers s where id = d.supplier_id;
    else
      select to_jsonb(c) - 'created_at' - 'updated_at' into v_party from public.customers c where id = d.customer_id;
    end if;
    v_next := 'pending_approval';
  elsif p_action in ('approve','reject') then
    if not public.ims_can_approve(d.doc_type) then
      raise exception 'You''re not an approver for %s — ask an Administrator (Settings → Approvals)', public.doc_label(d.doc_type);
    end if;
    if d.status <> 'pending_approval' then raise exception 'This form isn''t waiting for approval'; end if;
    if p_action = 'approve' and d.prepared_by = auth.uid() then
      raise exception 'You prepared this form, so someone else has to approve it';
    end if;
    if p_action = 'reject' and coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for rejecting'; end if;
    v_next := case p_action when 'approve' then 'approved' else 'rejected' end;
  elsif p_action = 'issue' then
    if d.status <> 'approved' then raise exception 'Only an approved form can be issued'; end if;
    if not (public.ims_is_approver() or public.ims_can_approve(d.doc_type) or auth.uid() in (d.assigned_to, d.prepared_by)) then
      raise exception 'Only the person in charge, the preparer or an approver can issue it';
    end if;
    v_next := 'issued';
  elsif p_action = 'complete' then
    if d.status not in ('approved','issued') then raise exception 'Only an approved or issued form can be completed'; end if;
    if not (public.ims_is_approver() or public.ims_can_approve(d.doc_type) or auth.uid() in (d.assigned_to, d.prepared_by)) then
      raise exception 'Only the person in charge, the preparer or an approver can complete it';
    end if;
    if p_outcome is null or not (p_outcome = any (case d.doc_type
         when 'purchase_order' then array['received']
         when 'quotation' then array['accepted','declined','expired']
         else array['paid'] end)) then
      raise exception 'Unknown result "%" for a %', p_outcome, public.doc_label(d.doc_type);
    end if;
    v_next := 'completed';
  elsif p_action = 'cancel' then
    if d.status in ('completed','cancelled') then raise exception 'Already closed'; end if;
    if not (public.ims_is_approver() or public.ims_can_approve(d.doc_type) or (d.status in ('draft','rejected') and d.prepared_by = auth.uid())) then
      raise exception 'Only an approver can cancel a submitted form';
    end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for cancelling'; end if;
    v_next := 'cancelled';
  else
    raise exception 'Unknown action %', p_action;
  end if;

  perform set_config('ims.doc_action', 'on', true);
  update public.documents set
    status = v_next,
    party = coalesce(v_party, party),
    approved_by = case when p_action = 'approve' then auth.uid() when p_action in ('submit','reject') then null else approved_by end,
    approved_at = case when p_action = 'approve' then now() when p_action in ('submit','reject') then null else approved_at end,
    outcome = case when p_action = 'complete' then p_outcome else outcome end,
    archived_at = case when v_next in ('completed','cancelled') then now() else null end
  where id = d.id
  returning * into d;
  perform set_config('ims.doc_action', 'off', true);

  perform public.log_document_event(d.id, coalesce(p_outcome, p_action), nullif(trim(p_note), ''));
  if v_next in ('completed','cancelled') then perform public.log_document_event(d.id, 'archived', null); end if;

  -- Who to tell.
  if p_action = 'submit' then
    for a in select id from public.ims_approvers(d.doc_type) id where id <> d.prepared_by loop
      perform public.notify_user(a.id, 'Approval needed: ' || d.doc_number, v_label || ' was submitted by ' || coalesce(v_who, '?') || '.', '/forms/' || d.id);
    end loop;
    -- (An approver in charge already got "Approval needed" above.)
    if d.assigned_to is distinct from d.prepared_by
       and not exists (select 1 from public.ims_approvers(d.doc_type) id where id = d.assigned_to) then
      perform public.notify_user(d.assigned_to, d.doc_number || ' submitted for approval', v_label || ' is waiting for approval.', '/forms/' || d.id);
    end if;
  else
    perform public.notify_user(d.prepared_by, d.doc_number || ': ' || replace(v_next, '_', ' '),
      v_label || ' — ' || coalesce(p_outcome, p_action) || ' by ' || coalesce(v_who, '?') || coalesce('. ' || nullif(trim(p_note), ''), '.'),
      '/forms/' || d.id);
    if d.assigned_to is distinct from d.prepared_by then
      perform public.notify_user(d.assigned_to, d.doc_number || ': ' || replace(v_next, '_', ' '),
        v_label || ' — ' || coalesce(p_outcome, p_action) || ' by ' || coalesce(v_who, '?') ||
        case when p_action = 'approve' then '. You can now go ahead.' else coalesce('. ' || nullif(trim(p_note), ''), '.') end,
        '/forms/' || d.id);
    end if;
  end if;
  return d;
end $$;

create or replace function public.count_set_reason(p_line uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.ims_can_approve('cycle_count') then raise exception 'Only a cycle-count approver can record variance reasons'; end if;
  select c.status into v_status from public.stock_count_lines l join public.stock_counts c on c.id = l.count_id where l.id = p_line;
  if v_status <> 'submitted' then raise exception 'Reasons are recorded while the count is awaiting review'; end if;
  update public.stock_count_lines set reason = nullif(trim(coalesce(p_reason, '')), ''), note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_line;
end $$;

create or replace function public.count_action(p_count uuid, p_action text, p_note text default null,
                                               p_lines uuid[] default null, p_assigned uuid default null)
returns public.stock_counts
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts%rowtype; v_role text := public.ims_role(); v_who text; l record; a record;
        v_open integer; v_posted integer := 0; v_net integer := 0; v_n integer; v_counters uuid[];
begin
  select * into c from public.stock_counts where id = p_count for update;
  if c.id is null then raise exception 'Count not found'; end if;
  -- Who counted (captured now — a recount clears it).
  select array_agg(distinct counted_by) into v_counters from public.stock_count_lines where count_id = c.id and counted_by is not null;
  if v_role is null or v_role = 'viewer' then raise exception 'Viewers can''t change counts'; end if;
  select name into v_who from public.users where id = auth.uid();

  if p_action = 'assign' then
    if not public.ims_is_approver() then raise exception 'Only an approver can assign counts'; end if;
    if c.status <> 'open' then raise exception 'Only an open count can be reassigned'; end if;
    update public.stock_counts set assigned_to = p_assigned, updated_at = now() where id = c.id returning * into c;
    perform public.count_log(c.id, 'assigned', (select name from public.users where id = p_assigned));
    perform public.notify_user(p_assigned, 'Stock count to do: ' || c.count_number,
      c.title || ', due ' || to_char(c.due_date, 'DD Mon YYYY') || '.', '/cycle-counts/' || c.id);
    return c;

  elsif p_action = 'submit' then
    if c.status <> 'open' then raise exception 'Only an open count can be submitted'; end if;
    select count(*) into v_open from public.stock_count_lines where count_id = c.id and counted_qty is null;
    if v_open > 0 then raise exception '% line(s) not counted yet — enter 0 if there are none', v_open; end if;
    update public.stock_counts set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
     where id = c.id returning * into c;
    perform public.count_log(c.id, 'submitted', p_note);
    for a in select id from public.ims_approvers('cycle_count') id
               where id not in (select counted_by from public.stock_count_lines where count_id = c.id and counted_by is not null) loop
      perform public.notify_user(a.id, 'Count to review: ' || c.count_number,
        c.title || ' was submitted by ' || coalesce(v_who, '?') || '.', '/cycle-counts/' || c.id);
    end loop;

  elsif p_action = 'approve' then
    if not public.ims_can_approve('cycle_count') then raise exception 'You''re not a cycle-count approver — ask an Administrator (Settings → Approvals)'; end if;
    if c.status <> 'submitted' then raise exception 'This count isn''t waiting for review'; end if;
    if exists (select 1 from public.stock_count_lines where count_id = c.id and counted_by = auth.uid()) then
      raise exception 'You counted lines on this sheet, so someone else has to approve it';
    end if;
    select count(*) into v_n from public.stock_count_lines
     where count_id = c.id and counted_qty <> system_qty and reason is null;
    if v_n > 0 then raise exception 'Give a reason for each variance first (% missing)', v_n; end if;
    for l in select * from public.stock_count_lines where count_id = c.id and counted_qty <> system_qty and product_id is not null loop
      perform public.ims_move_stock(l.product_id, l.location_id, l.counted_qty - l.system_qty, 'adjustment',
        'Cycle count ' || c.count_number || ' — ' || l.reason || coalesce(' (' || l.note || ')', ''));
      update public.stock_count_lines set posted_delta = l.counted_qty - l.system_qty where id = l.id;
      v_posted := v_posted + 1; v_net := v_net + (l.counted_qty - l.system_qty);
    end loop;
    update public.stock_counts set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
     where id = c.id returning * into c;
    perform public.count_log(c.id, 'approved', v_posted || ' adjustment(s), net ' || case when v_net > 0 then '+' else '' end || v_net
      || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''));

  elsif p_action = 'recount' then
    if not public.ims_can_approve('cycle_count') then raise exception 'Only a cycle-count approver can ask for a recount'; end if;
    if c.status <> 'submitted' then raise exception 'This count isn''t waiting for review'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why a recount is needed'; end if;
    update public.stock_count_lines set
      first_count = coalesce(first_count, counted_qty), counted_qty = null, system_qty = null,
      counted_by = null, counted_at = null, recount = true
     where count_id = c.id and (case when p_lines is null then counted_qty <> system_qty else id = any (p_lines) end);
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'Nothing to recount — choose the lines to count again'; end if;
    update public.stock_counts set status = 'open', submitted_by = null, submitted_at = null,
      recount_round = recount_round + 1, updated_at = now() where id = c.id returning * into c;
    perform public.count_log(c.id, 'recount', v_n || ' line(s): ' || p_note);

  elsif p_action = 'cancel' then
    if not public.ims_is_approver() then raise exception 'Only an approver can cancel a count'; end if;
    if c.status in ('approved','cancelled') then raise exception 'Already closed'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for cancelling'; end if;
    update public.stock_counts set status = 'cancelled', updated_at = now() where id = c.id returning * into c;
    perform public.count_log(c.id, 'cancelled', p_note);
  else
    raise exception 'Unknown action %', p_action;
  end if;

  -- Tell the counters and the person assigned what happened.
  if p_action in ('approve','recount','cancel') then
    for a in select distinct u from unnest(array[c.assigned_to] || coalesce(v_counters, '{}')) u where u is not null loop
      perform public.notify_user(a.u, c.count_number || ': ' || case p_action when 'approve' then 'approved'
                                   when 'recount' then 'recount needed' else 'cancelled' end,
        c.title || ' — ' || case p_action when 'approve' then 'approved' when 'recount' then 'please count the flagged lines again'
                                 else 'cancelled' end || ' by ' || coalesce(v_who, '?') || coalesce('. ' || nullif(trim(coalesce(p_note, '')), ''), '.'),
        '/cycle-counts/' || c.id);
    end loop;
  end if;
  return c;
end $$;

create or replace function public.batch_set_status(p_batch uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.product_batches%rowtype;
begin
  if not public.ims_can_approve('batch_hold') then raise exception 'You''re not allowed to hold or release batches — ask an Administrator (Settings → Approvals)'; end if;
  if p_status not in ('released','on_hold') then raise exception 'Use a recall to recall a batch'; end if;
  select * into b from public.product_batches where id = p_batch for update;
  if b.id is null then raise exception 'Batch not found'; end if;
  if b.status = 'recalled' then raise exception 'This batch is under recall — close the recall to change it'; end if;
  if p_status = 'on_hold' and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the hold'; end if;
  perform set_config('ims.batch_status', 'on', true);
  update public.product_batches set status = p_status,
    hold_reason = case when p_status = 'on_hold' then trim(p_reason) else null end,
    status_changed_at = now(), status_changed_by = auth.uid()
   where id = p_batch;
  perform set_config('ims.batch_status', '', true);
  insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
  values (b.id, b.product_id, (select sku from public.products where id = b.product_id), b.batch_number, b.expiry_date, 0, b.quantity,
          case when p_status = 'on_hold' then 'Put on hold: ' || trim(p_reason) else 'Released from hold' || coalesce(': ' || nullif(trim(coalesce(p_reason, '')), ''), '') end);
end $$;

create or replace function public.recall_open(p_title text, p_reason text, p_source text, p_severity text,
                                              p_product uuid, p_batches jsonb)
returns public.recalls
language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; v_year integer := extract(year from current_date); v_n integer; p record;
        v_onhand integer; a record; v_labels text;
begin
  if not public.ims_can_approve('recall') then raise exception 'You''re not allowed to open recalls — ask an Administrator (Settings → Approvals)'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for the recall'; end if;
  if coalesce(jsonb_array_length(p_batches), 0) = 0 then raise exception 'Choose at least one batch'; end if;
  select id, name, sku into p from public.products where id = p_product;
  if p.id is null then raise exception 'Product not found'; end if;

  insert into public.doc_counters (doc_type, year, last) values ('recall', v_year, 1)
    on conflict (doc_type, year) do update set last = doc_counters.last + 1 returning last into v_n;
  insert into public.recalls (recall_number, title, reason, source, severity, product_id, product_name, sku)
  values ('RC-' || v_year || '-' || lpad(v_n::text, 4, '0'), coalesce(nullif(trim(p_title), ''), 'Recall — ' || p.name),
          trim(p_reason), coalesce(p_source, 'internal'), coalesce(p_severity, 'class_2'), p.id, p.name, p.sku)
  returning * into r;

  insert into public.recall_batches (recall_id, batch_number, expiry_date)
  select r.id, trim(coalesce(x->>'batch_number', '')), nullif(x->>'expiry_date', '')::date
    from jsonb_array_elements(p_batches) x
  on conflict do nothing;

  -- Block what's still in stock.
  perform set_config('ims.batch_status', 'on', true);
  update public.product_batches b set status = 'recalled', hold_reason = 'Recall ' || r.recall_number,
         status_changed_at = now(), status_changed_by = auth.uid()
    from public.recall_batches rb
   where rb.recall_id = r.id and b.product_id = p.id
     and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date;
  perform set_config('ims.batch_status', '', true);

  select coalesce(sum(b.quantity), 0) into v_onhand from public.product_batches b
    join public.recall_batches rb on rb.recall_id = r.id and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date
   where b.product_id = p.id;
  update public.recalls set units_on_hand_at_start = v_onhand where id = r.id returning * into r;

  insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
  select b.id, b.product_id, p.sku, b.batch_number, b.expiry_date, 0, b.quantity, 'Recalled — ' || r.recall_number
    from public.product_batches b join public.recall_batches rb
      on rb.recall_id = r.id and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date
   where b.product_id = p.id;

  select string_agg(coalesce(nullif(batch_number, ''), '(no number)') || coalesce(' exp ' || to_char(expiry_date, 'DD Mon YYYY'), ''), ', ')
    into v_labels from public.recall_batches where recall_id = r.id;
  perform public.recall_log(r.id, 'opened', v_labels || ' · ' || v_onhand || ' unit(s) in stock blocked');
  -- Everyone who can move stock must know not to ship it.
  for a in select id from public.users where role in ('administrator','inventory_manager','staff') loop
    perform public.notify_user(a.id, 'RECALL ' || r.recall_number || ': ' || p.name,
      'Do not sell or ship batch ' || v_labels || '. ' || left(trim(p_reason), 200), '/traceability/recalls/' || r.id);
  end loop;
  return r;
end $$;

create or replace function public.recall_close(p_recall uuid, p_outcome text, p_note text)
returns public.recalls
language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; a record;
begin
  if not public.ims_can_approve('recall') then raise exception 'You''re not allowed to close recalls — ask an Administrator (Settings → Approvals)'; end if;
  select * into r from public.recalls where id = p_recall for update;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.status <> 'open' then raise exception 'Already closed'; end if;
  if p_outcome not in ('completed','withdrawn') then raise exception 'Unknown outcome %', p_outcome; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write a closing summary'; end if;
  update public.recalls set status = 'closed', outcome = p_outcome, closed_by = auth.uid(), closed_at = now(),
         close_note = trim(p_note), updated_at = now() where id = r.id returning * into r;
  if p_outcome = 'withdrawn' then
    perform set_config('ims.batch_status', 'on', true);
    update public.product_batches b set status = 'released', hold_reason = null, status_changed_at = now(), status_changed_by = auth.uid()
      from public.recall_batches rb
     where rb.recall_id = r.id and b.product_id = r.product_id and b.status = 'recalled'
       and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date
       -- …unless another open recall still covers it.
       and not exists (select 1 from public.recall_batches rb2 join public.recalls r2 on r2.id = rb2.recall_id
                        where r2.status = 'open' and r2.product_id = b.product_id
                          and rb2.batch_number = b.batch_number and rb2.expiry_date is not distinct from b.expiry_date);
    perform set_config('ims.batch_status', '', true);
  end if;
  perform public.recall_log(r.id, 'closed_' || p_outcome, p_note);
  for a in select id from public.users where role in ('administrator','inventory_manager','staff') loop
    perform public.notify_user(a.id, r.recall_number || ' closed (' || p_outcome || ')',
      coalesce(r.product_name, '') || ' — ' || case p_outcome when 'withdrawn' then 'recall withdrawn, batches released for sale again.'
        else 'recall completed; remaining recalled stock stays blocked until written off.' end, '/traceability/recalls/' || r.id);
  end loop;
  return r;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. 2026-10-23_recall-sop
-- ═══════════════════════════════════════════════════════════════════════════

-- 2026-10-23 — IBG-QMS-SOP-008: product recall, defective product control & corrective action.
-- Run once in the Supabase SQL editor, AFTER 2026-10-23_approval-matrix.sql. Safe to re-run.
--
-- Builds on the traceability module (2026-10-23_traceability.sql) so the SOP's IMS functions exist:
--   * hold_records   (IBG-F02) — "Put on hold": any staff member, with a reason code and case link.
--                     Release only by a QRP-approver who is NOT the person who placed the hold;
--                     "Verify hold" tries a test sale and records that it was blocked (step B4).
--   * dispositions   (IBG-F11) — release / return to supplier / destruction / replacement-refund /
--                     correction. Return to supplier and destruction need Finance approval
--                     before the stock is written off.
--   * quality_cases  (IBG-F01 + IBG-F13) — complaints and nonconformities CMP-2026-001: intake,
--                     safety screen, QRP triage, HSA adverse-event reportability with the legal
--                     deadlines (48 h / 10 days / 30 days, final report 30 days), product-owner
--                     forwarding, investigation, closure.
--   * recalls        (IBG-F03/F04/F06/F07/F09/F12) — action type (stock recovery, field
--                     correction, recall, mock), risk matrix, HSA MDRR1/MDRR2/MDRR3 tracking,
--                     strategy, MD authorisation (QRP may activate alone for immediate safety
--                     containment), consignee log with acknowledgements + day 3 / 7 / weekly
--                     follow-ups, reconciliation, closure requested by QRP and approved by MD.
--   * capas          (IBG-F08) — CAPA-2026-001 register: problem, root cause, actions, plan
--                     approval, effectiveness check, closure by QRP.
--   * quality_reminders() — called when someone opens the IMS: notifies the right people about
--                     regulatory deadlines, overdue follow-ups, CAPA actions and old holds.
--
-- New approval types (Settings → Approvals): quality (QRP), recall_authorise (Managing Director),
-- finance (write-offs).

-- ── Approval types ──────────────────────────────────────────────────────────────
alter table public.approval_rules drop constraint if exists approval_rules_approval_type_check;
alter table public.approval_rules add constraint approval_rules_approval_type_check
  check (approval_type in ('purchase_order','quotation','invoice','cycle_count','batch_hold','recall',
                           'quality','recall_authorise','finance'));

create or replace function public.qms_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ims_role() in ('administrator','inventory_manager','staff'), false)
$$;
grant execute on function public.qms_staff() to authenticated;

-- CMP-2026-001, NC-2026-001, DSP-2026-001, CAPA-2026-001, RCL-2026-01, MOCK-2026-01
create or replace function public.qms_next_number(p_type text, p_prefix text, p_pad integer)
returns text language plpgsql security definer set search_path = public as $$
declare v_year integer := extract(year from current_date); v_n integer;
begin
  insert into public.doc_counters (doc_type, year, last) values (p_type, v_year, 1)
    on conflict (doc_type, year) do update set last = doc_counters.last + 1 returning last into v_n;
  return p_prefix || '-' || v_year || '-' || lpad(v_n::text, p_pad, '0');
end $$;
revoke execute on function public.qms_next_number(text, text, integer) from public, anon, authenticated;

create or replace function public.qms_notify(p_type text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select distinct id from public.ims_approvers(p_type) id loop
    perform public.notify_user(a.id, p_title, p_body, p_link);
  end loop;
end $$;
revoke execute on function public.qms_notify(text, text, text, text) from public, anon, authenticated;

-- ── Complaint / nonconformity cases (IBG-F01 + IBG-F13) ──────────────────────────────
create table if not exists public.quality_cases (
  id uuid primary key default uuid_generate_v4(),
  case_number text unique,
  kind text not null default 'complaint' check (kind in ('complaint','nonconformity')),
  status text not null default 'open' check (status in ('open','closed')),
  -- A. Intake
  received_at timestamptz not null default now(),
  received_by uuid references public.users(id) default auth.uid(),
  channel text,                 -- phone | email | ecommerce | sales_rep | internal | other
  reporter_name text,
  reporter_type text,           -- consumer | healthcare | retailer | internal | supplier
  reporter_contact text,
  order_ref text,
  -- B. Product
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  sku text,
  batch_number text,
  expiry_date date,
  serial_no text,
  qty_affected integer,
  purchase_date date,
  category text,                -- damaged | spoiled | malfunction | inaccurate | labelling | wrong_item | counterfeit | other
  evidence text[] not null default '{}',   -- photos | sample
  -- C. Event and safety screen
  description text not null,
  event_date date,
  used_on_patient text,         -- yes | no | unknown
  injury text,                  -- yes | no | unknown (injury, treatment or clinical decision on a reading)
  injury_details text,
  overheating text,             -- yes | no
  advice_given text,
  -- D. Initial assessment (QRP)
  valid boolean,
  invalid_reason text,
  triage text check (triage in ('critical','major','minor')),
  triaged_by uuid references public.users(id),
  triaged_at timestamptz,
  ae_required boolean,
  -- E. Product owner / supplier
  owner_forwarded_to text,
  owner_forwarded_at date,
  owner_ref text,
  owner_response_due date,
  -- F. Investigation
  findings text,
  no_investigation_reason text,
  -- G. Closure
  outcome text,
  capa_id uuid,
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  -- IBG-F13 Adverse event reportability and HSA submission
  ae_aware_at timestamptz,
  ae_reportable text check (ae_reportable in ('yes','no')),
  ae_category text check (ae_category in ('public_health','death_serious','could_recur')),
  ae_rationale text,
  ae_decided_by uuid references public.users(id),
  ae_decided_at timestamptz,
  ae_reviewed_by uuid references public.users(id),
  ae_reviewed_at timestamptz,
  ae_due_at timestamptz,
  ae_md_informed_at timestamptz,
  ae_owner_informed_at timestamptz,
  ae_submitted_at timestamptz,
  ae_hsa_ref text,
  ae_final_due date,
  ae_final_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quality_cases_product_idx on public.quality_cases (product_id, batch_number);

create or replace function public.quality_cases_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_qrp boolean := public.ims_can_approve('quality');
begin
  if tg_op = 'INSERT' then
    new.case_number := public.qms_next_number(case when new.kind = 'nonconformity' then 'nc_case' else 'complaint' end,
                                             case when new.kind = 'nonconformity' then 'NCR' else 'CMP' end, 3);
    new.status := 'open';
    new.received_by := coalesce(new.received_by, auth.uid());
    new.ae_aware_at := coalesce(new.ae_aware_at, new.received_at);
    if new.product_id is not null then
      select name, sku into new.product_name, new.sku from public.products where id = new.product_id;
    end if;
    -- QRP fields start empty unless the QRP logs the case.
    if not v_qrp then
      new.valid := null; new.triage := null; new.ae_required := null; new.ae_reportable := null;
      new.closed_by := null; new.closed_at := null;
    end if;
    -- SOP A6: any health effect or inaccurate-reading allegation always gets a IBG-F13 assessment.
    if new.injury in ('yes','unknown') or new.overheating = 'yes' or new.category = 'inaccurate' or new.used_on_patient = 'yes' then
      new.ae_required := true;
    end if;
  else
    if old.status = 'closed' and new.status = 'closed' then
      raise exception 'This case is closed — reopen it first';
    end if;
    if new.case_number is distinct from old.case_number or new.received_by is distinct from old.received_by then
      raise exception 'The case number and who logged it can''t be changed';
    end if;
    if not v_qrp and (
         new.valid is distinct from old.valid or new.invalid_reason is distinct from old.invalid_reason
      or new.triage is distinct from old.triage or new.ae_required is distinct from old.ae_required
      or new.ae_reportable is distinct from old.ae_reportable or new.ae_category is distinct from old.ae_category
      or new.ae_rationale is distinct from old.ae_rationale or new.no_investigation_reason is distinct from old.no_investigation_reason
      or new.status is distinct from old.status) then
      raise exception 'Only the QRP (Settings → Approvals → Complaints & CAPA) can assess, decide reportability or close a case';
    end if;
    if new.product_id is distinct from old.product_id and new.product_id is not null then
      select name, sku into new.product_name, new.sku from public.products where id = new.product_id;
    end if;
  end if;

  if tg_op = 'INSERT' or new.triage is distinct from old.triage then
    new.triaged_by := case when new.triage is null then null else auth.uid() end;
    new.triaged_at := case when new.triage is null then null else now() end;
  end if;
  if tg_op = 'INSERT' or new.ae_reportable is distinct from old.ae_reportable then
    new.ae_decided_by := case when new.ae_reportable is null then null else auth.uid() end;
    new.ae_decided_at := case when new.ae_reportable is null then null else now() end;
    new.ae_reviewed_by := null; new.ae_reviewed_at := null;
  elsif new.ae_reviewed_by is distinct from old.ae_reviewed_by then
    -- IBG-F13 Part B: a "not reportable" decision is reviewed by the Deputy QRP or the MD.
    if new.ae_reviewed_by is not null then
      if new.ae_reviewed_by <> auth.uid() then raise exception 'Record your own review'; end if;
      if auth.uid() = new.ae_decided_by then raise exception 'The decision must be reviewed by someone else (Deputy QRP or MD)'; end if;
      if not (v_qrp or public.ims_can_approve('recall_authorise')) then raise exception 'Only the QRP / Deputy QRP or MD can review the decision'; end if;
      new.ae_reviewed_at := now();
    else
      new.ae_reviewed_at := null;
    end if;
  end if;

  -- HSA deadlines run from awareness: 48 h / 10 days / 30 days; final report 30 days after the initial one.
  new.ae_due_at := case when new.ae_reportable = 'yes' then
      new.ae_aware_at + case new.ae_category when 'public_health' then interval '48 hours'
                                            when 'death_serious' then interval '10 days'
                                            when 'could_recur' then interval '30 days' end end;
  new.ae_final_due := case when new.ae_submitted_at is not null then (new.ae_submitted_at + interval '30 days')::date end;

  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    if new.valid is null then raise exception 'Decide whether the complaint is valid before closing'; end if;
    if new.valid = false and coalesce(trim(new.invalid_reason), '') = '' then raise exception 'Give the reason the complaint is not valid'; end if;
    if new.triage is null then raise exception 'Set the triage level before closing'; end if;
    if new.ae_required and new.ae_reportable is null then raise exception 'Decide HSA reportability (IBG-F13) before closing'; end if;
    if new.ae_reportable = 'no' and (coalesce(trim(new.ae_rationale), '') = '' or new.ae_reviewed_by is null) then
      raise exception 'A "not reportable" decision needs a rationale reviewed by the Deputy QRP or MD';
    end if;
    if new.ae_reportable = 'yes' and new.ae_submitted_at is null then raise exception 'Record the HSA submission before closing'; end if;
    if new.valid and coalesce(trim(new.findings), '') = '' and coalesce(trim(new.no_investigation_reason), '') = '' then
      raise exception 'Record the investigation findings, or why no investigation was done';
    end if;
    if coalesce(trim(new.outcome), '') = '' then raise exception 'Record the outcome and the customer response'; end if;
    new.closed_by := auth.uid(); new.closed_at := now();
  elsif new.status = 'open' then
    new.closed_by := null; new.closed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists quality_cases_before on public.quality_cases;
create trigger quality_cases_before before insert or update on public.quality_cases
  for each row execute function public.quality_cases_before();

create or replace function public.quality_cases_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_safety boolean := 'yes' in (coalesce(new.injury, ''), coalesce(new.overheating, ''))
                           or new.injury = 'unknown' or new.category = 'inaccurate';
begin
  if tg_op = 'INSERT' then
    perform public.qms_notify('quality',
      case when v_safety then 'URGENT ' else '' end || new.case_number || ' logged: ' || coalesce(new.product_name, 'product'),
      case when v_safety then 'Safety screen flagged (injury / clinical reading / overheating / inaccuracy) — escalate within 1 hour. ' else '' end
        || left(new.description, 200), '/traceability/cases/' || new.id);
    if v_safety then
      perform public.qms_notify('recall_authorise', 'URGENT ' || new.case_number || ': possible safety issue',
        coalesce(new.product_name, '') || ' — ' || left(new.description, 200), '/traceability/cases/' || new.id);
    end if;
  elsif new.ae_reportable = 'yes' and old.ae_reportable is distinct from 'yes' then
    -- IBG-F13 Part C: the MD is informed the same day.
    perform public.qms_notify('recall_authorise', new.case_number || ' is reportable to HSA',
      'Report due ' || to_char(new.ae_due_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || '. ' || coalesce(new.product_name, ''),
      '/traceability/cases/' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists quality_cases_after on public.quality_cases;
create trigger quality_cases_after after insert or update on public.quality_cases
  for each row execute function public.quality_cases_after();

-- ── CAPA (IBG-F08) ──────────────────────────────────────────────────────────────────
create table if not exists public.capas (
  id uuid primary key default uuid_generate_v4(),
  capa_number text unique,
  title text not null,
  source text not null default 'complaint'
    check (source in ('complaint','nonconformity','recall','adverse_event','audit','mock_recall','trend','other')),
  case_id uuid references public.quality_cases(id) on delete set null,
  recall_id uuid,
  linked_refs text,
  problem text,
  containment text,
  root_cause_method text,
  root_cause text,              -- I-BG's own contributing causes
  owner_root_cause text,        -- the product owner's root cause
  extent text,
  correction text,
  actions jsonb not null default '[]',   -- [{id, action, owner, due, done_at, evidence}]
  owner_id uuid references public.users(id),
  due_date date,
  plan_approved_by uuid references public.users(id),
  plan_approved_at timestamptz,
  effectiveness_measure text,
  effectiveness_due date,
  effectiveness_result text,
  effective boolean,
  status text not null default 'open' check (status in ('open','plan_approved','closed')),
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  reopened_as uuid,
  created_by uuid references public.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.capas_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_qrp boolean := public.ims_can_approve('quality');
begin
  if tg_op = 'INSERT' then
    new.capa_number := public.qms_next_number('capa', 'CAPA', 3);
    new.status := 'open'; new.plan_approved_by := null; new.plan_approved_at := null;
    new.closed_by := null; new.closed_at := null; new.created_by := coalesce(new.created_by, auth.uid());
  else
    if old.status = 'closed' and new.status = 'closed' and new.reopened_as is not distinct from old.reopened_as then
      raise exception 'This CAPA is closed';
    end if;
    if new.capa_number is distinct from old.capa_number then raise exception 'The CAPA number can''t be changed'; end if;
    if new.status is distinct from old.status then
      if not v_qrp then raise exception 'Only the QRP can approve the plan or close a CAPA'; end if;
      if new.status = 'plan_approved' then
        if coalesce(trim(new.root_cause), '') = '' then raise exception 'Record the root cause before approving the plan'; end if;
        if jsonb_array_length(new.actions) = 0 then raise exception 'Add at least one action'; end if;
        if coalesce(trim(new.effectiveness_measure), '') = '' or new.effectiveness_due is null then
          raise exception 'Define the effectiveness measure and when it is checked';
        end if;
        new.plan_approved_by := auth.uid(); new.plan_approved_at := now();
      elsif new.status = 'closed' then
        if old.status <> 'plan_approved' then raise exception 'Approve the plan first'; end if;
        if exists (select 1 from jsonb_array_elements(new.actions) a where coalesce(a->>'done_at', '') = '') then
          raise exception 'Every action needs to be done (with evidence) before closing';
        end if;
        if new.effective is null or coalesce(trim(new.effectiveness_result), '') = '' then
          raise exception 'Record the effectiveness check result';
        end if;
        new.closed_by := auth.uid(); new.closed_at := now();
      elsif new.status = 'open' then
        new.plan_approved_by := null; new.plan_approved_at := null; new.closed_by := null; new.closed_at := null;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists capas_before on public.capas;
create trigger capas_before before insert or update on public.capas
  for each row execute function public.capas_before();

create or replace function public.capas_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.qms_notify('quality', new.capa_number || ' opened', new.title, '/traceability/capa/' || new.id);
    if new.owner_id is not null then
      perform public.notify_user(new.owner_id, 'You own ' || new.capa_number, new.title, '/traceability/capa/' || new.id);
    end if;
    if new.case_id is not null then update public.quality_cases set capa_id = new.id where id = new.case_id and capa_id is null and status = 'open'; end if;
  elsif new.owner_id is distinct from old.owner_id and new.owner_id is not null then
    perform public.notify_user(new.owner_id, 'You own ' || new.capa_number, new.title, '/traceability/capa/' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists capas_after on public.capas;
create trigger capas_after after insert or update on public.capas
  for each row execute function public.capas_after();

-- ── Holds (IBG-F02) ─────────────────────────────────────────────────────────────────
alter table public.product_batches add column if not exists hold_code text;
alter table public.product_batches add column if not exists hold_id uuid;

create table if not exists public.hold_records (
  id uuid primary key default uuid_generate_v4(),
  nc_number text unique,
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  sku text,
  batch_number text not null default '',
  expiry_date date,
  qty integer not null default 0,
  reason_code text not null check (reason_code in ('COMPLAINT','DAMAGE','EXPIRY','ENV-EXCURSION','RECALL','INVESTIGATION','MOCK','OTHER')),
  reason text not null,
  case_id uuid references public.quality_cases(id) on delete set null,
  recall_id uuid,
  held_by uuid references public.users(id) default auth.uid(),
  held_at timestamptz not null default now(),
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  verify_result text,
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  close_note text,
  disposition_id uuid
);
create index if not exists hold_records_label_idx on public.hold_records (product_id, batch_number, expiry_date, status);

-- Every batch row of this label (a product can hold the same batch at several sites).
create or replace function public.hold_open(p_product uuid, p_batch_number text, p_expiry date, p_code text, p_reason text,
                                            p_case uuid, p_recall uuid, p_status text)
returns public.hold_records language plpgsql security definer set search_path = public as $$
declare h public.hold_records%rowtype; v_qty integer; p record;
begin
  select id, name, sku into p from public.products where id = p_product;
  select coalesce(sum(quantity), 0) into v_qty from public.product_batches
   where product_id = p_product and batch_number = p_batch_number and expiry_date is not distinct from p_expiry;
  insert into public.hold_records (nc_number, product_id, product_name, sku, batch_number, expiry_date, qty, reason_code, reason, case_id, recall_id)
  values (public.qms_next_number('nc', 'NC', 3), p.id, p.name, p.sku, p_batch_number, p_expiry, v_qty, p_code, trim(p_reason), p_case, p_recall)
  returning * into h;
  perform set_config('ims.batch_status', 'on', true);
  update public.product_batches set status = p_status, hold_code = p_code, hold_id = h.id,
         hold_reason = case when p_recall is not null then trim(p_reason) else p_code || ': ' || trim(p_reason) end,
         status_changed_at = now(), status_changed_by = auth.uid()
   where product_id = p_product and batch_number = p_batch_number and expiry_date is not distinct from p_expiry;
  perform set_config('ims.batch_status', '', true);
  insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
  select b.id, b.product_id, p.sku, b.batch_number, b.expiry_date, 0, b.quantity,
         case p_status when 'recalled' then 'Recalled' else 'Put on hold' end || ' — ' || h.nc_number || ' ' || p_code || ': ' || trim(p_reason)
    from public.product_batches b
   where b.product_id = p_product and b.batch_number = p_batch_number and b.expiry_date is not distinct from p_expiry;
  return h;
end $$;
revoke execute on function public.hold_open(uuid, text, date, text, text, uuid, uuid, text) from public, anon, authenticated;

-- "Put on hold" — any trained IMS user (SOP 7.3); the QRP is told the same day.
create or replace function public.batch_hold(p_batch uuid, p_code text, p_reason text, p_case uuid default null)
returns public.hold_records language plpgsql security definer set search_path = public as $$
declare b public.product_batches%rowtype; h public.hold_records%rowtype;
begin
  if not public.qms_staff() then raise exception 'Viewers can''t put stock on hold'; end if;
  if p_code is null or p_code not in ('COMPLAINT','DAMAGE','EXPIRY','ENV-EXCURSION','INVESTIGATION','OTHER') then
    raise exception 'Choose a hold reason code';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the hold'; end if;
  select * into b from public.product_batches where id = p_batch for update;
  if b.id is null then raise exception 'Batch not found'; end if;
  if b.status = 'recalled' then raise exception 'This batch is under recall already'; end if;
  if b.status = 'on_hold' then raise exception 'This batch is already on hold'; end if;
  h := public.hold_open(b.product_id, b.batch_number, b.expiry_date, p_code, p_reason, p_case, null, 'on_hold');
  perform public.qms_notify('batch_hold', 'On hold: ' || coalesce(h.product_name, '') || ' ' || coalesce(nullif(h.batch_number, ''), '(no batch no.)'),
    h.nc_number || ' · ' || p_code || ' — ' || left(trim(p_reason), 200), '/traceability?tab=holds');
  return h;
end $$;
grant execute on function public.batch_hold(uuid, text, text, uuid) to authenticated;

-- Close the open (non-recall) holds of a label, and set the batches' status from what is left.
create or replace function public.hold_settle(p_product uuid, p_batch_number text, p_expiry date, p_note text, p_disposition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h public.hold_records%rowtype; v_status text := 'released'; v_code text; v_reason text; v_hold uuid;
begin
  update public.hold_records set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = p_note,
         disposition_id = coalesce(p_disposition, disposition_id)
   where product_id = p_product and batch_number = p_batch_number and expiry_date is not distinct from p_expiry
     and status = 'open' and recall_id is null;
  -- An open recall on the label keeps it blocked.
  select hr.* into h from public.hold_records hr join public.recalls r on r.id = hr.recall_id
   where hr.product_id = p_product and hr.batch_number = p_batch_number and hr.expiry_date is not distinct from p_expiry
     and hr.status = 'open' and r.status = 'open'
   order by hr.held_at desc limit 1;
  if h.id is not null then
    v_status := case when (select stage from public.recalls where id = h.recall_id) in ('active','closure_pending')
                       and h.reason_code = 'RECALL' then 'recalled' else 'on_hold' end;
    v_code := h.reason_code; v_reason := h.reason; v_hold := h.id;
  end if;
  perform set_config('ims.batch_status', 'on', true);
  update public.product_batches set status = v_status, hold_code = v_code, hold_id = v_hold, hold_reason = v_reason,
         status_changed_at = now(), status_changed_by = auth.uid()
   where product_id = p_product and batch_number = p_batch_number and expiry_date is not distinct from p_expiry;
  perform set_config('ims.batch_status', '', true);
end $$;
revoke execute on function public.hold_settle(uuid, text, date, text, uuid) from public, anon, authenticated;

-- Step B4: try to allocate one unit to a test sale and confirm the system refuses it. Nothing is kept.
create or replace function public.hold_verify(p_hold uuid)
returns text language plpgsql security definer set search_path = public as $$
declare h public.hold_records%rowtype; b public.product_batches%rowtype; v_msg text; v_result text;
begin
  if not public.qms_staff() then raise exception 'Viewers can''t verify holds'; end if;
  select * into h from public.hold_records where id = p_hold for update;
  if h.id is null then raise exception 'Hold not found'; end if;
  if h.status <> 'open' then raise exception 'This hold is closed'; end if;
  select * into b from public.product_batches
   where product_id = h.product_id and batch_number = h.batch_number and expiry_date is not distinct from h.expiry_date
     and quantity > 0 limit 1;
  if b.id is null then
    v_result := 'No stock left on this batch — nothing to allocate';
  else
    begin
      perform public.ims_move_stock(b.product_id, null, -1, 'outbound', 'Hold verification (test, rolled back)',
                                    null, null, null, null, null, b.id);
      raise exception 'HOLD_NOT_BLOCKING';
    exception when others then v_msg := sqlerrm;
    end;
    v_result := case when v_msg = 'HOLD_NOT_BLOCKING' then 'FAILED — a test sale was accepted (nothing was kept)'
                     else 'Blocked: ' || v_msg end;
  end if;
  update public.hold_records set verified_by = auth.uid(), verified_at = now(), verify_result = v_result where id = h.id;
  if v_result like 'FAILED%' then
    perform public.qms_notify('quality', 'HOLD FAILURE ' || h.nc_number, 'A test sale of a held batch was accepted. Open a CAPA.', '/traceability?tab=holds');
  end if;
  return v_result;
end $$;
grant execute on function public.hold_verify(uuid) to authenticated;

-- ── Dispositions (IBG-F11) ──────────────────────────────────────────────────────────
create table if not exists public.dispositions (
  id uuid primary key default uuid_generate_v4(),
  disp_number text unique,
  kind text not null check (kind in ('release','return_to_supplier','destruction','replacement_refund','correction')),
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  sku text,
  batch_number text not null default '',
  expiry_date date,
  qty integer not null default 0,
  location_id uuid references public.stock_locations(id),
  hold_id uuid references public.hold_records(id),
  case_id uuid references public.quality_cases(id) on delete set null,
  recall_id uuid,
  rationale text not null,
  evidence text,
  status text not null default 'done' check (status in ('pending_finance','done','rejected')),
  requested_by uuid references public.users(id) default auth.uid(),
  requested_at timestamptz not null default now(),
  finance_by uuid references public.users(id),
  finance_at timestamptz,
  finance_note text,
  transaction_id uuid references public.transactions(id) on delete set null
);

-- p_kind release: the hold ends (QRP only, never the person who placed the hold).
--        return_to_supplier / destruction: QRP requests, Finance approves, then the units are written off.
--        replacement_refund / correction: recorded against the case / recall (no stock change here).
create or replace function public.disposition_record(p_product uuid, p_batch_number text, p_expiry date, p_kind text,
    p_qty integer, p_rationale text, p_evidence text default null, p_case uuid default null, p_recall uuid default null,
    p_location uuid default null)
returns public.dispositions language plpgsql security definer set search_path = public as $$
declare d public.dispositions%rowtype; p record; v_status text; v_onhand integer; v_holder uuid; v_hold uuid;
begin
  if not public.ims_can_approve('batch_hold') then
    raise exception 'Only the QRP can decide a disposition (Settings → Approvals → Hold release & disposition)';
  end if;
  if p_kind not in ('release','return_to_supplier','destruction','replacement_refund','correction') then raise exception 'Unknown disposition %', p_kind; end if;
  if coalesce(trim(p_rationale), '') = '' then raise exception 'Give the rationale / inspection result'; end if;
  select id, name, sku into p from public.products where id = p_product;
  if p.id is null then raise exception 'Product not found'; end if;
  p_batch_number := trim(coalesce(p_batch_number, ''));
  select coalesce(sum(quantity), 0), max(status) filter (where status <> 'released')
    into v_onhand, v_status from public.product_batches
   where product_id = p_product and batch_number = p_batch_number and expiry_date is not distinct from p_expiry;

  if p_kind = 'release' then
    if v_status is null then raise exception 'This batch isn''t on hold'; end if;
    if exists (select 1 from public.hold_records hr join public.recalls r on r.id = hr.recall_id
                where hr.product_id = p_product and hr.batch_number = p_batch_number and hr.expiry_date is not distinct from p_expiry
                  and hr.status = 'open' and r.status = 'open') then
      raise exception 'This batch is part of an open recall — it is released only when the recall is withdrawn';
    end if;
    select hr.held_by, hr.id into v_holder, v_hold from public.hold_records hr
     where hr.product_id = p_product and hr.batch_number = p_batch_number and hr.expiry_date is not distinct from p_expiry and hr.status = 'open'
     order by hr.held_at desc limit 1;
    if v_holder is null then
      select status_changed_by into v_holder from public.product_batches
       where product_id = p_product and batch_number = p_batch_number and expiry_date is not distinct from p_expiry limit 1;
    end if;
    if v_holder = auth.uid() then raise exception 'The person who placed the hold can''t release it — another QRP-approver must'; end if;
  elsif p_kind in ('return_to_supplier','destruction') then
    if v_status is null then raise exception 'Put the batch on hold first — only held or recalled stock is returned or destroyed'; end if;
    if p_qty is null or p_qty <= 0 then raise exception 'Enter the quantity'; end if;
    if p_qty > v_onhand then raise exception 'Only % unit(s) of this batch are in stock', v_onhand; end if;
    if exists (select 1 from public.product_stock where product_id = p_product) and p_location is null then
      raise exception 'Choose the site the units are taken from';
    end if;
  elsif p_kind = 'correction' and coalesce(trim(p_evidence), '') = '' then
    raise exception 'A correction needs the product owner''s written authorisation (reference)';
  end if;

  insert into public.dispositions (disp_number, kind, product_id, product_name, sku, batch_number, expiry_date, qty, location_id,
                                   hold_id, case_id, recall_id, rationale, evidence, status)
  values (public.qms_next_number('disposition', 'DSP', 3), p_kind, p.id, p.name, p.sku, p_batch_number, p_expiry,
          case when p_kind = 'release' then v_onhand else coalesce(p_qty, 0) end, p_location,
          coalesce(v_hold, (select id from public.hold_records where product_id = p_product and batch_number = p_batch_number
                              and expiry_date is not distinct from p_expiry and status = 'open' order by held_at desc limit 1)),
          p_case, p_recall, trim(p_rationale), nullif(trim(coalesce(p_evidence, '')), ''),
          case when p_kind in ('return_to_supplier','destruction') then 'pending_finance' else 'done' end)
  returning * into d;

  if p_kind = 'release' then
    perform public.hold_settle(p_product, p_batch_number, p_expiry, 'Released — ' || d.disp_number, d.id);
    insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
    select b.id, b.product_id, p.sku, b.batch_number, b.expiry_date, 0, b.quantity, 'Released from hold — ' || d.disp_number || ': ' || trim(p_rationale)
      from public.product_batches b
     where b.product_id = p_product and b.batch_number = p_batch_number and b.expiry_date is not distinct from p_expiry;
  elsif d.status = 'pending_finance' then
    perform public.qms_notify('finance', 'Write-off to approve: ' || d.disp_number,
      replace(p_kind, '_', ' ') || ' · ' || d.qty || ' × ' || coalesce(p.name, '') || ' ' || coalesce(nullif(p_batch_number, ''), ''),
      '/traceability?tab=holds');
  end if;
  return d;
end $$;
grant execute on function public.disposition_record(uuid, text, date, text, integer, text, text, uuid, uuid, uuid) to authenticated;

create or replace function public.disposition_finance(p_disp uuid, p_approve boolean, p_note text default null)
returns public.dispositions language plpgsql security definer set search_path = public as $$
declare d public.dispositions%rowtype; v_left integer := 0; b record; v_take integer; v_tx uuid; v_note text;
begin
  if not public.ims_can_approve('finance') then raise exception 'Only Finance approvers can approve write-offs (Settings → Approvals)'; end if;
  select * into d from public.dispositions where id = p_disp for update;
  if d.id is null then raise exception 'Disposition not found'; end if;
  if d.status <> 'pending_finance' then raise exception 'Already decided'; end if;
  if d.requested_by = auth.uid() then raise exception 'The person who requested the write-off can''t approve it'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why it is rejected'; end if;
    update public.dispositions set status = 'rejected', finance_by = auth.uid(), finance_at = now(), finance_note = trim(p_note)
     where id = d.id returning * into d;
    perform public.notify_user(d.requested_by, d.disp_number || ' rejected by Finance', trim(p_note), '/traceability?tab=holds');
    return d;
  end if;
  v_note := initcap(replace(d.kind, '_', ' ')) || ' ' || d.disp_number || ' — ' || d.rationale || coalesce(' · ' || d.evidence, '');
  v_left := d.qty;
  -- Take the units from the batch rows of this label (held / recalled ones).
  for b in select id, quantity from public.product_batches
            where product_id = d.product_id and batch_number = d.batch_number and expiry_date is not distinct from d.expiry_date
            order by quantity desc loop
    exit when v_left <= 0;
    v_take := least(v_left, b.quantity);
    perform public.ims_move_stock(d.product_id, d.location_id, -v_take, 'adjustment', v_note, null, null, null, null, null, b.id);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'Only % unit(s) of this batch are left in stock', d.qty - v_left; end if;
  select id into v_tx from public.transactions where product_id = d.product_id and notes = v_note order by created_at desc limit 1;
  update public.dispositions set status = 'done', finance_by = auth.uid(), finance_at = now(), finance_note = nullif(trim(coalesce(p_note, '')), ''),
         transaction_id = v_tx where id = d.id returning * into d;
  -- Nothing left of the batch → its holds are settled by this disposition.
  if not exists (select 1 from public.product_batches where product_id = d.product_id and batch_number = d.batch_number
                   and expiry_date is not distinct from d.expiry_date) then
    update public.hold_records set status = 'closed', closed_by = auth.uid(), closed_at = now(),
           close_note = 'All units disposed — ' || d.disp_number, disposition_id = d.id
     where product_id = d.product_id and batch_number = d.batch_number and expiry_date is not distinct from d.expiry_date
       and status = 'open' and (recall_id is null or recall_id = d.recall_id);
  end if;
  perform public.notify_user(d.requested_by, d.disp_number || ' approved — stock written off', d.qty || ' unit(s) ' || replace(d.kind, '_', ' '), '/traceability?tab=holds');
  return d;
end $$;
grant execute on function public.disposition_finance(uuid, boolean, text) to authenticated;

-- Old entry point (Batches & expiry panel): hold → OTHER code, release → disposition.
drop function if exists public.batch_set_status(uuid, text, text);
create or replace function public.batch_set_status(p_batch uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.product_batches%rowtype;
begin
  if p_status = 'on_hold' then
    perform public.batch_hold(p_batch, 'OTHER', p_reason, null);
  elsif p_status = 'released' then
    select * into b from public.product_batches where id = p_batch;
    if b.id is null then raise exception 'Batch not found'; end if;
    perform public.disposition_record(b.product_id, b.batch_number, b.expiry_date, 'release', null,
      coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Released after inspection'));
  else
    raise exception 'Use a recall to recall a batch';
  end if;
end $$;
grant execute on function public.batch_set_status(uuid, text, text) to authenticated;

-- ── Recalls / FSCA (IBG-F03, F04, F06, F07, F09, F12) and mock recalls (IBG-F10) ─────────
alter table public.recalls add column if not exists action_type text not null default 'recall';
alter table public.recalls add column if not exists stage text not null default 'active';
alter table public.recalls add column if not exists case_id uuid references public.quality_cases(id) on delete set null;
alter table public.recalls add column if not exists capa_id uuid references public.capas(id) on delete set null;
alter table public.recalls add column if not exists triage text;
alter table public.recalls add column if not exists risk_severity text;
alter table public.recalls add column if not exists risk_probability text;
alter table public.recalls add column if not exists assessment jsonb not null default '{}';
alter table public.recalls add column if not exists strategy jsonb not null default '{}';
alter table public.recalls add column if not exists recon jsonb not null default '{}';
alter table public.recalls add column if not exists closure jsonb not null default '{}';
alter table public.recalls add column if not exists mock jsonb not null default '{}';
alter table public.recalls add column if not exists hsa_report text;
alter table public.recalls add column if not exists hsa_none_reason text;
alter table public.recalls add column if not exists oscar_submitted_at timestamptz;
alter table public.recalls add column if not exists hsa_ack_ref text;
alter table public.recalls add column if not exists consumer_level boolean;
alter table public.recalls add column if not exists prelim_requested boolean not null default false;
alter table public.recalls add column if not exists prelim_submitted_at timestamptz;
alter table public.recalls add column if not exists mdrr2_submitted_at timestamptz;
alter table public.recalls add column if not exists hsa_completion_at timestamptz;
alter table public.recalls add column if not exists hsa_completion_ref text;
alter table public.recalls add column if not exists commenced_at timestamptz;
alter table public.recalls add column if not exists immediate_containment boolean not null default false;
alter table public.recalls add column if not exists authorised_by uuid references public.users(id);
alter table public.recalls add column if not exists authorised_at timestamptz;
alter table public.recalls add column if not exists authorisation_note text;
alter table public.recalls add column if not exists closure_requested_by uuid references public.users(id);
alter table public.recalls add column if not exists closure_requested_at timestamptz;
alter table public.recalls add column if not exists closure_outcome text;
alter table public.recalls add column if not exists closure_approved_by uuid references public.users(id);
alter table public.recalls add column if not exists closure_approved_at timestamptz;
do $$ begin
  alter table public.recalls add constraint recalls_action_type_check check (action_type in ('stock_recovery','field_correction','recall','mock'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.recalls add constraint recalls_stage_check check (stage in ('awaiting_authorisation','active','closure_pending','closed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.recalls add constraint recalls_triage_check check (triage in ('critical','major','minor'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.recalls add constraint recalls_hsa_report_check check (hsa_report in ('MDRR1','MDRR3','none'));
exception when duplicate_object then null; end $$;
alter table public.recalls drop constraint if exists recalls_outcome_check;
alter table public.recalls add constraint recalls_outcome_check check (outcome in ('completed','withdrawn','mock'));
update public.recalls set stage = 'closed' where status = 'closed' and stage <> 'closed';
update public.recalls set commenced_at = created_at where commenced_at is null and action_type <> 'mock';

alter table public.recall_followups alter column transaction_id drop not null;
alter table public.recall_followups add column if not exists consignee_name text;
alter table public.recall_followups add column if not exists consignee_contact text;
alter table public.recall_followups add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.recall_followups add column if not exists qty_supplied integer;
alter table public.recall_followups add column if not exists notice_sent_at timestamptz;
alter table public.recall_followups add column if not exists notice_channel text;
alter table public.recall_followups add column if not exists delivery_proof text;
alter table public.recall_followups add column if not exists ack_at timestamptz;
alter table public.recall_followups add column if not exists qty_held integer;
alter table public.recall_followups add column if not exists qty_corrected integer not null default 0;
alter table public.recall_followups add column if not exists qty_destroyed integer not null default 0;
alter table public.recall_followups add column if not exists qty_documented integer not null default 0;
alter table public.recall_followups add column if not exists onward_supply text;
alter table public.recall_followups add column if not exists chases jsonb not null default '[]';
alter table public.recall_followups add column if not exists created_at timestamptz not null default now();
alter table public.recall_followups drop constraint if exists recall_followups_status_check;
alter table public.recall_followups add constraint recall_followups_status_check
  check (status in ('pending','notified','acknowledged','returned','unreachable','not_affected'));

-- New stock of a batch under an open recall arrives blocked (e.g. a customer return).
create or replace function public.product_batches_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_stage text; v_hold uuid; v_code text;
begin
  if tg_op = 'INSERT' then
    select r.stage, hr.id, hr.reason_code into v_stage, v_hold, v_code
      from public.recall_batches rb join public.recalls r on r.id = rb.recall_id
      left join public.hold_records hr on hr.recall_id = r.id and hr.status = 'open'
             and hr.product_id = new.product_id and hr.batch_number = new.batch_number and hr.expiry_date is not distinct from new.expiry_date
     where r.status = 'open' and r.product_id = new.product_id
       and rb.batch_number = new.batch_number and rb.expiry_date is not distinct from new.expiry_date
     order by r.created_at desc limit 1;
    if v_stage is not null then
      new.status := case when v_stage in ('active','closure_pending') and coalesce(v_code, 'RECALL') = 'RECALL' then 'recalled' else 'on_hold' end;
      new.hold_reason := coalesce(new.hold_reason, 'Under recall');
      new.hold_id := v_hold; new.hold_code := coalesce(v_code, 'RECALL');
    else
      -- …or under an open hold.
      select hr.id, hr.reason_code, hr.reason into v_hold, v_code, new.hold_reason from public.hold_records hr
       where hr.status = 'open' and hr.recall_id is null and hr.product_id = new.product_id
         and hr.batch_number = new.batch_number and hr.expiry_date is not distinct from new.expiry_date
       order by hr.held_at desc limit 1;
      if v_hold is not null then
        new.status := 'on_hold'; new.hold_id := v_hold; new.hold_code := v_code;
        new.hold_reason := v_code || ': ' || new.hold_reason;
      elsif coalesce(current_setting('ims.batch_status', true), '') <> 'on' then
        new.status := 'released'; new.hold_reason := null; new.hold_id := null; new.hold_code := null;
      end if;
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('ims.batch_status', true), '') <> 'on' then
    raise exception 'Use Hold / Release or a recall to change a batch''s status';
  end if;
  return new;
end $$;

-- Put every batch of a recall into p_status (on_hold while awaiting authorisation or for a mock,
-- recalled once active, released when withdrawn / a mock ends).
create or replace function public.recall_apply(p_recall uuid, p_status text)
returns integer language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; rb record; v_n integer := 0; v_q integer; v_code text; h public.hold_records%rowtype;
begin
  select * into r from public.recalls where id = p_recall;
  v_code := case when r.action_type = 'mock' then 'MOCK' else 'RECALL' end;
  for rb in select * from public.recall_batches where recall_id = r.id loop
    select coalesce(sum(quantity), 0) into v_q from public.product_batches
     where product_id = r.product_id and batch_number = rb.batch_number and expiry_date is not distinct from rb.expiry_date;
    v_n := v_n + v_q;
    if p_status = 'released' then
      update public.hold_records set status = 'closed', closed_by = auth.uid(), closed_at = now(),
             close_note = case r.action_type when 'mock' then 'Mock recall ended' else 'Recall withdrawn' end || ' — ' || r.recall_number
       where recall_id = r.id and product_id = r.product_id and batch_number = rb.batch_number
         and expiry_date is not distinct from rb.expiry_date and status = 'open';
      perform public.hold_settle(r.product_id, rb.batch_number, rb.expiry_date, null, null);
      insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
      select b.id, b.product_id, r.sku, b.batch_number, b.expiry_date, 0, b.quantity,
             case b.status when 'released' then 'Released' else 'Still blocked' end || ' — ' || r.recall_number || ' ended'
        from public.product_batches b
       where b.product_id = r.product_id and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date;
    else
      select * into h from public.hold_records where recall_id = r.id and product_id = r.product_id and batch_number = rb.batch_number
         and expiry_date is not distinct from rb.expiry_date and status = 'open' limit 1;
      if h.id is null then
        perform public.hold_open(r.product_id, rb.batch_number, rb.expiry_date, v_code,
          case when p_status = 'recalled' then 'Recall ' else case when v_code = 'MOCK' then 'Mock recall ' else 'Recall (awaiting authorisation) ' end end || r.recall_number,
          r.case_id, r.id, p_status);
      else
        perform set_config('ims.batch_status', 'on', true);
        update public.product_batches set status = p_status, hold_code = v_code, hold_id = h.id,
               hold_reason = case when p_status = 'recalled' then 'Recall ' || r.recall_number else h.reason end,
               status_changed_at = now(), status_changed_by = auth.uid()
         where product_id = r.product_id and batch_number = rb.batch_number and expiry_date is not distinct from rb.expiry_date;
        perform set_config('ims.batch_status', '', true);
        update public.hold_records set reason = 'Recall ' || r.recall_number where id = h.id and p_status = 'recalled';
        insert into public.batch_movements (batch_id, product_id, sku, batch_number, expiry_date, delta, balance, note)
        select b.id, b.product_id, r.sku, b.batch_number, b.expiry_date, 0, b.quantity, 'Recalled — ' || r.recall_number
          from public.product_batches b
         where b.product_id = r.product_id and b.batch_number = rb.batch_number and b.expiry_date is not distinct from rb.expiry_date;
      end if;
    end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public.recall_apply(uuid, text) from public, anon, authenticated;

-- p_action_type: recall | stock_recovery | field_correction | mock
-- p_immediate: QRP activates at once for immediate safety containment (MD authorises afterwards).
drop function if exists public.recall_open(text, text, text, text, uuid, jsonb);
create or replace function public.recall_open(p_title text, p_reason text, p_source text, p_severity text,
                                              p_product uuid, p_batches jsonb, p_action_type text default 'recall',
                                              p_triage text default null, p_case uuid default null, p_immediate boolean default false)
returns public.recalls
language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; p record; v_onhand integer; a record; v_labels text; v_mock boolean := p_action_type = 'mock';
begin
  if not public.ims_can_approve('recall') then raise exception 'You''re not allowed to open recalls — ask an Administrator (Settings → Approvals)'; end if;
  if p_action_type not in ('recall','stock_recovery','field_correction','mock') then raise exception 'Unknown action type %', p_action_type; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason'; end if;
  if coalesce(jsonb_array_length(p_batches), 0) = 0 then raise exception 'Choose at least one batch'; end if;
  select id, name, sku into p from public.products where id = p_product;
  if p.id is null then raise exception 'Product not found'; end if;

  insert into public.recalls (recall_number, title, reason, source, severity, product_id, product_name, sku,
                              action_type, stage, triage, case_id, immediate_containment, commenced_at)
  values (case when v_mock then public.qms_next_number('mock_recall', 'MOCK', 2) else public.qms_next_number('recall', 'RCL', 2) end,
          coalesce(nullif(trim(p_title), ''), case when v_mock then 'Mock recall — ' else 'Recall — ' end || p.name),
          trim(p_reason), coalesce(p_source, 'internal'),
          case p_triage when 'critical' then 'class_1' when 'minor' then 'class_3' else coalesce(p_severity, 'class_2') end,
          p.id, p.name, p.sku, p_action_type,
          case when v_mock or p_immediate then 'active' else 'awaiting_authorisation' end,
          p_triage, p_case, (not v_mock and p_immediate), case when not v_mock and p_immediate then now() end)
  returning * into r;

  insert into public.recall_batches (recall_id, batch_number, expiry_date)
  select r.id, trim(coalesce(x->>'batch_number', '')), nullif(x->>'expiry_date', '')::date
    from jsonb_array_elements(p_batches) x
  on conflict do nothing;

  -- Containment straight away: on hold (awaiting MD authorisation / mock test hold) or recalled.
  v_onhand := public.recall_apply(r.id, case when not v_mock and p_immediate then 'recalled' else 'on_hold' end);
  update public.recalls set units_on_hand_at_start = v_onhand where id = r.id returning * into r;

  select string_agg(coalesce(nullif(batch_number, ''), '(no number)') || coalesce(' exp ' || to_char(expiry_date, 'DD Mon YYYY'), ''), ', ')
    into v_labels from public.recall_batches where recall_id = r.id;
  perform public.recall_log(r.id, 'opened', v_labels || ' · ' || v_onhand || ' unit(s) in stock blocked'
    || case when v_mock then ' (test hold)' when p_immediate then ' · activated at once for immediate safety containment' else ' · awaiting MD authorisation' end);
  if v_mock then return r; end if;   -- unannounced exercise: no broadcast
  -- Everyone who can move stock must know not to ship it.
  for a in select id from public.users where role in ('administrator','inventory_manager','staff') loop
    perform public.notify_user(a.id, case when p_immediate then 'RECALL ' else 'STOP SALE ' end || r.recall_number || ': ' || p.name,
      'Do not sell or ship batch ' || v_labels || '. ' || left(trim(p_reason), 200), '/traceability/recalls/' || r.id);
  end loop;
  if not p_immediate then
    perform public.qms_notify('recall_authorise', 'Authorise ' || r.recall_number, 'Recall strategy for ' || p.name || ' needs your authorisation (IBG-F04).', '/traceability/recalls/' || r.id);
  end if;
  return r;
end $$;
grant execute on function public.recall_open(text, text, text, text, uuid, jsonb, text, text, uuid, boolean) to authenticated;

-- IBG-F04 Part D: the MD authorises the strategy (activates the recall if not yet active).
create or replace function public.recall_authorise(p_recall uuid, p_note text default null)
returns public.recalls language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; a record;
begin
  if not public.ims_can_approve('recall_authorise') then raise exception 'Only the Managing Director can authorise a recall (Settings → Approvals)'; end if;
  select * into r from public.recalls where id = p_recall for update;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.action_type = 'mock' then raise exception 'Mock recalls aren''t authorised'; end if;
  if r.status <> 'open' then raise exception 'This recall is closed'; end if;
  if r.authorised_at is not null then raise exception 'Already authorised'; end if;
  if r.created_by = auth.uid() then raise exception 'The QRP who recommended the recall can''t also authorise it'; end if;
  update public.recalls set authorised_by = auth.uid(), authorised_at = now(), authorisation_note = nullif(trim(coalesce(p_note, '')), ''),
         stage = case when stage = 'awaiting_authorisation' then 'active' else stage end,
         commenced_at = coalesce(commenced_at, now()), updated_at = now()
   where id = r.id returning * into r;
  perform public.recall_apply(r.id, 'recalled');
  perform public.recall_log(r.id, 'authorised', p_note);
  for a in select id from public.users where role in ('administrator','inventory_manager','staff') loop
    perform public.notify_user(a.id, 'RECALL ' || r.recall_number || ' authorised', coalesce(r.product_name, '') || ' — recall status active. Send notices within 24 h.', '/traceability/recalls/' || r.id);
  end loop;
  return r;
end $$;
grant execute on function public.recall_authorise(uuid, text) to authenticated;

-- QRP alone, for immediate safety containment before the MD has authorised.
create or replace function public.recall_activate(p_recall uuid, p_note text)
returns public.recalls language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype;
begin
  if not public.ims_can_approve('recall') then raise exception 'Only the QRP can activate a recall'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why activation can''t wait for the MD'; end if;
  select * into r from public.recalls where id = p_recall for update;
  if r.id is null or r.status <> 'open' then raise exception 'Recall not open'; end if;
  if r.stage <> 'awaiting_authorisation' then raise exception 'Already active'; end if;
  update public.recalls set stage = 'active', immediate_containment = true, commenced_at = now(), updated_at = now()
   where id = r.id returning * into r;
  perform public.recall_apply(r.id, 'recalled');
  perform public.recall_log(r.id, 'activated', 'Immediate safety containment — ' || trim(p_note));
  perform public.qms_notify('recall_authorise', r.recall_number || ' activated for immediate containment',
    'Authorise the strategy (IBG-F04): ' || trim(p_note), '/traceability/recalls/' || r.id);
  return r;
end $$;
grant execute on function public.recall_activate(uuid, text) to authenticated;

-- Assessment, regulatory record, strategy, reconciliation, closure details, mock results (QRP).
create or replace function public.recall_update(p_recall uuid, p_patch jsonb)
returns public.recalls language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; k text;
begin
  if not public.ims_can_approve('recall') then raise exception 'Only the QRP can edit the recall record'; end if;
  select * into r from public.recalls where id = p_recall for update;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.status <> 'open' then raise exception 'This recall is closed'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title','triage','risk_severity','risk_probability','assessment','strategy','recon','closure','mock','hsa_report','hsa_none_reason',
                 'oscar_submitted_at','hsa_ack_ref','consumer_level','prelim_requested','prelim_submitted_at','mdrr2_submitted_at',
                 'hsa_completion_at','hsa_completion_ref','capa_id','case_id') then
      raise exception 'Can''t change %', k;
    end if;
  end loop;
  update public.recalls set
    title = case when p_patch ? 'title' then coalesce(nullif(trim(p_patch->>'title'), ''), title) else title end,
    triage = case when p_patch ? 'triage' then p_patch->>'triage' else triage end,
    severity = case when p_patch ? 'triage' then case p_patch->>'triage' when 'critical' then 'class_1' when 'minor' then 'class_3' when 'major' then 'class_2' else severity end else severity end,
    risk_severity = case when p_patch ? 'risk_severity' then p_patch->>'risk_severity' else risk_severity end,
    risk_probability = case when p_patch ? 'risk_probability' then p_patch->>'risk_probability' else risk_probability end,
    assessment = case when p_patch ? 'assessment' then assessment || (p_patch->'assessment') else assessment end,
    strategy = case when p_patch ? 'strategy' then strategy || (p_patch->'strategy') else strategy end,
    recon = case when p_patch ? 'recon' then recon || (p_patch->'recon') else recon end,
    closure = case when p_patch ? 'closure' then closure || (p_patch->'closure') else closure end,
    mock = case when p_patch ? 'mock' then mock || (p_patch->'mock') else mock end,
    hsa_report = case when p_patch ? 'hsa_report' then nullif(p_patch->>'hsa_report', '') else hsa_report end,
    hsa_none_reason = case when p_patch ? 'hsa_none_reason' then p_patch->>'hsa_none_reason' else hsa_none_reason end,
    oscar_submitted_at = case when p_patch ? 'oscar_submitted_at' then nullif(p_patch->>'oscar_submitted_at', '')::timestamptz else oscar_submitted_at end,
    hsa_ack_ref = case when p_patch ? 'hsa_ack_ref' then p_patch->>'hsa_ack_ref' else hsa_ack_ref end,
    consumer_level = case when p_patch ? 'consumer_level' then (p_patch->>'consumer_level')::boolean else consumer_level end,
    prelim_requested = case when p_patch ? 'prelim_requested' then coalesce((p_patch->>'prelim_requested')::boolean, false) else prelim_requested end,
    prelim_submitted_at = case when p_patch ? 'prelim_submitted_at' then nullif(p_patch->>'prelim_submitted_at', '')::timestamptz else prelim_submitted_at end,
    mdrr2_submitted_at = case when p_patch ? 'mdrr2_submitted_at' then nullif(p_patch->>'mdrr2_submitted_at', '')::timestamptz else mdrr2_submitted_at end,
    hsa_completion_at = case when p_patch ? 'hsa_completion_at' then nullif(p_patch->>'hsa_completion_at', '')::timestamptz else hsa_completion_at end,
    hsa_completion_ref = case when p_patch ? 'hsa_completion_ref' then p_patch->>'hsa_completion_ref' else hsa_completion_ref end,
    capa_id = case when p_patch ? 'capa_id' then nullif(p_patch->>'capa_id', '')::uuid else capa_id end,
    case_id = case when p_patch ? 'case_id' then nullif(p_patch->>'case_id', '')::uuid else case_id end,
    updated_at = now()
   where id = r.id returning * into r;
  return r;
end $$;
grant execute on function public.recall_update(uuid, jsonb) to authenticated;

-- IBG-F06: one consignee row (a tracked shipment, or a consignee added by hand). Staff can do this.
-- p_data keys: consignee_name, consignee_contact, customer_id, qty_supplied, status, note, notice_sent_at,
-- notice_channel, delivery_proof, ack_at, qty_held, qty_corrected, qty_destroyed, qty_documented,
-- onward_supply, chase {channel, note} (appends a follow-up attempt).
create or replace function public.recall_consignee_save(p_recall uuid, p_id uuid, p_transaction uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; f public.recall_followups%rowtype; v_id uuid := p_id; v_status text;
begin
  if not public.qms_staff() then raise exception 'Viewers can''t update a recall'; end if;
  select * into r from public.recalls where id = p_recall;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.status <> 'open' then raise exception 'This recall is closed'; end if;
  v_status := p_data->>'status';
  if v_status is not null and v_status not in ('pending','notified','acknowledged','returned','unreachable','not_affected') then
    raise exception 'Unknown status %', v_status;
  end if;
  if v_id is null and p_transaction is not null then
    select id into v_id from public.recall_followups where recall_id = r.id and transaction_id = p_transaction;
  end if;
  if v_id is null then
    if p_transaction is null and coalesce(trim(p_data->>'consignee_name'), '') = '' then raise exception 'Enter the consignee'; end if;
    insert into public.recall_followups (recall_id, transaction_id, status, updated_by)
    values (r.id, p_transaction, 'pending', auth.uid()) returning id into v_id;
  end if;
  select * into f from public.recall_followups where id = v_id and recall_id = r.id for update;
  if f.id is null then raise exception 'Consignee not found'; end if;
  update public.recall_followups set
    consignee_name = case when p_data ? 'consignee_name' then nullif(trim(p_data->>'consignee_name'), '') else consignee_name end,
    consignee_contact = case when p_data ? 'consignee_contact' then nullif(trim(p_data->>'consignee_contact'), '') else consignee_contact end,
    customer_id = case when p_data ? 'customer_id' then nullif(p_data->>'customer_id', '')::uuid else customer_id end,
    qty_supplied = case when p_data ? 'qty_supplied' then nullif(p_data->>'qty_supplied', '')::integer else qty_supplied end,
    status = coalesce(v_status, case when p_data ? 'ack_at' and nullif(p_data->>'ack_at', '') is not null and status in ('pending','notified') then 'acknowledged'
                                     when p_data ? 'notice_sent_at' and nullif(p_data->>'notice_sent_at', '') is not null and status = 'pending' then 'notified'
                                     else status end),
    note = case when p_data ? 'note' then nullif(trim(p_data->>'note'), '') else note end,
    notice_sent_at = case when p_data ? 'notice_sent_at' then nullif(p_data->>'notice_sent_at', '')::timestamptz else notice_sent_at end,
    notice_channel = case when p_data ? 'notice_channel' then nullif(p_data->>'notice_channel', '') else notice_channel end,
    delivery_proof = case when p_data ? 'delivery_proof' then nullif(trim(p_data->>'delivery_proof'), '') else delivery_proof end,
    ack_at = case when p_data ? 'ack_at' then nullif(p_data->>'ack_at', '')::timestamptz else ack_at end,
    qty_held = case when p_data ? 'qty_held' then nullif(p_data->>'qty_held', '')::integer else qty_held end,
    qty_corrected = case when p_data ? 'qty_corrected' then coalesce(nullif(p_data->>'qty_corrected', '')::integer, 0) else qty_corrected end,
    qty_destroyed = case when p_data ? 'qty_destroyed' then coalesce(nullif(p_data->>'qty_destroyed', '')::integer, 0) else qty_destroyed end,
    qty_documented = case when p_data ? 'qty_documented' then coalesce(nullif(p_data->>'qty_documented', '')::integer, 0) else qty_documented end,
    onward_supply = case when p_data ? 'onward_supply' then nullif(trim(p_data->>'onward_supply'), '') else onward_supply end,
    chases = case when p_data ? 'chase' then chases || jsonb_build_array(jsonb_build_object(
               'at', now(), 'by', (select name from public.users where id = auth.uid()),
               'channel', p_data->'chase'->>'channel', 'note', p_data->'chase'->>'note')) else chases end,
    updated_by = auth.uid(), updated_at = now()
   where id = v_id returning * into f;
  perform public.recall_log(r.id, case when p_data ? 'chase' then 'chased' else 'followup' end,
    coalesce(f.consignee_name, (select coalesce(notes, external_ref, type) from public.transactions where id = f.transaction_id), 'consignee')
      || ' — ' || replace(f.status, '_', ' ') || coalesce(' · ' || nullif(trim(coalesce(p_data->'chase'->>'note', p_data->>'note', '')), ''), ''));
  return v_id;
end $$;
grant execute on function public.recall_consignee_save(uuid, uuid, uuid, jsonb) to authenticated;

-- Units a consignee sent back (IBG-F07 "recovered"): booked into the recalled batch, which stays blocked.
create or replace function public.recall_consignee_return(p_followup uuid, p_qty integer, p_batch_number text, p_expiry date,
                                                          p_location uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f public.recall_followups%rowtype; r public.recalls%rowtype; t record; v_loc uuid;
begin
  if not public.qms_staff() then raise exception 'Viewers can''t book returns'; end if;
  select * into f from public.recall_followups where id = p_followup for update;
  if f.id is null then raise exception 'Consignee not found'; end if;
  select * into r from public.recalls where id = f.recall_id;
  if r.status <> 'open' then raise exception 'This recall is closed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many units came back'; end if;
  if not exists (select 1 from public.recall_batches where recall_id = r.id and batch_number = trim(coalesce(p_batch_number, ''))
                   and expiry_date is not distinct from p_expiry) then
    raise exception 'That batch isn''t part of this recall';
  end if;
  if f.transaction_id is not null then select * into t from public.transactions where id = f.transaction_id; end if;
  v_loc := coalesce(p_location, t.location_id);
  if v_loc is null and exists (select 1 from public.product_stock where product_id = r.product_id) then
    raise exception 'Choose the site the units are booked into';
  end if;
  perform public.ims_move_stock(r.product_id, v_loc, p_qty, 'inbound',
    'Recall return ' || r.recall_number || ' — ' || coalesce(f.consignee_name, t.notes, t.external_ref, 'consignee')
      || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''),
    null, null, null, trim(coalesce(p_batch_number, '')), p_expiry, null);
  update public.recall_followups set status = 'returned', returned_qty = returned_qty + p_qty,
         note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note), updated_by = auth.uid(), updated_at = now()
   where id = f.id;
  perform public.recall_log(r.id, 'returned', p_qty || ' unit(s) back — ' || coalesce(f.consignee_name, t.notes, t.external_ref, 'consignee'));
end $$;
grant execute on function public.recall_consignee_return(uuid, integer, text, date, uuid, text) to authenticated;

-- Kept for the earlier screens (same behaviour, new statuses allowed).
create or replace function public.recall_followup(p_recall uuid, p_transaction uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.recall_consignee_save(p_recall, null, p_transaction, jsonb_build_object('status', p_status, 'note', p_note));
end $$;
grant execute on function public.recall_followup(uuid, uuid, text, text) to authenticated;

-- IBG-F09 step 1: the QRP requests closure (a mock recall closes here and releases its test holds).
create or replace function public.recall_close(p_recall uuid, p_outcome text, p_note text)
returns public.recalls
language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; v_pending integer;
begin
  if not public.ims_can_approve('recall') then raise exception 'You''re not allowed to close recalls — ask an Administrator (Settings → Approvals)'; end if;
  select * into r from public.recalls where id = p_recall for update;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.status <> 'open' then raise exception 'Already closed'; end if;
  if r.stage = 'closure_pending' then raise exception 'Closure is already waiting for the MD'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write a closing summary'; end if;

  if r.action_type = 'mock' then
    update public.recalls set status = 'closed', stage = 'closed', outcome = 'mock', closed_by = auth.uid(), closed_at = now(),
           close_note = trim(p_note), updated_at = now() where id = r.id returning * into r;
    perform public.recall_apply(r.id, 'released');
    perform public.recall_log(r.id, 'closed_mock', p_note);
    return r;
  end if;

  if p_outcome not in ('completed','withdrawn') then raise exception 'Unknown outcome %', p_outcome; end if;
  if p_outcome = 'completed' then
    if r.authorised_at is null then raise exception 'The MD hasn''t authorised this recall (IBG-F04)'; end if;
    if r.hsa_report is null then raise exception 'Record the HSA notification decision (MDRR1 / MDRR3 / none)'; end if;
    if r.hsa_report = 'none' and coalesce(trim(r.hsa_none_reason), '') = '' then raise exception 'Give the reason no HSA report is needed'; end if;
    if r.hsa_report = 'MDRR1' and (r.oscar_submitted_at is null or r.mdrr2_submitted_at is null) then
      raise exception 'Record the MDRR1 notification and the MDRR2 final / follow-up report';
    end if;
    if r.hsa_report = 'MDRR1' and r.hsa_completion_at is null then
      raise exception 'A notified FSCA closes only after HSA''s written confirmation — record it first';
    end if;
    if r.capa_id is null then raise exception 'Link the CAPA (every recall / FSCA opens one — SOP 17.1)'; end if;
    select count(*) into v_pending from public.recall_followups where recall_id = r.id and status in ('pending','notified','unreachable');
    if v_pending > 0 and coalesce(trim(r.closure->>'outstanding_justification'), '') = '' then
      raise exception '% consignee(s) haven''t acknowledged or returned stock — explain the outstanding units before closing', v_pending;
    end if;
  end if;
  update public.recalls set stage = 'closure_pending', closure_requested_by = auth.uid(), closure_requested_at = now(),
         closure_outcome = p_outcome, close_note = trim(p_note), updated_at = now()
   where id = r.id returning * into r;
  perform public.recall_log(r.id, 'closure_requested', p_outcome || ' — ' || trim(p_note));
  perform public.qms_notify('recall_authorise', 'Approve closure of ' || r.recall_number, coalesce(r.product_name, '') || ' — ' || p_outcome, '/traceability/recalls/' || r.id);
  return r;
end $$;
grant execute on function public.recall_close(uuid, text, text) to authenticated;

-- IBG-F09 step 2: the MD approves (closes) or sends it back.
create or replace function public.recall_close_approve(p_recall uuid, p_approve boolean, p_note text default null)
returns public.recalls language plpgsql security definer set search_path = public as $$
declare r public.recalls%rowtype; a record;
begin
  if not public.ims_can_approve('recall_authorise') then raise exception 'Only the Managing Director can approve the closure'; end if;
  select * into r from public.recalls where id = p_recall for update;
  if r.id is null then raise exception 'Recall not found'; end if;
  if r.stage <> 'closure_pending' then raise exception 'No closure waiting for approval'; end if;
  if r.closure_requested_by = auth.uid() then raise exception 'The person who requested closure can''t approve it'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say what is still needed'; end if;
    update public.recalls set stage = 'active', closure_requested_by = null, closure_requested_at = null, closure_outcome = null, updated_at = now()
     where id = r.id returning * into r;
    perform public.recall_log(r.id, 'closure_returned', p_note);
    perform public.notify_user(r.closure_requested_by, r.recall_number || ' closure sent back', trim(p_note), '/traceability/recalls/' || r.id);
    return r;
  end if;
  update public.recalls set status = 'closed', stage = 'closed', outcome = r.closure_outcome, closed_by = r.closure_requested_by,
         closed_at = now(), closure_approved_by = auth.uid(), closure_approved_at = now(), updated_at = now()
   where id = r.id returning * into r;
  if r.outcome = 'withdrawn' then perform public.recall_apply(r.id, 'released'); end if;
  perform public.recall_log(r.id, 'closed_' || r.outcome, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Closure approved'));
  for a in select id from public.users where role in ('administrator','inventory_manager','staff') loop
    perform public.notify_user(a.id, r.recall_number || ' closed (' || r.outcome || ')',
      coalesce(r.product_name, '') || ' — ' || case r.outcome when 'withdrawn' then 'recall withdrawn, batches released for sale again.'
        else 'recall completed; recalled stock stays blocked until disposed of (IBG-F11).' end, '/traceability/recalls/' || r.id);
  end loop;
  return r;
end $$;
grant execute on function public.recall_close_approve(uuid, boolean, text) to authenticated;

-- ── Reminders (no cron: run when someone opens the IMS) ──────────────────────────────
create table if not exists public.quality_reminders_sent (key text primary key, created_at timestamptz not null default now());
alter table public.quality_reminders_sent enable row level security;

create or replace function public.quality_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare x record; v_n integer := 0; v_key text;
begin
  if not public.qms_staff() then return 0; end if;
  for x in
    -- AE report due within 24 h or overdue
    select 'ae:' || c.id || ':' || case when c.ae_due_at < now() then 'late' else 'soon' end as k, 'quality' as t,
           case when c.ae_due_at < now() then 'OVERDUE: HSA AE report ' else 'HSA AE report due ' end || c.case_number as title,
           'Due ' || to_char(c.ae_due_at at time zone 'Asia/Singapore', 'DD Mon HH24:MI') as body, '/traceability/cases/' || c.id as link
      from public.quality_cases c
     where c.ae_reportable = 'yes' and c.ae_submitted_at is null and c.ae_due_at < now() + interval '24 hours'
    union all
    -- Reportability decision not documented within 24 h (IBG-F13)
    select 'aedecide:' || c.id, 'quality', 'Reportability decision overdue: ' || c.case_number, 'Document it in IBG-F13 (target 24 h).', '/traceability/cases/' || c.id
      from public.quality_cases c
     where c.status = 'open' and c.ae_required and c.ae_reportable is null and c.ae_aware_at < now() - interval '24 hours'
    union all
    select 'aefinal:' || c.id, 'quality', 'HSA final AE report due: ' || c.case_number, 'Due ' || to_char(c.ae_final_due, 'DD Mon YYYY'), '/traceability/cases/' || c.id
      from public.quality_cases c
     where c.ae_submitted_at is not null and c.ae_final_submitted_at is null and c.ae_final_due <= current_date + 3
    union all
    select 'triage:' || c.id, 'quality', 'Not yet assessed: ' || c.case_number, coalesce(c.product_name, '') || ' — logged ' || to_char(c.received_at, 'DD Mon'), '/traceability/cases/' || c.id
      from public.quality_cases c
     where c.status = 'open' and c.triage is null and c.received_at < now() - interval '1 day'
    union all
    select 'case30:' || c.id, 'quality', c.case_number || ' open 30 days', 'Close it or document an extension.', '/traceability/cases/' || c.id
      from public.quality_cases c
     where c.status = 'open' and c.received_at < now() - interval '30 days'
    union all
    select 'mdrr2:' || r.id, 'recall', 'MDRR2 due: ' || r.recall_number, 'Final / follow-up report due ' || to_char(r.commenced_at + interval '21 days', 'DD Mon YYYY'), '/traceability/recalls/' || r.id
      from public.recalls r
     where r.status = 'open' and r.hsa_report = 'MDRR1' and r.mdrr2_submitted_at is null and r.commenced_at < now() + interval '3 days' - interval '21 days'
    union all
    select 'mdrr1:' || r.id, 'recall', 'HSA notification not recorded: ' || r.recall_number, 'MDRR1 must be submitted via OSCAR before the FSCA starts.', '/traceability/recalls/' || r.id
      from public.recalls r
     where r.status = 'open' and r.action_type <> 'mock' and r.hsa_report = 'MDRR1' and r.oscar_submitted_at is null
    union all
    select 'auth:' || r.id, 'recall_authorise', 'Still awaiting authorisation: ' || r.recall_number, coalesce(r.product_name, ''), '/traceability/recalls/' || r.id
      from public.recalls r
     where r.stage = 'awaiting_authorisation' and r.created_at < now() - interval '4 hours'
    union all
    -- Consignee follow-ups: day 3, day 7, then weekly; day 14 escalates
    select 'chase:' || f.id || ':' || jsonb_array_length(f.chases), 'recall',
           case when f.notice_sent_at < now() - interval '14 days' then 'ESCALATE: ' else 'Follow up: ' end || coalesce(f.consignee_name, 'consignee') || ' (' || r.recall_number || ')',
           'No acknowledgement since the notice of ' || to_char(f.notice_sent_at, 'DD Mon'), '/traceability/recalls/' || r.id
      from public.recall_followups f join public.recalls r on r.id = f.recall_id
     where r.status = 'open' and f.ack_at is null and f.notice_sent_at is not null and f.status not in ('returned','not_affected','acknowledged')
       and now() >= case jsonb_array_length(f.chases) when 0 then f.notice_sent_at + interval '3 days'
                                                      when 1 then f.notice_sent_at + interval '7 days'
                                                      else ((f.chases->-1)->>'at')::timestamptz + interval '7 days' end
    union all
    select 'capaplan:' || c.id, 'quality', 'CAPA plan overdue: ' || c.capa_number, 'Plan to be approved within 15 business days.', '/traceability/capa/' || c.id
      from public.capas c
     where c.status = 'open' and c.created_at < now() - interval '21 days'
    union all
    select 'capaeff:' || c.id, 'quality', 'Effectiveness check due: ' || c.capa_number, 'Due ' || to_char(c.effectiveness_due, 'DD Mon YYYY'), '/traceability/capa/' || c.id
      from public.capas c
     where c.status = 'plan_approved' and c.effectiveness_due <= current_date
    union all
    -- Weekly hold list (SOP 18.3): holds over 7 days without a disposition
    select 'holds:' || to_char(current_date, 'IYYY-IW'), 'batch_hold', count(*) || ' batch(es) on hold over 7 days', 'Review the hold list and decide dispositions.', '/traceability?tab=holds'
      from public.hold_records h
     where h.status = 'open' and h.reason_code <> 'MOCK' and h.held_at < now() - interval '7 days'
    having count(*) > 0
  loop
    v_key := x.k;
    if exists (select 1 from public.quality_reminders_sent where key = v_key) then continue; end if;
    insert into public.quality_reminders_sent (key) values (v_key);
    perform public.qms_notify(x.t, x.title, x.body, x.link);
    v_n := v_n + 1;
  end loop;
  -- CAPA action owners
  for x in
    select 'capaact:' || c.id || ':' || (a->>'id') as k, c.owner_id, c.capa_number, a->>'action' as action, a->>'due' as due, c.id
      from public.capas c, jsonb_array_elements(c.actions) a
     where c.status <> 'closed' and coalesce(a->>'done_at', '') = '' and nullif(a->>'due', '')::date < current_date
  loop
    if exists (select 1 from public.quality_reminders_sent where key = x.k) then continue; end if;
    insert into public.quality_reminders_sent (key) values (x.k);
    perform public.notify_user(coalesce(x.owner_id, (select created_by from public.capas where id = x.id)), 'CAPA action overdue: ' || x.capa_number,
      left(x.action, 160) || ' — due ' || x.due, '/traceability/capa/' || x.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
grant execute on function public.quality_reminders() to authenticated;

-- ── Audit trail (who changed which field, kept in the append-only audit_log) ─────────
create or replace function public.audit_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor public.users%rowtype;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_before jsonb := '{}'; v_after jsonb := '{}';
  k text; i int;
begin
  if tg_op = 'UPDATE' then
    for i in 1 .. tg_nargs - 1 loop
      v_old := v_old - tg_argv[i]; v_new := v_new - tg_argv[i];
    end loop;
    for k in select jsonb_object_keys(v_new) loop
      if v_new->k is distinct from v_old->k then
        v_before := v_before || jsonb_build_object(k, v_old->k);
        v_after := v_after || jsonb_build_object(k, v_new->k);
      end if;
    end loop;
    if v_after = '{}'::jsonb then return new; end if;
  end if;
  select * into v_actor from public.users where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot)
  values (
    v_actor.id, v_actor.name, v_actor.email, lower(tg_op), tg_argv[0],
    case when v_row->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_row->>'id')::uuid end,
    concat_ws(' · ', coalesce(v_row->>'case_number', v_row->>'capa_number', v_row->>'recall_number', v_row->>'nc_number',
                              v_row->>'disp_number', v_row->>'name', v_row->>'code', v_row->>'approval_type', v_row->>'id'),
              coalesce(v_row->>'product_name', v_row->>'title'), v_row->>'sku'),
    case tg_op when 'UPDATE' then jsonb_build_object('before', v_before, 'after', v_after) else v_row end
  );
  return coalesce(new, old);
end $$;
revoke execute on function public.audit_changes() from public, anon, authenticated;

drop trigger if exists audit_quality_cases on public.quality_cases;
create trigger audit_quality_cases after insert or update on public.quality_cases
  for each row execute function public.audit_changes('quality_case', 'updated_at');
drop trigger if exists audit_capas on public.capas;
create trigger audit_capas after insert or update on public.capas
  for each row execute function public.audit_changes('capa', 'updated_at');
drop trigger if exists audit_hold_records on public.hold_records;
create trigger audit_hold_records after insert or update on public.hold_records
  for each row execute function public.audit_changes('hold');
drop trigger if exists audit_dispositions on public.dispositions;
create trigger audit_dispositions after insert or update on public.dispositions
  for each row execute function public.audit_changes('disposition');
drop trigger if exists audit_recalls on public.recalls;
create trigger audit_recalls after update on public.recalls
  for each row execute function public.audit_changes('recall', 'updated_at');

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.quality_cases enable row level security;
alter table public.capas enable row level security;
alter table public.hold_records enable row level security;
alter table public.dispositions enable row level security;
drop policy if exists "Authenticated read" on public.quality_cases;
create policy "Authenticated read" on public.quality_cases for select using (auth.role() = 'authenticated');
drop policy if exists "Staff insert" on public.quality_cases;
create policy "Staff insert" on public.quality_cases for insert with check (public.qms_staff());
drop policy if exists "Staff update" on public.quality_cases;
create policy "Staff update" on public.quality_cases for update using (public.qms_staff()) with check (public.qms_staff());
drop policy if exists "Authenticated read" on public.capas;
create policy "Authenticated read" on public.capas for select using (auth.role() = 'authenticated');
drop policy if exists "Staff insert" on public.capas;
create policy "Staff insert" on public.capas for insert with check (public.qms_staff());
drop policy if exists "Staff update" on public.capas;
create policy "Staff update" on public.capas for update using (public.qms_staff()) with check (public.qms_staff());
drop policy if exists "Authenticated read" on public.hold_records;
create policy "Authenticated read" on public.hold_records for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated read" on public.dispositions;
create policy "Authenticated read" on public.dispositions for select using (auth.role() = 'authenticated');

commit;
