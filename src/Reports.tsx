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
const rowClass = (r: ReportRow, detail: Detail, last: boolean) =>
  r.kind === 'header'
    ? 'sect'
    : r.kind === 'total' && (detail === 'full' || r.depth === 0)
      ? last
        ? 'grand'
        : 'tot'
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
  const monthSelect = (value: number, set: (i: number) => void, label: string) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))} className="field" aria-label={label}>
      {report && months.map((i) => <option key={i} value={i}>{report.columns[i].label}</option>)}
    </select>
  )
  const partial = kind === 'pnl' && report ? isPartialMonth(report.columns[ai]) : false
  const sticky = 'stick whitespace-nowrap'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <div className="seg" role="group" aria-label="Report">
          <button aria-pressed={kind === 'pnl'} onClick={() => setKind('pnl')}>Profit and loss</button>
          <button aria-pressed={kind === 'balance_sheet'} onClick={() => setKind('balance_sheet')}>Balance sheet</button>
        </div>
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'trend'} onClick={() => setView('trend')}>Vs last N months</button>
          <button aria-pressed={view === 'two'} onClick={() => setView('two')}>Two months</button>
          <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>All months</button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="hidden text-sm text-muted sm:inline">
            {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </span>
          <button onClick={sync} disabled={syncing} className="btn btn-primary">{syncing ? 'Refreshing…' : 'Refresh'}</button>
          <button onClick={() => window.print()} className="btn">Print</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-sm text-muted">
          Detail
          <select value={detail} onChange={(e) => setDetail(e.target.value as Detail)} className="field text-ink">
            {(Object.keys(DETAIL_LABELS) as Detail[]).map((d) => (
              <option key={d} value={d}>{DETAIL_LABELS[d]}</option>
            ))}
          </select>
        </label>
        <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} className="field" aria-label="Accounting basis">
          <option value="Accrual">Accrual basis</option>
          <option value="Cash">Cash basis</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty lines
        </label>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {!report && <div className="panel p-8 text-center text-muted">{syncing ? 'Fetching from QuickBooks…' : 'No data yet. Press Refresh to pull it from QuickBooks.'}</div>}

      {report && view === 'trend' && trend && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
            <span className="text-sm text-muted">Compare</span>
            {monthSelect(ai, setAi, 'Month to compare')}
            <span className="text-sm text-muted">with the previous</span>
            <div className="seg" role="group" aria-label="Months to compare with">
              {[2, 3, 4, 5, 6, 12].filter((x) => x <= maxN).map((x) => (
                <button key={x} aria-pressed={nUsed === x} onClick={() => setN(x)}>{x}</button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              max={maxN}
              value={nUsed}
              onChange={(e) => setN(Number(e.target.value) || 1)}
              className="field w-20"
              aria-label="Number of previous months"
            />
            <span className="text-sm text-muted">months (up to {maxN} available)</span>
          </div>
          {partial && (
            <div className="notice notice-warn flex flex-wrap items-center gap-3 print:hidden">
              <span>
                {report.columns[ai].label} is month to date (to {fmtDate(report.columns[ai].end)}), so it will look lower than complete months.
              </span>
              {baseOrder > 0 && (
                <button className="btn btn-sm" onClick={() => setAi(months[baseOrder - 1])}>
                  Use {report.columns[months[baseOrder - 1]].label}, the last full month
                </button>
              )}
            </div>
          )}
          <div className="panel overflow-x-auto">
            <h2 className="px-4 pb-1 pt-4 text-[1.0625rem]">
              {title}: {report.columns[ai].label} compared with the previous {nUsed} month{nUsed > 1 ? 's' : ''}
            </h2>
            <table className="ledger">
              <thead>
                <tr>
                  <th className={`${sticky}`}></th>
                  <th className="num">{report.columns[ai].label}</th>
                  {trend.prevIdx.map((i) => (
                    <th key={i} className="num">{report.columns[i].label}</th>
                  ))}
                  <th className="num border-l">Average of {nUsed}</th>
                  <th className="num">Change</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {trendLines.map((l, i) => (
                  <tr key={i} className={rowClass(l.row, detail, i === trendLines.length - 1)}>
                    <td className={sticky} style={{ paddingLeft: 12 + l.row.depth * 16 }}>{lab(l.row)}</td>
                    <td className="num">{fmtMoney(l.base)}</td>
                    {l.prev.map((v, k) => (
                      <td key={k} className="num text-muted">{fmtMoney(v)}</td>
                    ))}
                    <td className="num border-l">{fmtMoney(l.avg)}</td>
                    <td className="num">{fmtChange(l.change)}</td>
                    <td className="num">{fmtPct(l.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Change and % compare {report.columns[ai].label} with the average of the previous {nUsed} month{nUsed > 1 ? 's' : ''}. A month with no activity counts as £0.
          </p>
        </>
      )}

      {report && view === 'two' && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
            <span className="text-sm text-muted">Compare</span>
            {monthSelect(ai, setAi, 'First month')}
            <span className="text-sm text-muted">with</span>
            {monthSelect(bi, setBi, 'Second month')}
            <button className="btn btn-sm" onClick={() => { setAi(months[months.length - 1]); setBi(months[Math.max(0, months.length - 2)]) }}>
              Latest vs previous month
            </button>
            {months.length >= 13 && (
              <button className="btn btn-sm" onClick={() => { setAi(months[months.length - 1]); setBi(months[months.length - 13]) }}>
                Latest vs same month last year
              </button>
            )}
          </div>
          <div className="panel overflow-x-auto">
            <h2 className="px-4 pb-1 pt-4 text-[1.0625rem]">{title}: {report.columns[ai]?.label} compared with {report.columns[bi]?.label}</h2>
            <table className="ledger">
              <thead>
                <tr>
                  <th></th>
                  <th className="num">{report.columns[ai]?.label}</th>
                  <th className="num">{report.columns[bi]?.label}</th>
                  <th className="num">Change</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {two.map((l, i) => (
                  <tr key={i} className={rowClass(l.row, detail, i === two.length - 1)}>
                    <td style={{ paddingLeft: 12 + l.row.depth * 16 }}>{lab(l.row)}</td>
                    <td className="num">{fmtMoney(l.a)}</td>
                    <td className="num">{fmtMoney(l.b)}</td>
                    <td className="num">{fmtChange(l.change)}</td>
                    <td className="num">{fmtPct(l.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {report && view === 'grid' && (
        <div className="panel overflow-x-auto">
          <h2 className="px-4 pb-1 pt-4 text-[1.0625rem]">{title} by month</h2>
          <table className="ledger">
            <thead>
              <tr>
                <th className={sticky}></th>
                {report.columns.map((c, i) => (
                  <th key={i} className="num">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((r, ri) => (
                <tr key={ri} className={rowClass(r, detail, ri === grid.length - 1)}>
                  <td className={sticky} style={{ paddingLeft: 12 + r.depth * 16 }}>{lab(r)}</td>
                  {r.values.map((v, i) => (
                    <td key={i} className="num whitespace-nowrap">{fmtMoney(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {kind === 'balance_sheet' && report && (
        <p className="text-xs text-muted">Balance sheet figures are balances at the end of each month. The latest column is as at today.</p>
      )}
    </div>
  )
}
