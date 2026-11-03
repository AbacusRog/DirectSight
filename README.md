# Aged Creditors

Shows each supplier's unpaid bills from QuickBooks Online, aged into Not yet due / 1–30 / 31–60 / 61–90 / 91+ days overdue, and suggests a payment date per supplier from rules you set.

**Stack:** React + Vite + TypeScript + Tailwind, Supabase (**Clients** project), Cloudflare Pages + Pages Functions.

## How it works

- Has its own QuickBooks connections in `public.ac_connections` (Clients project), separate from the Abacus project's `qbo_connections` and the other apps, so it can be pointed at any company (e.g. a client's). Use **Connect a company** in the app: it sends you to QuickBooks to approve access, then returns here. A company switcher appears once more than one is connected.
- `POST /api/sync` refreshes the QuickBooks token if needed (and writes the rotated token straight back), pulls the **AgedPayableDetail** report, groups it by supplier and caches it in `ac_snapshots`.
- Opening the app shows the cached snapshot immediately and re-syncs if it is more than 15 minutes old. **Refresh** forces a sync.
- **Ageing** has two views, switched above the table (and remembered in your browser):
  - **30-day periods**: days past each bill's due date (not yet due, 1-30, 31-60, 61-90, 91+), as QuickBooks reports it.
  - **Calendar months**: this month, then back 2 to 12 previous months, then everything older. Age from the **bill date** (default) or the **due date**; by due date a "Later" column appears for bills due after this month. Month names are fixed ("Sep", not "Sept") so they read the same on every device.
  Either way, credits are netted into their own column so every supplier's row adds up to their total, and credits are never given a payment date.
- Supplier rules live in `ac_supplier_rules`: due date, X days after bill date, fixed day each month, weekly run day, pay immediately, or hold. Weekend dates move to the Friday before (Monday if that has passed). UK bank holidays are not handled.
- Access is admin only: the signed-in user needs a row in `user_roles` with role `admin` in the Clients project (checked by `is_admin()`, both in the database policies and in the Pages Functions). Log in with an account that exists in the Clients project's Auth users.

## Choosing which suppliers to pay

Each supplier on the **Aged creditors** tab has a tick box (the box in the header ticks or unticks everyone). Only ticked suppliers appear in the **Payment schedule**, which also has its own list of suppliers to adjust, **Tick all / Untick all**, and a total for what is selected. Everyone is ticked by default, so a new supplier shows up straight away. The selection is remembered per company in this browser (it is not shared between devices).

## Giving a client access to their own company

Admins (a `user_roles` row with role `admin` in the Clients project) see every company and can connect companies and check the QuickBooks keys. A **client login** is tied to specific companies and can do nothing else:

- sees only that company's aged creditors, payment schedule and management report (no company picker, no Connections menu, no key check, no way to connect anything);
- can press Refresh (pulls that company only) and, unless switched off, set supplier payment rules for that company.

This is enforced twice, not just hidden on screen: row-level security in the database (`ac_client_access`, `ac_can_view()`, `ac_can_edit_rules()`) and a company check on every Pages Function. To add one:

1. Supabase (Clients project) > Authentication > Users > add the client's email (invite, or create with a password).
2. Run the insert at the bottom of `supabase/004_client_access.sql` with their email and the company's realm id (`can_edit_rules` false makes it view-only).
3. They sign in at the same address as you.

To remove access, run the delete in the same file. In Authentication settings, switching off "Allow new users to sign up" is a sensible extra, because anyone who signs up gets nothing but the login screen.

## Security

