-- Already applied to the "Clients" Supabase project (migration: aged_creditors_tables). Kept here for the record.
-- Access uses the Clients project's existing is_admin() (user_roles.role = 'admin').

create table if not exists public.ac_connections (
  realm_id text primary key,
  label text not null,
  company_name text,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ac_connections is 'Aged Creditors app: QuickBooks companies connected through this app. Tokens are server-side only: RLS on, no policies, service role only.';

create table if not exists public.ac_snapshots (
  realm_id text primary key,
  as_of date not null,
  fetched_at timestamptz not null default now(),
  total numeric not null default 0,
  vendors jsonb not null default '[]'::jsonb
);
comment on table public.ac_snapshots is 'Aged Creditors app: latest cached QuickBooks aged payables per company (bill-level, grouped by vendor). Written by the Pages Function with the service role.';

create table if not exists public.ac_supplier_rules (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null,
  vendor_id text not null,
  vendor_name text not null,
  terms_type text not null default 'due_date'
    check (terms_type in ('due_date','days_after_invoice','day_of_month','weekly_run','immediate')),
  terms_days integer,
  day_of_month integer check (day_of_month between 1 and 31),
  weekday integer check (weekday between 0 and 6),
  hold boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  unique (realm_id, vendor_id)
);
comment on table public.ac_supplier_rules is 'Aged Creditors app: per-supplier payment rules used to suggest payment dates. weekday 0=Sunday..6=Saturday.';

alter table public.ac_connections enable row level security;
alter table public.ac_snapshots enable row level security;
alter table public.ac_supplier_rules enable row level security;

create policy "admin read snapshots" on public.ac_snapshots
  for select to authenticated using (( select public.is_admin() ));

create policy "admin manage supplier rules" on public.ac_supplier_rules
  for all to authenticated
  using (( select public.is_admin() ))
  with check (( select public.is_admin() ));
