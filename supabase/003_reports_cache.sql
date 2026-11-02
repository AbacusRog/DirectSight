-- Already applied to the "Clients" Supabase project (migration: aged_creditors_reports_cache). Kept here for the record.
create table if not exists public.ac_reports (
  realm_id text not null,
  kind text not null check (kind in ('pnl','balance_sheet')),
  basis text not null check (basis in ('Accrual','Cash')),
  start_date date not null,
  end_date date not null,
  fetched_at timestamptz not null default now(),
  data jsonb not null,
  primary key (realm_id, kind, basis)
);
comment on table public.ac_reports is 'Management report: cached monthly Profit and Loss and Balance Sheet per QuickBooks company (columns = months, rows = report lines). Written by the Pages Function with the service role.';
alter table public.ac_reports enable row level security;
create policy "admin read reports" on public.ac_reports
  for select to authenticated using (( select public.is_admin() ));
