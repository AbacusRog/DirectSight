-- OPTIONAL: refresh every connected QuickBooks company at 06:30 UK time each day,
-- so the numbers are already there when you open the app.
-- Run this in the CLIENTS Supabase project (not Abacus). Not applied. Run it once the app is live, after replacing the two placeholders.
--
-- 1. Add CRON_SECRET (a long random string) as a Secret on the Cloudflare Pages project.
-- 2. Replace <YOUR-PAGES-URL> and <SAME-CRON-SECRET> below, then run in the Supabase SQL editor.
-- Note: pg_cron runs in UTC, so this fires at 06:30 UTC (07:30 BST / 06:30 GMT).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'aged-creditors-daily',
  '30 6 * * *',
  $$
  select net.http_post(
    url     := 'https://<YOUR-PAGES-URL>/api/sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <SAME-CRON-SECRET>'),
    body    := '{"all": true}'::jsonb
  );
  $$
);

-- To remove it later:  select cron.unschedule('aged-creditors-daily');
