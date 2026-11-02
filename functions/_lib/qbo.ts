// Shared helpers for the Pages Functions. Dependency-free (fetch only).
// This app keeps its own QuickBooks connections in public.ac_connections (separate from the
// other Abacus apps). Every token refresh MUST be written straight back: Intuit rotates refresh tokens.

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  QBO_CLIENT_ID: string
  QBO_CLIENT_SECRET: string
  CRON_SECRET?: string
}

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company'

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** Project base URL, tolerating a trailing slash or /rest/v1 pasted on the end. */
export const supaUrl = (env: Env) => env.SUPABASE_URL.trim().replace(/\/(rest|auth|storage|functions)\/v1.*$/i, '').replace(/\/+$/, '')

function sbHeaders(env: Env, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  }
}

export async function sb(env: Env, path: string, init: RequestInit = {}, extra: Record<string, string> = {}) {
  const res = await fetch(`${supaUrl(env)}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders(env, extra), ...(init.headers as Record<string, string> | undefined) },
  })
  if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]} failed (${res.status}): ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export type AuthResult = { who: 'staff' | 'cron' } | { error: string }

/**
 * Allow either a signed-in admin (Supabase JWT) or the daily job (CRON_SECRET).
 * On refusal, says exactly why, because the usual cause is a Cloudflare variable from the wrong project.
 */
export async function authorise(request: Request, env: Env): Promise<AuthResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (Cloudflare Pages > Settings > Variables and Secrets, Production), then redeploy.' }
  }
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: 'Not signed in (no login token sent).' }

  if (env.CRON_SECRET && token === env.CRON_SECRET) return { who: 'cron' }

  // 1. Is the user's JWT valid for THIS Supabase project?
  const user = await fetch(`${supaUrl(env)}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY.trim(), authorization: `Bearer ${token}` },
  })
  if (!user.ok) {
    return {
      error: `Supabase rejected your login (${user.status}). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must belong to the same project you sign in to (VITE_SUPABASE_URL = Clients).`,
    }
  }

  // 2. Are they an admin? (is_admin() reads auth.uid() from user_roles.)
  const rpc = await fetch(`${supaUrl(env)}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY.trim(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  })
  if (!rpc.ok) return { error: `Admin check failed (${rpc.status}): ${(await rpc.text()).slice(0, 160)}` }
  if ((await rpc.json()) !== true) return { error: 'You are signed in, but this login is not an admin in the Clients project (user_roles).' }
  return { who: 'staff' } // 'staff' = signed-in admin
}

interface Connection {
  realm_id: string
  label: string
  company_name: string | null
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
}

async function loadConnection(env: Env, realm: string): Promise<Connection> {
  const rows = await sb(env, `ac_connections?realm_id=eq.${encodeURIComponent(realm)}&select=*`)
  if (!rows?.length) throw new Error('No QuickBooks connection for that company')
  return rows[0]
}

async function logCall(env: Env, realm: string, endpoint: string, status: number, tid: string | null, message?: string) {
  try {
    await sb(
      env,
      'qbo_api_log',
      { method: 'POST', body: JSON.stringify({ realm_id: realm, endpoint, status, intuit_tid: tid, message: message?.slice(0, 500) ?? null }) },
      { prefer: 'return=minimal' },
    )
  } catch {
    /* logging must never break a sync */
  }
}

async function refresh(env: Env, conn: Connection): Promise<Connection> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  })
  const tid = res.headers.get('intuit_tid')
  if (!res.ok) {
    await logCall(env, conn.realm_id, 'oauth2/tokens/bearer', res.status, tid, 'refresh failed')
    // Another app may have rotated the token a moment ago: re-read once before giving up.
    const latest = await loadConnection(env, conn.realm_id)
    if (latest.refresh_token !== conn.refresh_token) return latest
    throw new Error(`QuickBooks token refresh failed (${res.status}). Reconnect ${conn.label} in your QuickBooks connections.`)
  }
  const t = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    x_refresh_token_expires_in: number
  }
  const now = Date.now()
  const patch = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    access_expires_at: new Date(now + t.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now + t.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  }
  await sb(env, `ac_connections?realm_id=eq.${encodeURIComponent(conn.realm_id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, { prefer: 'return=minimal' })
  await logCall(env, conn.realm_id, 'oauth2/tokens/bearer', res.status, tid, 'refreshed')
  return { ...conn, ...patch }
}

async function fetchReport(env: Env, realm: string, conn: Connection, asOf: string) {
  const url = `${API_BASE}/${encodeURIComponent(realm)}/reports/AgedPayableDetail?report_date=${asOf}&aging_method=Report_Date&minorversion=75`
  const res = await fetch(url, { headers: { authorization: `Bearer ${conn.access_token}`, accept: 'application/json' } })
  await logCall(env, realm, 'reports/AgedPayableDetail', res.status, res.headers.get('intuit_tid'))
  return res
}

// ---- Report parsing -------------------------------------------------------------------------

type QboCol = { value?: string; id?: string }
type QboRow = { type?: string; ColData?: QboCol[]; Rows?: { Row?: QboRow[] }; Header?: { ColData?: QboCol[] } }
interface QboReport {
  Columns?: { Column?: { ColTitle?: string; ColType?: string }[] }
  Rows?: { Row?: QboRow[] }
}

type BucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd91plus'

function bucketFor(daysOverdue: number): BucketKey {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return 'd1_30'
  if (daysOverdue <= 60) return 'd31_60'
  if (daysOverdue <= 90) return 'd61_90'
  return 'd91plus'
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function parseAgedPayableDetail(report: QboReport, asOf: string) {
  const titles = (report.Columns?.Column ?? []).map((c) => (c.ColTitle ?? '').toLowerCase())
  const idx = (needle: string) => titles.findIndex((t) => t.includes(needle))
  const iDate = titles.findIndex((t) => t === 'date')
  const iType = idx('transaction type')
  const iNum = idx('num')
  const iVendor = idx('vendor')
  const iDue = idx('due date')
  const iOpen = idx('open balance')
  if (iVendor < 0 || iDue < 0 || iOpen < 0) throw new Error('Unexpected AgedPayableDetail layout from QuickBooks')

  const asOfMs = Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10))
  const vendors = new Map<
    string,
    { vendor_id: string; name: string; total: number; buckets: Record<BucketKey, number>; bills: unknown[] }
  >()

  const walk = (rows: QboRow[] | undefined) => {
    for (const r of rows ?? []) {
      if (r.Rows?.Row) walk(r.Rows.Row)
      if (r.type !== 'Data' || !r.ColData) continue
      const c = r.ColData
      const open = parseFloat(c[iOpen]?.value ?? '')
      if (!isFinite(open) || open === 0) continue
      const name = (c[iVendor]?.value ?? '').trim() || '(No supplier)'
      const vid = c[iVendor]?.id || `name:${name}`
      const due = (c[iDue]?.value ?? '').slice(0, 10) || null
      const date = iDate >= 0 ? (c[iDate]?.value ?? '').slice(0, 10) || null : null
      const dueMs = due ? Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10)) : asOfMs
      const days = Math.round((asOfMs - dueMs) / 86_400_000)
      const bucket = bucketFor(days)
      let v = vendors.get(vid)
      if (!v) {
        v = { vendor_id: vid, name, total: 0, buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91plus: 0 }, bills: [] }
        vendors.set(vid, v)
      }
      v.total = round2(v.total + open)
      v.buckets[bucket] = round2(v.buckets[bucket] + open)
      v.bills.push({
        txn_id: c[iType]?.id ?? null,
        type: c[iType]?.value ?? 'Bill',
        num: iNum >= 0 ? c[iNum]?.value || null : null,
        date,
        due,
        open_balance: round2(open),
        days_overdue: days,
        bucket,
      })
    }
  }
  walk(report.Rows?.Row)

  const list = [...vendors.values()].sort((a, b) => b.total - a.total)
  return { vendors: list, total: round2(list.reduce((a, v) => a + v.total, 0)) }
}

