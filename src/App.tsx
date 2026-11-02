import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Login from './Login'
import RuleEditor from './RuleEditor'
import Reports from './Reports'
import { AgeBar, AgeStrip, Brand, ThemeToggle } from './ui'
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
        <div className="panel max-w-md p-6 space-y-2">
          <h1 className="text-lg">App not configured</h1>
          <p className="text-sm text-muted">
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are not set. Add them under the Cloudflare
            Pages project's Variables and Secrets (as plain variables), then redeploy. They are baked in at build time.
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
  const [tab, setTab] = useState<'aged' | 'schedule' | 'reports'>('aged')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<SupplierRule | null>(null)
  const loadedRealm = useRef('')
  const [notice, setNotice] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [menu, setMenu] = useState(false)
  // Who is signed in. Until the server answers, assume the most restricted view.
  const [me, setMe] = useState<{ role: 'admin' | 'client'; access: { realm_id: string; can_edit_rules: boolean }[] } | null>(null)
  useEffect(() => {
    api<{ role: 'admin' | 'client'; access: { realm_id: string; can_edit_rules: boolean }[] }>('/api/me')
      .then(setMe)
      .catch((e) => setError(e.message))
  }, [])
  const isAdmin = me?.role === 'admin'

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

  const canEditRules = isAdmin || !!me?.access.find((x) => x.realm_id === realm)?.can_edit_rules
  const overdue = totals.total - totals.current
  const late60 = totals.d61_90 + totals.d91plus
  const AGE_CLASS = { d1_30: 'age-1', d31_60: 'age-2', d61_90: 'age-3', d91plus: 'age-4' } as const
  const chevron = (isOpen: boolean) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Brand />
        {isAdmin && companies.length > 0 && (
          <select value={realm} onChange={(e) => setRealm(e.target.value)} className="field sm:ml-3" aria-label="Company">
            {companies.map((c) => (
              <option key={c.realm_id} value={c.realm_id}>
                {c.company_name ?? c.label}
              </option>
            ))}
          </select>
        )}
        {!isAdmin && companies.length > 0 && (
          <span className="font-serif text-[1.0625rem] text-muted sm:ml-3">{companies[0].company_name ?? companies[0].label}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2 print:hidden">
          {tab !== 'reports' && (
            <>
              <span className="hidden text-sm text-muted sm:inline">
                {snap ? `Updated ${new Date(snap.fetched_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : 'No data yet'}
              </span>
              <button onClick={() => realm && sync(realm)} disabled={syncing || !realm} className="btn btn-primary">
                {syncing ? 'Refreshing…' : 'Refresh'}
              </button>
            </>
          )}
          {isAdmin && (
          <div className="relative">
            <button className="btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
              Connections
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="panel absolute right-0 z-20 mt-1.5 w-56 p-1 shadow-lg" role="menu">
                  <button role="menuitem" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-sunken disabled:opacity-50" disabled={connecting}
                    onClick={() => { setMenu(false); connect() }}>
                    {connecting ? 'Opening QuickBooks…' : 'Connect a company'}
                  </button>
                  <button role="menuitem" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-sunken"
                    onClick={() => { setMenu(false); checkKeys() }}>
                    Check QuickBooks keys
                  </button>
                </div>
              </>
            )}
          </div>
          )}
          <ThemeToggle />
          <button onClick={() => supabase.auth.signOut()} className="btn btn-quiet">Sign out</button>
        </div>
      </header>

      {notice && <div className="notice notice-ok">{notice}</div>}
      {error && <div className="notice notice-error">{error}</div>}

      {companies.length === 0 && !error && me && !isAdmin && (
        <div className="panel p-6">
          <h2 className="text-lg">No company set up</h2>
          <p className="mt-1 max-w-prose text-muted">This login has not been given a company yet. Contact Abacus and we will set it up.</p>
        </div>
      )}

      {companies.length === 0 && !error && isAdmin && (
        <div className="panel flex flex-col items-start gap-3 p-6">
          <h2 className="text-lg">Connect a QuickBooks company</h2>
          <p className="max-w-prose text-muted">
            Sign in to QuickBooks as someone with access to the company. Its aged creditors and management report will appear here.
          </p>
          <button onClick={connect} disabled={connecting} className="btn btn-primary">
            {connecting ? 'Opening QuickBooks…' : 'Connect a company'}
          </button>
        </div>
      )}

      {tab !== 'reports' && (
        <section className="panel">
          <div className="grid grid-cols-2 gap-y-1 md:grid-cols-4 md:divide-x md:divide-rule">
            {[
              { label: 'Total owed', value: gbp(totals.total) === '–' ? '£0' : gbp(totals.total), bad: false },
              { label: 'Overdue', value: gbp(overdue) === '–' ? '£0' : gbp(overdue), bad: overdue > 0 },
              { label: 'More than 60 days overdue', value: gbp(late60) === '–' ? '£0' : gbp(late60), bad: late60 > 0 },
              { label: 'Suppliers', value: String(rows.length), bad: false },
            ].map((k) => (
              <div key={k.label} className="px-5 py-4">
                <div className="text-[0.8125rem] text-muted">{k.label}</div>
                <div className={`font-serif text-[1.75rem] leading-tight tabular-nums ${k.bad ? 'text-bad' : ''}`}>{k.value}</div>
              </div>
            ))}
          </div>
          {totals.total > 0 && (
            <div className="border-t px-5 py-4">
              <AgeStrip totals={totals} />
            </div>
          )}
        </section>
      )}

      <nav className="tabs print:hidden" role="tablist">
        {(['aged', 'schedule', 'reports'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="tab">
            {t === 'aged' ? 'Aged creditors' : t === 'schedule' ? 'Payment schedule' : 'Management report'}
          </button>
        ))}
      </nav>

      {tab === 'reports' && realm && <Reports realm={realm} />}

      {tab === 'aged' && (
        <div className="panel overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Age</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} className="num">{b.label}</th>
                ))}
                <th className="num">Total</th>
                <th>Suggested payment</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, s }) => (
                <Fragment key={v.vendor_id}>
                  <tr className="click" onClick={() => setOpen(open === v.vendor_id ? null : v.vendor_id)}>
                    <td className="min-w-[12rem] font-medium">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left"
                        aria-expanded={open === v.vendor_id}
                        aria-label={`${v.name}: show bills`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpen(open === v.vendor_id ? null : v.vendor_id)
                        }}
                      >
                        {chevron(open === v.vendor_id)}
                        {v.name}
                      </button>
                    </td>
                    <td><AgeBar buckets={v.buckets} /></td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className={`num ${b.key !== 'current' && v.buckets[b.key] > 0 ? AGE_CLASS[b.key] : ''}`}>
                        {gbp(v.buckets[b.key])}
                      </td>
                    ))}
                    <td className="num font-semibold">{gbp(v.total)}</td>
                    <td className="whitespace-nowrap">
                      {s.on_hold ? (
                        <span className="text-warn">On hold</span>
                      ) : s.next_pay_on ? (
                        <>
                          {fmtDate(s.next_pay_on)} <span className="text-muted tabular-nums">{gbp(s.amount_on_next)}</span>
                        </>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {canEditRules ? (
                        <button
                          className="text-left text-pen underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditing(newRule(v))
                          }}
                        >
                          {describeRule(rules[v.vendor_id])}
                        </button>
                      ) : (
                        <span>{describeRule(rules[v.vendor_id])}</span>
                      )}
                    </td>
                  </tr>
                  {open === v.vendor_id && (
                    <tr>
                      <td colSpan={10} className="!bg-sunken !py-3">
                        {rules[v.vendor_id]?.notes && <p className="mb-2 text-muted">Note: {rules[v.vendor_id].notes}</p>}
                        <table className="ledger text-[0.8125rem]">
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Ref</th>
                              <th>Bill date</th>
                              <th>Due</th>
                              <th className="num">Days overdue</th>
                              <th className="num">Open</th>
                              <th>Suggested</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.per_bill.map(({ bill, pay_on, reason }, i) => (
                              <tr key={i}>
                                <td>{bill.type}</td>
                                <td>{bill.num ?? ''}</td>
                                <td>{fmtDate(bill.date)}</td>
                                <td>{fmtDate(bill.due)}</td>
                                <td className="num">{bill.days_overdue > 0 ? bill.days_overdue : ''}</td>
                                <td className="num">{gbp(bill.open_balance)}</td>
                                <td>{pay_on ? `${fmtDate(pay_on)}. ${reason}` : reason}</td>
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
                <tr className="grand">
                  <td colSpan={2}>Total</td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="num">{gbp(totals[b.key])}</td>
                  ))}
                  <td className="num">{gbp(totals.total)}</td>
                  <td colSpan={2} />
                </tr>
              )}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="!py-10 text-center text-muted">
                    {syncing ? 'Fetching from QuickBooks…' : companies.length ? 'No unpaid bills.' : 'Connect a company to see its creditors.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'schedule' && (
        <div className="space-y-4">
          {schedule.dates.map(([date, items]) => (
            <section key={date} className="panel">
              <div className="flex items-baseline justify-between gap-4 border-b px-5 py-3">
                <h3 className="text-[1.0625rem]">
                  {new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </h3>
                <span className="font-serif text-lg tabular-nums">{gbp(items.reduce((a, i) => a + i.amount, 0))}</span>
              </div>
              <ul className="divide-y divide-rule text-sm">
                {items.map((i) => (
                  <li key={i.vendor.vendor_id} className="flex justify-between gap-4 px-5 py-2.5">
                    <span>
                      {i.vendor.name} <span className="text-muted">{[...i.reasons].join('; ')}</span>
                    </span>
                    <span className="tabular-nums">{gbp(i.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {schedule.held.length > 0 && (
            <div className="notice notice-warn">
              <p className="mb-1 font-semibold">On hold</p>
              {schedule.held.map((h) => (
                <p key={h.vendor.vendor_id}>
                  {h.vendor.name}: {gbp(h.amount)}
                </p>
              ))}
            </div>
          )}
          {schedule.dates.length === 0 && schedule.held.length === 0 && <p className="p-6 text-center text-muted">Nothing to schedule.</p>}
          <p className="text-xs text-muted">
            Weekend dates move to the Friday before, or to Monday if that has passed. UK bank holidays aren't accounted for.
          </p>
        </div>
      )}

      {editing && <RuleEditor rule={editing} onSave={saveRule} onClose={() => setEditing(null)} />}
    </div>
  )
}
