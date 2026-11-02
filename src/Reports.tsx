import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, supabase } from './lib/supabase'
import { compareMonths, fmtChange, fmtMoney, fmtPct, isEmptyRow, monthIndexes, type MonthlyReport, type ReportRow } from './lib/reportCompare'

type Kind = 'pnl' | 'balance_sheet'
type Basis = 'Accrual' | 'Cash'
const STALE_MS = 60 * 60 * 1000 // re-pull from QuickBooks on open if older than an hour

const rowClass = (r: ReportRow) =>
  r.kind === 'header' ? 'font-semibold bg-slate-50' : r.kind === 'total' ? 'font-semibold border-t bg-slate-50/60' : ''

export default function Reports({ realm }: { realm: string }) {
  const [kind, setKind] = useState<Kind>('pnl')
  const [basis, setBasis] = useState<Basis>('Accrual')
  const [view, setView] = useState<'grid' | 'compare'>('compare')
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [ai, setAi] = useState(0)
  const [bi, setBi] = useState(0)

  const read = useCallback(async () => {
    const { data, error } = await supabase
      .from('ac_reports')
      .select('data,fetched_at')
      .eq('realm_id', realm)
      .eq('kind', kind)
      .eq('basis', basis)
      .maybeSingle()
    if (error) throw error
    setReport((data?.data as MonthlyReport) ?? null)
    setFetchedAt(data?.fetched_at ?? null)
    return data as { fetched_at: string } | null
  }, [realm, kind, basis])

  const sync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      await api('/api/report-sync', { method: 'POST', body: JSON.stringify({ realm_id: realm, kind, basis }) })
      await read()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }, [realm, kind, basis, read])

  // Show what is cached straight away; refresh from QuickBooks if missing or stale.
  useEffect(() => {
    if (!realm) return
    let cancelled = false
    setReport(null)
    setFetchedAt(null)
    ;(async () => {
      try {
        const cached = await read()
        if (!cancelled && (!cached || Date.now() - new Date(cached.fetched_at).getTime() > STALE_MS)) await sync()
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [realm, kind, basis, read, sync])

  const months = useMemo(() => (report ? monthIndexes(report) : []), [report])

  // Default comparison: latest month against the one before it.
  useEffect(() => {
    if (months.length) {
      setAi(months[months.length - 1])
      setBi(months[Math.max(0, months.length - 2)])
    }
  }, [months])

  const sameMonthLastYear = months.length >= 13 ? months[months.length - 13] : null
  const rows = useMemo(() => (report ? report.rows.filter((r) => !(hideEmpty && isEmptyRow(r))) : []), [report, hideEmpty])
  const lines = useMemo(() => (report ? compareMonths(report, ai, bi).filter((l) => !(hideEmpty && isEmptyRow(l.row))) : []), [report, ai, bi, hideEmpty])

  const title = kind === 'pnl' ? 'Profit and loss' : 'Balance sheet'
  const btn = (on: boolean) => `px-3 py-2 rounded-lg ${on ? 'bg-slate-900 text-white' : 'bg-white border'}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button className={btn(kind === 'pnl')} onClick={() => setKind('pnl')}>
          Profit and loss
        </button>
        <button className={btn(kind === 'balance_sheet')} onClick={() => setKind('balance_sheet')}>
          Balance sheet
        </button>
        <span className="mx-2 text-slate-300">|</span>
        <button className={btn(view === 'compare')} onClick={() => setView('compare')}>
          Compare months
        </button>
        <button className={btn(view === 'grid')} onClick={() => setView('grid')}>
          All months
        </button>
        <span className="mx-2 text-slate-300">|</span>
        <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} className="border rounded-lg px-3 py-2 bg-white">
          <option value="Accrual">Accrual basis</option>
          <option value="Cash">Cash basis</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty lines
        </label>
        <span className="ml-auto text-sm text-slate-500">{fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleString('en-GB')}` : ''}</span>
        <button onClick={sync} disabled={syncing} className="px-3 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50">
          {syncing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button onClick={() => window.print()} className="px-3 py-2 rounded-lg border bg-white">
          Print
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}

      {!report && <div className="bg-white rounded-xl shadow p-6 text-center text-slate-500">{syncing ? 'Fetching from QuickBooks…' : 'No data yet.'}</div>}

      {report && view === 'compare' && (
        <>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-sm text-slate-600">Compare</span>
            <select value={ai} onChange={(e) => setAi(Number(e.target.value))} className="border rounded-lg px-3 py-2 bg-white">
              {months.map((i) => (
                <option key={i} value={i}>
                  {report.columns[i].label}
                </option>
              ))}
            </select>
            <span className="text-sm text-slate-600">with</span>
            <select value={bi} onChange={(e) => setBi(Number(e.target.value))} className="border rounded-lg px-3 py-2 bg-white">
              {months.map((i) => (
                <option key={i} value={i}>
                  {report.columns[i].label}
                </option>
              ))}
            </select>
            <button className="px-3 py-2 rounded-lg border bg-white text-sm" onClick={() => { setAi(months[months.length - 1]); setBi(months[Math.max(0, months.length - 2)]) }}>
              Latest vs previous month
            </button>
            {sameMonthLastYear !== null && (
              <button className="px-3 py-2 rounded-lg border bg-white text-sm" onClick={() => { setAi(months[months.length - 1]); setBi(sameMonthLastYear) }}>
                Latest vs same month last year
              </button>
            )}
          </div>
          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <h2 className="p-3 font-semibold">
              {title}: {report.columns[ai]?.label} compared with {report.columns[bi]?.label}
            </h2>
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-3"></th>
                  <th className="p-3 text-right">{report.columns[ai]?.label}</th>
                  <th className="p-3 text-right">{report.columns[bi]?.label}</th>
                  <th className="p-3 text-right">Change</th>
                  <th className="p-3 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className={rowClass(l.row)}>
                    <td className="p-2" style={{ paddingLeft: 12 + l.row.depth * 16 }}>
                      {l.row.label}
                    </td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(l.a)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(l.b)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtChange(l.change)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtPct(l.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {kind === 'balance_sheet' && <p className="text-xs text-slate-500">Balance sheet figures are balances at the end of each month (the latest column is as at today).</p>}
        </>
      )}

      {report && view === 'grid' && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <h2 className="p-3 font-semibold">{title} by month</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-3 sticky left-0 bg-slate-100"></th>
                {report.columns.map((c, i) => (
                  <th key={i} className="p-3 text-right whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className={rowClass(r)}>
                  <td className="p-2 sticky left-0 bg-white whitespace-nowrap" style={{ paddingLeft: 12 + r.depth * 16 }}>
                    {r.label}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className="p-2 text-right tabular-nums whitespace-nowrap">
                      {fmtMoney(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