export async function syncCompany(env: Env, realm: string) {
  let conn = await loadConnection(env, realm)
  if (new Date(conn.access_expires_at).getTime() < Date.now() + 60_000) conn = await refresh(env, conn)

  const asOf = new Date().toISOString().slice(0, 10)
  let res = await fetchReport(env, realm, conn, asOf)
  if (res.status === 401) {
    conn = await refresh(env, await loadConnection(env, realm))
    res = await fetchReport(env, realm, conn, asOf)
  }
  if (!res.ok) throw new Error(`QuickBooks report failed (${res.status})`)

  const parsed = parseAgedPayableDetail((await res.json()) as QboReport, asOf)
  const row = { realm_id: realm, as_of: asOf, fetched_at: new Date().toISOString(), total: parsed.total, vendors: parsed.vendors }
  await sb(env, 'ac_snapshots?on_conflict=realm_id', { method: 'POST', body: JSON.stringify(row) }, { prefer: 'resolution=merge-duplicates,return=minimal' })
  return row
}

// ---- Connecting a new QuickBooks company (OAuth 2.0 authorisation code flow) ---------------------

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmac(env: Env, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

/** Signed, 10-minute state so the (header-less) browser callback can only come from a staff-initiated connect. */
async function makeState(env: Env, label: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ label, exp: Date.now() + 10 * 60_000 })))
  return `${payload}.${await hmac(env, payload)}`
}

