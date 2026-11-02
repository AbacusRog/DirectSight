import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Login from './Login'
import RuleEditor from './RuleEditor'
import { api, configMissing, fmtDate, gbp, supabase } from './lib/supabase'
import { describeRule, suggestForSupplier } from './lib/paymentDates'
import { BUCKETS, type Company, type Snapshot, type SupplierRule, type VendorBalance } from './lib/types'

// Refresh from QuickBooks on open if the cached snapshot is older than this.
const STALE_MS = 15 * 60 * 1000

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (configMissing) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (configMissing)
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md bg-white rounded-xl shadow p-6 space-y-2">
          <h1 className="text-lg font-semibold">App not configured</h1>
          <p className="text-sm text-slate-600">
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are not set. Add them under the Cloudflare
            Pages project's Variables and Secrets (as plain variables), then redeploy – they are baked in at build time.
          </p>
        </div>
      </div>
    )
  if (session === undefined) return null
  if (!session) return <Login />
  return <Main />
}

function Main() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [realm, setRealm] = useState<string>(() => localStorage.getItem('ac_realm') ?? '')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [rules, setRules] = useState<Record<string, SupplierRule>>({})
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'aged' | 'schedule'>('aged')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<SupplierRule | null>(null)
  const loadedRealm = useRef('')
  const [notice, setNotice] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  // Result of the QuickBooks consent redirect (?connected=… / ?connect_error=…)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const ok = q.get('connected')
    const bad = q.get('connect_error')
    if (ok) setNotice(`Connected to ${ok}.`)
    if (bad) setError(bad)
    if (ok || bad) window.history.replaceState({}, '', window.location.pathname)
  }, [])

  async function checkKeys() {
    setError(null)
    setNotice(null)
    try {
      const r = await api<{ client_id: string; secret: string; intuit_says: string; verdict: string }>('/api/qbo-check')
      setNotice(`QuickBooks keys – client ID ${r.client_id}; secret ${r.secret}; Intuit replied ${r.intuit_says || 'n/a'}. ${r.verdict}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function connect() {
    const label = window.prompt('Name for this company (e.g. the client\'s name):')
    if (!label?.trim()) return
    setConnecting(true)
    setError(null)
    try {
      const { url } = await api<{ url: string }>('/api/connect', { method: 'POST', body: JSON.stringify({ label }) })
      window.location.href = url
    } catch (e) {
      setError((e as Error).message)
      setConnecting(false)
    }
  }

  useEffect(() => {
    api<Company[]>('/api/companies')
      .then((c) => {
        setCompanies(c)
        setRealm((cur) => (c.some((x) => x.realm_id === cur) ? cur : c[0]?.realm_id ?? ''))
      })
      .catch((e) => setError(e.message))
  }, [])

  const readSnapshot = useCallback(async (r: string) => {
    const { data, error } = await supabase.from('ac_snapshots').select('*').eq('realm_id', r).maybeSingle()
    if (error) throw error
    setSnap(data as Snapshot | null)
    return data as Snapshot | null
  }, [])

  const sync = useCallback(
    async (r: string) => {
      setSyncing(true)
      setError(null)
      try {
        await api('/api/sync', { method: 'POST', body: JSON.stringify({ realm_id: r }) })
        await readSnapshot(r)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setSyncing(false)
      }
    },
    [readSnapshot],
  )

  // On open / company change: show the cached snapshot straight away, refresh if it is stale.
  useEffect(() => {
    if (!realm || loadedRealm.current === realm) return
    loadedRealm.current = realm
    localStorage.setItem('ac_realm', realm)
    setSnap(null)
    setOpen(null)
    ;(async () => {
      try {
        const [s, rl] = await Promise.all([
          readSnapshot(realm),
          supabase.from('ac_supplier_rules').select('*').eq('realm_id', realm),
        ])
        if (rl.error) throw rl.error
        setRules(Object.fromEntries((rl.data as SupplierRule[]).map((x) => [x.vendor_id, x])))
        if (!s || Date.now() - new Date(s.fetched_at).getTime() > STALE_MS) await sync(realm)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [realm, readSnapshot, sync])

  const today = todayISO()
  const rows = useMemo(
    () => (snap?.vendors ?? []).map((v) => ({ v, s: suggestForSupplier(v, rules[v.vendor_id], today) })),
    [snap, rules, today],
  )

  const totals = useMemo(() => {
    const t = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91plus: 0, total: 0 }
    for (const { v } of rows) {
      for (const b of BUCKETS) t[b.key] += v.buckets[b.key]
      t.total += v.total
    }
    return t
  }, [rows])

  const schedule = useMemo(() => {
    const byDate = new Map<string, { vendor: VendorBalance; amount: number; reasons: Set<string> }[]>()
    const held: { vendor: VendorBalance; amount: number }[] = []
    for (const { v, s } of rows) {
      const perDate = new Map<string, { amount: number; reasons: Set<string> }>()
      let heldAmt = 0
      for (const b of s.per_bill) {
        if (!b.pay_on) {
          if (s.on_hold && b.bill.open_balance > 0) heldAmt += b.bill.open_balance
          continue
        }
        const e = perDate.get(b.pay_on) ?? { amount: 0, reasons: new Set<string>() }
        e.amount += b.bill.open_balance
        e.reasons.add(b.reason)
        perDate.set(b.pay_on, e)
      }
      for (const [d, e] of perDate) byDate.set(d, [...(byDate.get(d) ?? []), { vendor: v, ...e }])
      if (heldAmt) held.push({ vendor: v, amount: heldAmt })
    }
    return { dates: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)), held }
  }, [rows])

  async function saveRule(r: SupplierRule) {
    const { id: _id, ...payload } = r
    const { data, error } = await supabase
      .from('ac_supplier_rules')
      .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: 'realm_id,vendor_id' })
      .select()
      .single()
    if (error) throw error
    setRules((cur) => ({ ...cur, [r.vendor_id]: data as SupplierRule }))
    setEditing(null)
  }

  const newRule = (v: VendorBalance): SupplierRule =>
    rules[v.vendor_id] ?? {
      realm_id: realm,
      vendor_id: v.vendor_id,
      vendor_name: v.name,
      terms_type: 'due_date',
      terms_days: null,
      day_of_month: null,
      weekday: null,
      hold: false,
      notes: null,
    }

  const overdue = totals.total - totals.current

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold mr-auto">Aged Creditors</h1>
        {companies.length > 0 && (
          <select value={realm} onChange={(e) => setRealm(e.target.value)} className="border rounded-lg px-3 py-2 bg-white">
            {companies.map((c) => (
              <option key={c.realm_id} value={c.realm_id}>
                {c.company_name ?? c.label}
              </option>
            ))}
          </select>
        )}
        <button onClick={checkKeys} className="px-3 py-2 rounded-lg border bg-white">
          Check QuickBooks keys
        </button>
        <button onClick={connect} disabled={connecting} className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50">
          {connecting ? 'Opening QuickBooks…' : 'Connect a company'}
        </button>
        <span className="text-sm text-slate-500">
          {snap ? `Updated ${new Date(snap.fetched_at).toLocaleString('en-GB')}` : 'No data yet'}
        </span>
        <button
          onClick={() => realm && sync(realm)}
          disabled={syncing || !realm}
          className="px-3 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50"
        >
          {syncing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button onClick={() => supabase.auth.signOut()} className="px-3 py-2 rounded-lg border bg-white">
          Sign out
        </button>
      </header>

      {notice && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">{notice}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}

      {companies.length === 0 && !error && (
        <div className="bg-white rounded-xl shadow p-6 text-center text-slate-600">
          No company connected yet. Use <b>Connect a company</b> and sign in to QuickBooks as someone with access to that company.
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Total owed" value={gbp(totals.total)} />
        <Card label="Overdue" value={gbp(overdue)} />
        <Card label="Over 60 days overdue" value={gbp(totals.d61_90 + totals.d91plus)} />
        <Card label="Suppliers" value={String(rows.length)} />
      </section>

      <nav className="flex gap-2">
        {(['aged', 'schedule'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg ${tab === t ? 'bg-slate-900 text-white' : 'bg-white border'}`}
          >
            {t === 'aged' ? 'Aged creditors' : 'Payment schedule'}
          </button>
        ))}
      </nav>

      {tab === 'aged' && (
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-3">Supplier</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} className="p-3 text-right whitespace-nowrap">
                    {b.label}
                  </th>
                ))}
                <th className="p-3 text-right">Total</th>
                <th className="p-3">Suggested payment</th>
                <th className="p-3">Rule</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, s }) => (
                <Fragment key={v.vendor_id}>
                  <tr className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(open === v.vendor_id ? null : v.vendor_id)}>
                    <td className="p-3 font-medium">{v.name}</td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className={`p-3 text-right tabular-nums ${b.key === 'd91plus' && v.buckets.d91plus ? 'text-red-600' : ''}`}>
                        {gbp(v.buckets[b.key])}
                      </td>
                    ))}
                    <td className="p-3 text-right font-semibold tabular-nums">{gbp(v.total)}</td>
                    <td className="p-3 whitespace-nowrap">
                      {s.on_hold ? (
                        <span className="text-amber-600">On hold</span>
                      ) : s.next_pay_on ? (
                        <>
                          {fmtDate(s.next_pay_on)} <span className="text-slate-500">· {gbp(s.amount_on_next)}</span>
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="p-3">
                      <button
                        className="text-blue-600 hover:underline text-left"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditing(newRule(v))
                        }}
                      >
                        {describeRule(rules[v.vendor_id])}
                      </button>
                    </td>
                  </tr>
                  {open === v.vendor_id && (
                    <tr className="bg-slate-50">
                      <td colSpan={9} className="p-3">
                        {rules[v.vendor_id]?.notes && <p className="mb-2 text-slate-600">📝 {rules[v.vendor_id].notes}</p>}
                        <table className="w-full text-xs">
                          <thead className="text-left text-slate-500">
                            <tr>
                              <th className="py-1">Type</th>
                              <th>Ref</th>
                              <th>Bill date</th>
                              <th>Due</th>
                              <th className="text-right">Days overdue</th>
                              <th className="text-right">Open</th>
                              <th className="pl-4">Suggested</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.per_bill.map(({ bill, pay_on, reason }, i) => (
                              <tr key={i} className="border-t">
                                <td className="py-1">{bill.type}</td>
                                <td>{bill.num ?? ''}</td>
                                <td>{fmtDate(bill.date)}</td>
                                <td>{fmtDate(bill.due)}</td>
                                <td className="text-right">{bill.days_overdue > 0 ? bill.days_overdue : ''}</td>
                                <td className="text-right tabular-nums">{gbp(bill.open_balance)}</td>
                                <td className="pl-4">
                                  {pay_on ? `${fmtDate(pay_on)} – ${reason}` : reason}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length > 0 && (
                <tr className="border-t-2 font-semibold bg-slate-100">
                  <td className="p-3">Total</td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="p-3 text-right tabular-nums">
                      {gbp(totals[b.key])}
                    </td>
                  ))}
                  <td className="p-3 text-right tabular-nums">{gbp(totals.total)}</td>
                  <td colSpan={2} />
                </tr>
              )}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-500">
                    {syncing ? 'Fetching from QuickBooks…' : 'No unpaid bills.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="space-y-3">
          {schedule.dates.map(([date, items]) => (
            <div key={date} className="bg-white rounded-xl shadow p-4">
              <div className="flex justify-between font-semibold mb-2">
                <span>{new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
                <span className="tabular-nums">{gbp(items.reduce((a, i) => a + i.amount, 0))}</span>
              </div>
              <ul className="text-sm divide-y">
                {items.map((i) => (
                  <li key={i.vendor.vendor_id} className="py-1 flex justify-between gap-4">
                    <span>
                      {i.vendor.name} <span className="text-slate-500">· {[...i.reasons].join('; ')}</span>
                    </span>
                    <span className="tabular-nums">{gbp(i.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {schedule.held.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
              <p className="font-semibold mb-1">On hold</p>
              {schedule.held.map((h) => (
                <p key={h.vendor.vendor_id}>
                  {h.vendor.name} – {gbp(h.amount)}
                </p>
              ))}
            </div>
          )}
          {schedule.dates.length === 0 && schedule.held.length === 0 && (
            <p className="text-center text-slate-500 p-6">Nothing to schedule.</p>
          )}
          <p className="text-xs text-slate-500">
            Weekend dates move to the Friday before (or Monday if that has passed). UK bank holidays aren't accounted for.
          </p>
        </div>
      )}

      {editing && <RuleEditor rule={editing} onSave={saveRule} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
