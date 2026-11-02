-- PHASE 1 of encrypting DirectSight's QuickBooks tokens with Supabase Vault.
-- ALREADY APPLIED to the "Clients" project (migration: aged_creditors_vault_tokens_phase1). Kept here for the record.
--
-- What it does:
--  * tokens live in Vault (encrypted); ac_connections only holds the secret ids
--  * server-only functions (service_role): ac_get_connection, ac_update_tokens, ac_save_connection
--  * a TRANSITION trigger keeps the encrypted copy in step with the plaintext columns, so the old code kept working until the new code was deployed
--  * deleting a connection deletes its secrets; browser roles (anon/authenticated) have no access to the table or the functions
--  * only touches public.ac_connections; Vault secrets are named ac_qbo_*, so other apps' secrets and tables (e.g. jmc_qbo_connections) are untouched

alter table public.ac_connections
  add column if not exists access_token_id uuid,
  add column if not exists refresh_token_id uuid;
alter table public.ac_connections alter column access_token drop not null;
alter table public.ac_connections alter column refresh_token drop not null;

create or replace function public.ac_get_connection(p_realm text)
returns table (realm_id text, label text, company_name text, access_token text, refresh_token text,
               access_expires_at timestamptz, refresh_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.realm_id, c.label, c.company_name,
         coalesce((select d.decrypted_secret from vault.decrypted_secrets d where d.id = c.access_token_id), c.access_token),
         coalesce((select d.decrypted_secret from vault.decrypted_secrets d where d.id = c.refresh_token_id), c.refresh_token),
         c.access_expires_at, c.refresh_expires_at
  from public.ac_connections c where c.realm_id = p_realm;
$$;

create or replace function public.ac_update_tokens(p_realm text, p_access text, p_refresh text, p_access_exp timestamptz, p_refresh_exp timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.ac_connections;
begin
  select * into c from public.ac_connections where realm_id = p_realm for update;
  if not found then raise exception 'unknown company'; end if;
  if c.access_token_id is null or c.refresh_token_id is null then raise exception 'connection has no vault secrets'; end if;
  perform vault.update_secret(c.access_token_id, p_access);
  perform vault.update_secret(c.refresh_token_id, p_refresh);
  update public.ac_connections
     set access_expires_at = p_access_exp, refresh_expires_at = p_refresh_exp,
         access_token = null, refresh_token = null, updated_at = now()
   where realm_id = p_realm;
end $$;

create or replace function public.ac_save_connection(p_realm text, p_label text, p_company text, p_access text, p_refresh text, p_access_exp timestamptz, p_refresh_exp timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.ac_connections; a uuid; f uuid;
begin
  select * into c from public.ac_connections where realm_id = p_realm for update;
  if found and c.access_token_id is not null and c.refresh_token_id is not null then
    perform vault.update_secret(c.access_token_id, p_access);
    perform vault.update_secret(c.refresh_token_id, p_refresh);
    update public.ac_connections
       set label = p_label, company_name = p_company, access_expires_at = p_access_exp, refresh_expires_at = p_refresh_exp,
           access_token = null, refresh_token = null, connected_at = now(), updated_at = now()
     where realm_id = p_realm;
  else
    delete from vault.secrets where name in ('ac_qbo_access_' || p_realm, 'ac_qbo_refresh_' || p_realm);
    a := vault.create_secret(p_access, 'ac_qbo_access_' || p_realm, 'DirectSight QuickBooks access token');
    f := vault.create_secret(p_refresh, 'ac_qbo_refresh_' || p_realm, 'DirectSight QuickBooks refresh token');
    insert into public.ac_connections (realm_id, label, company_name, access_token_id, refresh_token_id, access_expires_at, refresh_expires_at, connected_at, updated_at)
    values (p_realm, p_label, p_company, a, f, p_access_exp, p_refresh_exp, now(), now())
    on conflict (realm_id) do update
      set label = excluded.label, company_name = excluded.company_name, access_token_id = excluded.access_token_id,
          refresh_token_id = excluded.refresh_token_id, access_expires_at = excluded.access_expires_at,
          refresh_expires_at = excluded.refresh_expires_at, access_token = null, refresh_token = null, connected_at = now(), updated_at = now();
  end if;
end $$;

-- TRANSITION ONLY (removed in phase 2)
create or replace function public.ac_connections_sync_vault()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ea uuid; er uuid;
begin
  if tg_op = 'INSERT' then
    select c.access_token_id, c.refresh_token_id into ea, er from public.ac_connections c where c.realm_id = new.realm_id;
    new.access_token_id := coalesce(new.access_token_id, ea);
    new.refresh_token_id := coalesce(new.refresh_token_id, er);
  end if;
  if new.access_token is not null then
    if new.access_token_id is null then
      delete from vault.secrets where name = 'ac_qbo_access_' || new.realm_id;
      new.access_token_id := vault.create_secret(new.access_token, 'ac_qbo_access_' || new.realm_id, 'DirectSight QuickBooks access token');
    elsif tg_op = 'INSERT' or new.access_token is distinct from old.access_token then
      perform vault.update_secret(new.access_token_id, new.access_token);
    end if;
  end if;
  if new.refresh_token is not null then
    if new.refresh_token_id is null then
      delete from vault.secrets where name = 'ac_qbo_refresh_' || new.realm_id;
      new.refresh_token_id := vault.create_secret(new.refresh_token, 'ac_qbo_refresh_' || new.realm_id, 'DirectSight QuickBooks refresh token');
    elsif tg_op = 'INSERT' or new.refresh_token is distinct from old.refresh_token then
      perform vault.update_secret(new.refresh_token_id, new.refresh_token);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ac_connections_sync_vault on public.ac_connections;
create trigger ac_connections_sync_vault before insert or update on public.ac_connections
  for each row execute function public.ac_connections_sync_vault();

create or replace function public.ac_connections_delete_secrets()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id in (old.access_token_id, old.refresh_token_id);
  return old;
end $$;
drop trigger if exists ac_connections_cleanup on public.ac_connections;
create trigger ac_connections_cleanup after delete on public.ac_connections
  for each row execute function public.ac_connections_delete_secrets();

revoke all on function public.ac_get_connection(text) from public, anon, authenticated;
revoke all on function public.ac_update_tokens(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ac_save_connection(text, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ac_connections_sync_vault() from public, anon, authenticated;
revoke all on function public.ac_connections_delete_secrets() from public, anon, authenticated;
grant execute on function public.ac_get_connection(text) to service_role;
grant execute on function public.ac_update_tokens(text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.ac_save_connection(text, text, text, text, text, timestamptz, timestamptz) to service_role;
revoke all on public.ac_connections from anon, authenticated;

update public.ac_connections set label = label where access_token is not null and access_token_id is null;
