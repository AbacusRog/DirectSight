-- Already applied to the "Clients" Supabase project (migration: aged_creditors_client_access). Kept here for the record.
-- A client login is tied to specific QuickBooks companies. Admins (user_roles.role = 'admin') see everything.

create table if not exists public.ac_client_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  realm_id text not null references public.ac_connections(realm_id) on delete cascade,
  can_edit_rules boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, realm_id)
);
alter table public.ac_client_access enable row level security;
create policy "admin manage client access" on public.ac_client_access for all to authenticated
  using (( select public.is_admin() )) with check (( select public.is_admin() ));
create policy "read own client access" on public.ac_client_access for select to authenticated
  using (user_id = ( select auth.uid() ));

create or replace function public.ac_can_view(p_realm text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.ac_client_access a where a.user_id = auth.uid() and a.realm_id = p_realm);
$$;
create or replace function public.ac_can_edit_rules(p_realm text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.ac_client_access a where a.user_id = auth.uid() and a.realm_id = p_realm and a.can_edit_rules);
$$;
revoke execute on function public.ac_can_view(text) from public, anon;
revoke execute on function public.ac_can_edit_rules(text) from public, anon;
grant execute on function public.ac_can_view(text) to authenticated;
grant execute on function public.ac_can_edit_rules(text) to authenticated;

drop policy if exists "admin read snapshots" on public.ac_snapshots;
drop policy if exists "admin read reports" on public.ac_reports;
drop policy if exists "admin manage supplier rules" on public.ac_supplier_rules;
create policy "view own company snapshots" on public.ac_snapshots for select to authenticated using (( select public.ac_can_view(realm_id) ));
create policy "view own company reports" on public.ac_reports for select to authenticated using (( select public.ac_can_view(realm_id) ));
create policy "view own company rules" on public.ac_supplier_rules for select to authenticated using (( select public.ac_can_view(realm_id) ));
create policy "add rules for own company" on public.ac_supplier_rules for insert to authenticated with check (( select public.ac_can_edit_rules(realm_id) ));
create policy "change rules for own company" on public.ac_supplier_rules for update to authenticated
  using (( select public.ac_can_edit_rules(realm_id) )) with check (( select public.ac_can_edit_rules(realm_id) ));
create policy "delete rules for own company" on public.ac_supplier_rules for delete to authenticated using (( select public.ac_can_edit_rules(realm_id) ));

-- ---------------------------------------------------------------------------------------------
-- TO GIVE A CLIENT ACCESS (after creating their login in Supabase > Authentication > Users):
--   insert into public.ac_client_access (user_id, realm_id, can_edit_rules)
--   select id, '<the company''s realm id>', true      -- false = they can look but not change payment rules
--   from auth.users where lower(email) = lower('client@example.com');
--
-- TO REMOVE ACCESS:
--   delete from public.ac_client_access where user_id = (select id from auth.users where lower(email) = lower('client@example.com'));
