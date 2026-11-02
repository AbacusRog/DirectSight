# Aged Creditors

Shows each supplier's unpaid bills from QuickBooks Online, aged into Not yet due / 1–30 / 31–60 / 61–90 / 91+ days overdue, and suggests a payment date per supplier from rules you set.

**Stack:** React + Vite + TypeScript + Tailwind, Supabase (**Clients** project), Cloudflare Pages + Pages Functions.

## How it works

- Has its own QuickBooks connections in `public.ac_connections` (Clients project), separate from the Abacus project's `qbo_connections` and the other apps, so it can be pointed at any company (e.g. a client's). Use **Connect a company** in the app: it sends you to QuickBooks to approve access, then returns here. A company switcher appears once more than one is connected.
- `POST /api/sync` refreshes the QuickBooks token if needed (and writes the rotated token straight back), pulls the **AgedPayableDetail** report, groups it by supplier and caches it in `ac_snapshots`.
- Opening the app shows the cached snapshot immediately and re-syncs if it is more than 15 minutes old. **Refresh** forces a sync.
- Ageing is by **due date** (days past due). Credits are kept in the totals but never given a payment date.
- Supplier rules live in `ac_supplier_rules`: due date, X days after bill date, fixed day each month, weekly run day, pay immediately, or hold. Weekend dates move to the Friday before (Monday if that has passed). UK bank holidays are not handled.
- Access is admin only: the signed-in user needs a row in `user_roles` with role `admin` in the Clients project (checked by `is_admin()`, both in the database policies and in the Pages Functions). Log in with an account that exists in the Clients project's Auth users.

## Management report

The **Management report** tab shows the last 13 months of **Profit and loss** and **Balance sheet** from QuickBooks (accrual or cash basis) in three views:

- **Vs last N months**: a chosen month (default the current one) next to each of the previous N months (2-6, 12 or any number up to what is available), their average, and the change in £ and % against that average. A month with no activity counts as £0. If the chosen month is only month to date, a warning offers a one-click switch to the last full month.
- **Two months**: any two months side by side, with shortcuts for *Latest vs previous month* and *Latest vs same month last year*.
- **All months**: every month in a grid.

**Detail** makes the report compact: *Headline totals* (Total Income, Total Expenses, Net Income...), *Totals by category* (one line per account, with any parent account's sub-accounts rolled up into a single line, e.g. Advertising, Legal and professional, Office expenses), *More detail*, or *Full detail*. Empty lines are hidden by default, and **Print** gives a clean page (use the browser's Save as PDF).

Data is pulled with `POST /api/report-sync` (QuickBooks `ProfitAndLoss` / `BalanceSheet` reports summarised by month), cached in `ac_reports`, and refreshed on open if older than an hour. The balance sheet shows balances at each month end; the latest column is as at today.

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
