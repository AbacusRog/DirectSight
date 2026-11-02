-- PHASE 2: remove the plaintext token columns for good.
-- *** NOT YET APPLIED. Run only after (1) the new code is deployed and (2) a QuickBooks refresh has worked. ***
-- Check first (should return plaintext_cleared = true for every row):
--   select realm_id, access_token is null as plaintext_cleared from public.ac_connections;
-- That flag only turns true once the NEW code has rotated the tokens through ac_update_tokens.

do $$ begin
  if exists (select 1 from public.ac_connections where access_token_id is null or refresh_token_id is null) then
    raise exception 'A connection has no vault secrets; do not run phase 2 yet';
  end if;
  if exists (select 1 from public.ac_connections where access_token is not null or refresh_token is not null) then
    raise exception 'Plaintext tokens still present: the new code has not rotated them yet; do not run phase 2 yet';
  end if;
end $$;

-- the functions stop mentioning the plaintext columns
create or replace function public.ac_get_connection(p_realm text)
returns table (realm_id text, label text, company_name text, access_token text, refresh_token text,
               access_expires_at timestamptz, refresh_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.realm_id, c.label, c.company_name,
         (select d.decrypted_secret from vault.decrypted_secrets d where d.id = c.access_token_id),
         (select d.decrypted_secret from vault.decrypted_secrets d where d.id = c.refresh_token_id),
         c.access_expires_at, c.refresh_expires_at
  from public.ac_connections c where c.realm_id = p_realm;
$$;

create or replace function public.ac_update_tokens(p_realm text, p_access text, p_refresh text, p_access_exp timestamptz, p_refresh_exp timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.ac_connections;
begin
  select * into c from public.ac_connections where realm_id = p_realm for update;
  if not found then raise exception 'unknown company'; end if;
  perform vault.update_secret(c.access_token_id, p_access);
  perform vault.update_secret(c.refresh_token_id, p_refresh);
  update public.ac_connections set access_expires_at = p_access_exp, refresh_expires_at = p_refresh_exp, updated_at = now() where realm_id = p_realm;
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
           connected_at = now(), updated_at = now()
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
          refresh_expires_at = excluded.refresh_expires_at, connected_at = now(), updated_at = now();
  end if;
end $$;

drop trigger if exists ac_connections_sync_vault on public.ac_connections;
drop function if exists public.ac_connections_sync_vault();

alter table public.ac_connections drop column access_token, drop column refresh_token;
alter table public.ac_connections alter column access_token_id set not null, alter column refresh_token_id set not null;