async function readState(env: Env, state: string): Promise<{ label: string } | null> {
  const [payload, sig] = state.split('.')
  if (!payload || !sig || (await hmac(env, payload)) !== sig) return null
  try {
    const { label, exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return Date.now() < exp && typeof label === 'string' ? { label } : null
  } catch {
    return null
  }
}

export const redirectUri = (request: Request) => `${new URL(request.url).origin}/api/qbo-callback`

export async function connectUrl(env: Env, request: Request, label: string): Promise<string> {
  const q = new URLSearchParams({
    client_id: env.QBO_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri(request),
    state: await makeState(env, label.trim().slice(0, 80) || 'New company'),
  })
  return `${AUTHORIZE_URL}?${q}`
}

export async function completeConnect(env: Env, request: Request, code: string, realm: string, state: string) {
  const st = await readState(env, state)
  if (!st) throw new Error('This connect link has expired. Start again from the app.')
  if (!/^\d+$/.test(realm)) throw new Error('QuickBooks did not return a company id')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(request) }),
  })
  await logCall(env, realm, 'oauth2/tokens/bearer (connect)', res.status, res.headers.get('intuit_tid'))
  if (!res.ok) throw new Error(`QuickBooks refused the connection (${res.status}). Check the redirect URI is registered for your Intuit production keys.`)
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number }

  let companyName: string | null = null
  const info = await fetch(`${API_BASE}/${realm}/companyinfo/${realm}?minorversion=75`, {
    headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/json' },
  })
  await logCall(env, realm, 'companyinfo', info.status, info.headers.get('intuit_tid'))
  if (info.ok) companyName = ((await info.json()) as { CompanyInfo?: { CompanyName?: string } }).CompanyInfo?.CompanyName ?? null

  const now = Date.now()
  await sb(
    env,
    'ac_connections?on_conflict=realm_id',
    {
      method: 'POST',
      body: JSON.stringify({
        realm_id: realm,
        label: st.label,
        company_name: companyName,
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        access_expires_at: new Date(now + t.expires_in * 1000).toISOString(),
        refresh_expires_at: new Date(now + t.x_refresh_token_expires_in * 1000).toISOString(),
        connected_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
    },
    { prefer: 'resolution=merge-duplicates,return=minimal' },
  )
  return companyName ?? st.label
}
