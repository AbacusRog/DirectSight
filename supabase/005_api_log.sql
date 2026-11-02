-- Already applied to the "Clients" Supabase project (migration: aged_creditors_api_log). Kept here for the record.
-- One row per QuickBooks API call (endpoint, status, Intuit transaction id): for support and Intuit compliance.
create table if not exists public.ac_api_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  realm_id text,
  endpoint text not null,
  status integer,
  intuit_tid text,
  message text
);
create index if not exists ac_api_log_at_idx on public.ac_api_log (at desc);
alter table public.ac_api_log enable row level security;
create policy "admin read api log" on public.ac_api_log for select to authenticated using (( select public.is_admin() ));
