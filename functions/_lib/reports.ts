// Monthly Profit and Loss / Balance Sheet from QuickBooks, cached in public.ac_reports.
import { loadConnection, logCall, refresh, sb, type Env } from './qbo.ts'

export type ReportKind = 'pnl' | 'balance_sheet'
export type Basis = 'Accrual' | 'Cash'

export interface ReportColumn {
  label: string // e.g. "Nov 2026"
  start: string | null // YYYY-MM-DD
  end: string | null
  total: boolean // the report's own "Total" column
}
export interface ReportRow {
  label: string
  kind: 'header' | 'line' | 'total'
  depth: number
  values: (number | null)[] // one per column, same order as columns
}
export interface MonthlyReport {
  columns: ReportColumn[]
  rows: ReportRow[]
}

type Col = { value?: string; id?: string }
type QRow = { type?: string; ColData?: Col[]; Rows?: { Row?: QRow[] }; Header?: { ColData?: Col[] }; Summary?: { ColData?: Col[] } }
interface QReport {
  Columns?: { Column?: { ColTitle?: string; ColType?: string; MetaData?: { Name?: string; Value?: string }[] }[] }
  Rows?: { Row?: QRow[] }
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null
  const neg = /^\(.*\)$/.test(s.trim())
  const n = parseFloat(s.replace(/[(),£$€\s]/g, ''))
  return isFinite(n) ? (neg ? -Math.abs(n) : n) : null
}

/**
 * Turns a QuickBooks report summarised by month (column 0 = line label, other columns = months,
 * optionally a trailing "Total") into a flat, ordered list of rows with depth for indenting.
 * Makes no assumption about which lines exist, so it works for any chart of accounts.
 */
export function parseMonthlyReport(report: QReport): MonthlyReport {
  const raw = report.Columns?.Column ?? []
  if (raw.length < 2) throw new Error('Unexpected report layout from QuickBooks (no value columns).')
  const meta = (c: (typeof raw)[number], name: string) => c.MetaData?.find((m) => m.Name === name)?.Value ?? null
  const columns: ReportColumn[] = raw.slice(1).map((c) => ({
    label: (c.ColTitle ?? '').trim() || '–',
    start: meta(c, 'StartDate'),
    end: meta(c, 'EndDate'),
    total: /^total$/i.test((c.ColTitle ?? '').trim()),
  }))
  const width = columns.length
  const vals = (cd: Col[] | undefined) => Array.from({ length: width }, (_, i) => num(cd?.[i + 1]?.value))

  const rows: ReportRow[] = []
  const walk = (list: QRow[] | undefined, depth: number) => {
    for (const r of list ?? []) {
      if (r.type === 'Section' || r.Rows || r.Header) {
        const head = r.Header?.ColData
        const label = head?.[0]?.value?.trim()
        const hasChildren = !!r.Rows?.Row?.length
        const headVals = vals(head)
        if (label && (hasChildren || headVals.some((v) => v !== null))) {
          rows.push({ label, kind: 'header', depth, values: headVals })
        }
        walk(r.Rows?.Row, label ? depth + 1 : depth)
        const sum = r.Summary?.ColData
        const sLabel = sum?.[0]?.value?.trim()
        if (sLabel) rows.push({ label: sLabel, kind: 'total', depth, values: vals(sum) })
      } else if (r.ColData) {
        const label = r.ColData[0]?.value?.trim()
        if (label) rows.push({ label, kind: 'line', depth, values: vals(r.ColData) })
      }
    }
  }
  walk(report.Rows?.Row, 0)
  return { columns, rows }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** First day of the month `months-1` months ago, through today. */
export function reportWindow(today: Date, months: number) {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (months - 1), 1))
  return { start: iso(start), end: iso(today) }
}

export async function syncReport(env: Env, realm: string, kind: ReportKind, basis: Basis, months = 13) {
  const { start, end } = reportWindow(new Date(), months)
  const name = kind === 'pnl' ? 'ProfitAndLoss' : 'BalanceSheet'
  const q = new URLSearchParams({ start_date: start, end_date: end, summarize_column_by: 'Month', accounting_method: basis, minorversion: '75' })

  let conn = await loadConnection(env, realm)
  if (new Date(conn.access_expires_at).getTime() < Date.now() + 60_000) conn = await refresh(env, conn)

  const call = async () => {
    const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realm)}/reports/${name}?${q}`, {
      headers: { authorization: `Bearer ${conn.access_token}`, accept: 'application/json' },
    })
    await logCall(env, realm, `reports/${name}`, res.status, res.headers.get('intuit_tid'))
    return res
  }
  let res = await call()
  if (res.status === 401) {
    conn = await refresh(env, await loadConnection(env, realm))
    res = await call()
  }
  if (!res.ok) throw new Error(`QuickBooks ${name} report failed (${res.status})`)

  const data = parseMonthlyReport((await res.json()) as QReport)
  const row = { realm_id: realm, kind, basis, start_date: start, end_date: end, fetched_at: new Date().toISOString(), data }
  await sb(env, 'ac_reports?on_conflict=realm_id,kind,basis', { method: 'POST', body: JSON.stringify(row) }, { prefer: 'resolution=merge-duplicates,return=minimal' })
  return { fetched_at: row.fetched_at }
}
