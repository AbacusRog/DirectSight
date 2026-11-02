import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtDate, supabase } from './lib/supabase'
import {
  DETAIL_LABELS,
  compareMonths,
  compareToPrevious,
  displayLabel,
  fmtChange,
  fmtMoney,
  fmtPct,
  isEmptyRow,
  isPartialMonth,
  monthIndexes,
  visibleInDetail,
  type Detail,
  type MonthlyReport,
  type ReportRow,
} from './lib/reportCompare'

type Kind = 'pnl' | 'balance_sheet'
type Basis = 'Accrual' | 'Cash'
type View = 'trend' | 'two' | 'grid'
const STALE_MS = 60 * 60 * 1000 // re-pull from QuickBooks on open if older than an hour

// In the compact views a collapsed sub-section ("Total Advertising") is shown as an ordinary line, not a grand total.
const rowClass = (r: ReportRow, detail: Detail) =>
  r.kind === 'header'
    ? 'font-semibold bg-slate-50'
    : r.kind === 'total' && (detail === 'full' || r.depth === 0)
      ? 'font-semibold border-t bg-slate-50/60'
      : ''

export default function Reports({ realm }: { realm: string }) {
  const [kind, setKind] = useState<Kind>('pnl')
  const [basis, setBasis] = useState<Basis>('Accrual')
  const [view, setView] = useState<View>('trend')
  const [detail, setDetail] = useState<Detail>('category')
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [ai, setAi] = useState(0) // main month
  const [bi, setBi] = useState(0) // comparison month (two-month view)
  const [n, setN] = useState(3) // how many previous months (trend view)

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

  // Default: latest month, compared with the one before.
  useEffect(() => {
    if (months.length) {
      setAi(months[months.length - 1])
      setBi(months[Math.max(0, months.length - 2)])
    }
  }, [months])

  const keep = useCallback((r: ReportRow) => visibleInDetail(r, detail) && !(hideEmpty && isEmptyRow(r)), [detail, hideEmpty])
  const lab = (r: ReportRow) => displayLabel(r, detail)

  const baseOrder = months.indexOf(ai) // how many months exist before the chosen one
  const maxN = Math.max(1, baseOrder)
  const nUsed = Math.min(Math.max(1, n), maxN)

  const grid = useMemo(() => (report ? report.rows.filter(keep) : []), [report, keep])
  const two = useMemo(() => (report ? compareMonths(report, ai, bi).filter((l) => keep(l.row)) : []), [report, ai, bi, keep])
  const trend = useMemo(() => (report ? compareToPrevious(report, ai, nUsed) : null), [report, ai, nUsed])
  const trendLines = useMemo(() => (trend ? trend.lines.filter((l) => keep(l.row)) : []), [trend, keep])

  const title = kind === 'pnl' ? 'Profit and loss' : 'Balance sheet'
  const btn = (on: boolean) => `px-3 py-2 rounded-lg ${on ? 'bg-slate-900 text-white' : 'bg-white border'}`
  const small = (on: boolean) => `px-3 py-1.5 rounded-lg text-sm ${on ? 'bg-slate-900 text-white' : 'bg-white border'}`
  const monthSelect = (value: number, set: (i: number) => void) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))} className="border rounded-lg px-3 py-2 bg-white">
      {report && months.map((i) => <option key={i} value={i}>{report.columns[i].label}</option>)}
    </select>
  )
  const partial = kind === 'pnl' && report ? isPartialMonth(report.columns[ai]) : false

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button className={btn(kind === 'pnl')} onClick={() => setKind('pnl')}>Profit and loss</button>
        <button className={btn(kind === 'balance_sheet')} onClick={() => setKind('balance_sheet')}>Balance sheet</button>
        <span className="mx-2 text-slate-300">|</span>
        <button className={btn(view === 'trend')} onClick={() => setView('trend')}>Vs last N months</button>
        <button className={btn(view === 'two')} onClick={() => setView('two')}>Two months</button>
        <button className={btn(view === 'grid')} onClick={() => setView('grid')}>All months</button>
        <span className="ml-auto text-sm text-slate-500">{fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleString('en-GB')}` : ''}</span>
        <button onClick={sync} disabled={syncing} className="px-3 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50">
          {syncing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button onClick={() => window.print()} className="px-3 py-2 rounded-lg border bg-white">Print</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <label className="flex items-center gap-2 text-sm">
          Detail
          <select value={detail} onChange={(e) => setDetail(e.target.value as Detail)} className="border rounded-lg px-3 py-2 bg-white">
            {(Object.keys(DETAIL_LABELS) as Detail[]).map((d) => (
              <option key={d} value={d}>{DETAIL_LABELS[d]}</option>
            ))}
          </select>
        </label>
        <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} className="border rounded-lg px-3 py-2 bg-white">
          <option value="Accrual">Accrual basis</option>
          <option value="Cash">Cash basis</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty lines
        </label>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}
      {!report && <div className="bg-white rounded-xl shadow p-6 text-center text-slate-500">{syncing ? 'Fetching from QuickBooks…' : 'No data yet.'}</div>}

      {report && view === 'trend' && trend && (
        <>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-sm text-slate-600">Compare</span>
            {monthSelect(ai, setAi)}
            <span className="text-sm text-slate-600">with the previous</span>
            {[2, 3, 4, 5, 6, 12].filter((x) => x <= maxN).map((x) => (
              <button key={x} className={small(nUsed === x)} onClick={() => setN(x)}>{x}</button>
            ))}
            <input
              type="number"
              min={1}
              max={maxN}
              value={nUsed}
              onChange={(e) => setN(Number(e.target.value) || 1)}
              className="w-20 border rounded-lg px-2 py-1.5 bg-white text-sm"
              aria-label="Number of previous months"
            />
            <span className="text-sm text-slate-600">months (up to {maxN} available)</span>
          </div>
          {partial && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 print:hidden">
              <span>
                {report.columns[ai].label} is month to date (to {fmtDate(report.columns[ai].end)}), so it will look lower than complete months.
              </span>
              {baseOrder > 0 && (
                <button className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white" onClick={() => setAi(months[baseOrder - 1])}>
                  Use {report.columns[months[baseOrder - 1]].label} (last full month)
                </button>
              )}
            </div>
          )}
          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <h2 className="p-3 font-semibold">
              {title}: {report.columns[ai].label} compared with the previous {nUsed} month{nUsed > 1 ? 's' : ''}
            </h2>
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-3 sticky left-0 bg-slate-100"></th>
                  <th className="p-3 text-right whitespace-nowrap">{report.columns[ai].label}</th>
                  {trend.prevIdx.map((i) => (
                    <th key={i} className="p-3 text-right whitespace-nowrap text-slate-600">{report.columns[i].label}</th>
                  ))}
                  <th className="p-3 text-right whitespace-nowrap border-l">Average of {nUsed}</th>
                  <th className="p-3 text-right">Change</th>
                  <th className="p-3 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {trendLines.map((l, i) => (
                  <tr key={i} className={rowClass(l.row, detail)}>
                    <td className="p-2 sticky left-0 bg-white whitespace-nowrap" style={{ paddingLeft: 12 + l.row.depth * 16 }}>{lab(l.row)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(l.base)}</td>
                    {l.prev.map((v, k) => (
                      <td key={k} className="p-2 text-right tabular-nums text-slate-600">{fmtMoney(v)}</td>
                    ))}
                    <td className="p-2 text-right tabular-nums border-l">{fmtMoney(l.avg)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtChange(l.change)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtPct(l.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Change and % compare {report.columns[ai].label} with the average of the previous {nUsed} month{nUsed > 1 ? 's' : ''} (a month with no activity counts as £0).</p>
        </>
      )}

      {report && view === 'two' && (
        <>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-sm text-slate-600">Compare</span>
            {monthSelect(ai, setAi)}
            <span className="text-sm text-slate-600">with</span>
            {monthSelect(bi, setBi)}
            <button className="px-3 py-2 rounded-lg border bg-white text-sm" onClick={() => { setAi(months[months.length - 1]); setBi(months[Math.max(0, months.length - 2)]) }}>
              Latest vs previous month
            </button>
            {months.length >= 13 && (
              <button className="px-3 py-2 rounded-lg border bg-white text-sm" onClick={() => { setAi(months[months.length - 1]); setBi(months[months.length - 13]) }}>
                Latest vs same month last year
              </button>
            )}
          </div>
          <div className="bg-white rounded-xl shadow overflow-x-auto">
            <h2 className="p-3 font-semibold">{title}: {report.columns[ai]?.label} compared with {report.columns[bi]?.label}</h2>
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
                {two.map((l, i) => (
                  <tr key={i} className={rowClass(l.row, detail)}>
                    <td className="p-2" style={{ paddingLeft: 12 + l.row.depth * 16 }}>{lab(l.row)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(l.a)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(l.b)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtChange(l.change)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtPct(l.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <th key={i} className="p-3 text-right whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((r, ri) => (
                <tr key={ri} className={rowClass(r, detail)}>
                  <td className="p-2 sticky left-0 bg-white whitespace-nowrap" style={{ paddingLeft: 12 + r.depth * 16 }}>{lab(r)}</td>
                  {r.values.map((v, i) => (
                    <td key={i} className="p-2 text-right tabular-nums whitespace-nowrap">{fmtMoney(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {kind === 'balance_sheet' && report && <p className="text-xs text-slate-500">Balance sheet figures are balances at the end of each month (the latest column is as at today).</p>}
    </div>
  )
}