- **Who can see what:** enforced in the database (row-level security) and again on every API call. A client login can reach only its own company; anonymous visitors get nothing. Checked by impersonating a real client login against every table, view and function in the Clients project, not just by reading policies.
- **Tokens:** QuickBooks tokens are **encrypted in Supabase Vault**. `ac_connections` only holds the ids of the secrets; the server reads and writes them through three functions (`ac_get_connection`, `ac_update_tokens`, `ac_save_connection`) that only the service role may run. The browser roles have no access to the table, the functions or Vault. This touches only DirectSight: other apps' QuickBooks tables (e.g. `jmc_qbo_connections`) and their Vault secrets are separate. Migration steps are in `supabase/006` and `007`.
- **Limits:** a client can refresh at most once every 2 minutes (`CLIENT_COOLDOWN_SECONDS`), to protect the QuickBooks allowance. Clients get plain error messages; the detail goes to the server log.
- **Headers:** `public/_headers` sets a strict Content-Security-Policy (no inline scripts), no framing, no content sniffing, HSTS and a tight referrer policy. If you add a third-party script, font or API, add its address to the policy there.
- **Call log:** every QuickBooks call is recorded in `ac_api_log` (status and Intuit transaction id).
- **Secrets** (Cloudflare Secrets, never in the repo): `SUPABASE_SERVICE_ROLE_KEY`, `QBO_CLIENT_SECRET`, `CRON_SECRET`, and optionally `STATE_SECRET` (signs the Connect link; recommended).
- **Recommended Supabase settings:** turn on leaked-password protection and turn off "Allow new users to sign up" (Authentication settings).
- **Checks:** CI (`.github/workflows/ci.yml`) runs the type checks, tests and build on every push.

## Appearance

Light and dark themes (the sun/moon button in the header). It follows the device setting until you choose, then remembers your choice. Reports always print in light. The look is a ledger-paper palette with Source Serif 4 for titles and figures and IBM Plex Sans for tables, both bundled with the app (no external font requests). Colours are CSS variables in `src/index.css`.

## Management report

The **Management report** tab shows every month from **January 2024** to date of **Profit and loss** and **Balance sheet** from QuickBooks (accrual or cash basis) in three views:

- **Vs last N months**: a chosen month (default the current one) next to each of the previous N months (2-6, 12, 24 or any number up to what is available), their average, and the change in £ and % against that average. A month with no activity counts as £0. If the chosen month is only month to date, a warning offers a one-click switch to the last full month.
- **Two months**: any two months side by side, with shortcuts for *Latest vs previous month* and *Latest vs same month last year*.
- **All months**: every month in a grid, one year at a time (default the latest year, with a total for the year on the profit and loss), or all years together.

**Detail** makes the report compact: *Headline totals* (Total Income, Total Expenses, Net Income...), *Totals by category* (one line per account, with any parent account's sub-accounts rolled up into a single line, e.g. Advertising, Legal and professional, Office expenses), *More detail*, or *Full detail*. Empty lines are hidden by default, and **Print** gives a clean page (use the browser's Save as PDF).

Data is pulled from 1 January 2024 (`REPORTS_FROM`; change it in `functions/_lib/reports.ts` and `src/lib/reportCompare.ts` together) with `POST /api/report-sync` (QuickBooks `ProfitAndLoss` / `BalanceSheet` reports summarised by month), cached in `ac_reports`, and refreshed on open if older than an hour. The balance sheet shows balances at each month end; the latest column is as at today.

## Cloudflare Pages setup

Build command `npm run build`, output directory `dist`. Variables (see `.env.example`):

| Name | Type | Notes |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Variable | Front end |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Secret | Functions only |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` | Secret | Copy from the Pages project of your existing QuickBooks app, so token refreshes use the same Intuit app |
| `CRON_SECRET` | Secret | Only for the optional daily refresh |

**One-off Intuit step:** in the Intuit Developer portal, add `https://<your-pages-domain>/api/qbo-callback` as a **production** redirect URI on the app whose client id/secret you use. Without it, Connect fails at QuickBooks. The person approving must sign in to QuickBooks as a user with access to that company (an accountant invite works).

If the page is blank or shows "App not configured", the two `VITE_` variables are missing: set them as plain Variables in Cloudflare and redeploy (they are baked in at build time).

Daily refresh (optional): `supabase/002_daily_refresh_OPTIONAL.sql`.

## Tests

`npm test` runs the payment-date rules and the QuickBooks report parser (Node 22+).
