// Shared helpers for the Pages Functions. Dependency-free (fetch only).
// This app keeps its own QuickBooks connections in public.ac_connections (separate from the
// other Abacus apps). Every token refresh MUST be written straight back: Intuit rotates refresh tokens.

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  QBO_CLIENT_ID: string
  QBO_CLIENT_SECRET: string
  CRON_SECRET?: string
  /** Optional. Signs the QuickBooks connect link. Falls back to the Supabase service key if unset. */
  STATE_SECRET?: string
}

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company'

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
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


function claims(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1]
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Compares the project in SUPABASE_URL, in the service key and in the user's login token. Project refs are not secret. */
function explainMismatch(env: Env, userToken: string): string {
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim()
  const urlRef = (() => {
    try {
      return new URL(supaUrl(env)).hostname.split('.')[0]
    } catch {
      return null
    }
  })()
  const userRef = String(claims(userToken)?.iss ?? '').match(/^https:\/\/([^.]+)\./)?.[1]
  const k = claims(key)
  const hints: string[] = []
  if (!urlRef) hints.push('SUPABASE_URL is not a valid URL.')
  if (userRef && urlRef && userRef !== urlRef) hints.push(`You signed in to project ${userRef}, but SUPABASE_URL is project ${urlRef}.`)
  if (!k) hints.push("SUPABASE_SERVICE_ROLE_KEY is not a legacy JWT key (it should start with 'eyJ'; use the 'service_role' key under Supabase > Settings > API Keys > Legacy API Keys).")
  else {
    if (k.ref && urlRef && k.ref !== urlRef) hints.push(`SUPABASE_SERVICE_ROLE_KEY belongs to project ${String(k.ref)}, not ${urlRef}.`)
    if (k.role && k.role !== 'service_role') hints.push(`SUPABASE_SERVICE_ROLE_KEY is the '${String(k.role)}' key, not the service_role key.`)
  }
  if (!hints.length) hints.push(`SUPABASE_URL, the key and your login all look like project ${urlRef}: re-paste the service_role key (check for a stray space or a cut-off copy) and redeploy.`)
  return hints.join(' ')
}

export interface ClientAccess {
  realm_id: string
  can_edit_rules: boolean
}
/** 'staff' = signed-in admin (everything). 'client' = a client login, limited to the companies in `access`. */
/** Compare secrets without leaking how many leading characters matched. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export type Authorised = { who: 'staff' } | { who: 'cron' } | { who: 'client'; access: ClientAccess[] }
export type AuthResult = Authorised | { error: string }

/** May this caller use this QuickBooks company? Admins and the daily job: any. Clients: only their own. */
export function canUseRealm(a: Authorised, realm: string): boolean {
  return a.who === 'client' ? a.access.some((x) => x.realm_id === realm) : true
}

/**
 * Allow a signed-in admin, a client login that has been given a company, or the daily job (CRON_SECRET).
 * On refusal, says exactly why, because the usual cause is a Cloudflare variable from the wrong project.
 */
export async function authorise(request: Request, env: Env): Promise<AuthResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (Cloudflare Pages > Settings > Variables and Secrets, Production), then redeploy.' }
  }
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: 'Not signed in (no login token sent).' }

  if (env.CRON_SECRET && safeEqual(token, env.CRON_SECRET)) return { who: 'cron' }

  // 1. Is the user's JWT valid for THIS Supabase project? (and who is it?)
  const user = await fetch(`${supaUrl(env)}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY.trim(), authorization: `Bearer ${token}` },
  })
  if (!user.ok) {
    return { error: `Supabase rejected your login (${user.status}). ${explainMismatch(env, token)}` }
  }
  const userId = String(((await user.json().catch(() => ({}))) as { id?: string }).id ?? '')

  // 2. Admin? (is_admin() reads auth.uid() from user_roles.)
  const rpc = await fetch(`${supaUrl(env)}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY.trim(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  })
  if (!rpc.ok) return { error: `Admin check failed (${rpc.status}): ${(await rpc.text()).slice(0, 160)}` }
  if ((await rpc.json()) === true) return { who: 'staff' }

  // 3. Not an admin: is this a client login that has been given a company?
  if (/^[0-9a-f-]{36}$/i.test(userId)) {
    const rows = await sb(env, `ac_client_access?user_id=eq.${userId}&select=realm_id,can_edit_rules`)
    if (Array.isArray(rows) && rows.length) return { who: 'client', access: rows as ClientAccess[] }
  }
  return { error: 'This login has not been given access to any company. Ask Abacus to set it up.' }
}

export interface Connection {
  realm_id: string
  label: string
  company_name: string | null
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
}

export async function loadConnection(env: Env, realm: string): Promise<Connection> {
  const rows = await sb(env, `ac_connections?realm_id=eq.${encodeURIComponent(realm)}&select=*`)
  if (!rows?.length) throw new Error('No QuickBooks connection for that company')
  return rows[0]
}

export async function logCall(env: Env, realm: string, endpoint: string, status: number, tid: string | null, message?: string) {
  try {
    await sb(
      env,
      'ac_api_log',
      { method: 'POST', body: JSON.stringify({ realm_id: realm, endpoint, status, intuit_tid: tid, message: message?.slice(0, 500) ?? null }) },
      { prefer: 'return=minimal' },
    )
  } catch {
    /* logging must never break a sync */
  }
}

export async function refresh(env: Env, conn: Connection): Promise<Connection> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID.trim()}:${env.QBO_CLIENT_SECRET.trim()}`)}`,
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
  Columns?: { Column?: { ColTitle?: string; ColType?: string; MetaData?: { Name?: string; Value?: string }[] }[] }
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
// Section headings that describe an ageing bucket or a total rather than a supplier.
const NOT_A_SUPPLIER = /past due|^current$|^total|days|or more|^\s*$/i

export function parseAgedPayableDetail(report: QboReport, asOf: string) {
  const cols = report.Columns?.Column ?? []
  const titles = cols.map((c) => (c.ColTitle ?? '').trim().toLowerCase())
  const keys = cols.map((c) => (c.MetaData?.find((m) => m.Name === 'ColKey')?.Value ?? '').toLowerCase())
  // Find a column by QuickBooks' own key first, then by title.
  const find = (keyTest: (k: string) => boolean, titleTest: (t: string) => boolean) => {
    const byKey = keys.findIndex((k) => k && keyTest(k))
    return byKey >= 0 ? byKey : titles.findIndex((t) => t && titleTest(t))
  }
  const iDate = find((k) => k === 'tx_date', (t) => t === 'date')
  const iType = find((k) => k === 'txn_type', (t) => t.includes('transaction type') || t === 'type')
  const iNum = find((k) => k === 'doc_num', (t) => t === 'num' || t === 'no.' || t.includes('number'))
  const iVendor = find((k) => k === 'vend_name', (t) => t.includes('vendor') || t.includes('supplier'))
  const iDue = find((k) => k === 'due_date', (t) => t.includes('due date') || t === 'due')
  const iOpen = find((k) => k.startsWith('rbal'), (t) => t.includes('open balance') || t === 'balance')

  if (iDue < 0 || iOpen < 0) {
    const seen = cols.map((c, i) => c.ColTitle || keys[i] || '(blank)').join(', ')
    throw new Error(`Unexpected AgedPayableDetail layout from QuickBooks. Needed a due date and an open balance column; got: ${seen || 'no columns'}.`)
  }

  const asOfMs = Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10))
  const vendors = new Map<
    string,
    { vendor_id: string; name: string; total: number; buckets: Record<BucketKey, number>; bills: unknown[] }
  >()

  const walk = (rows: QboRow[] | undefined, ctx: { id: string; name: string } | null) => {
    for (const r of rows ?? []) {
      // When there is no vendor column, the supplier is the section heading (e.g. "Acme Ltd").
      let here = ctx
      const head = r.Header?.ColData?.[0]
      if (head?.value && !NOT_A_SUPPLIER.test(head.value)) here = { id: head.id || `name:${head.value}`, name: head.value.trim() }
      if (r.Rows?.Row) walk(r.Rows.Row, here)
      if (r.type !== 'Data' || !r.ColData) continue
      const c = r.ColData
      const open = parseFloat((c[iOpen]?.value ?? '').replace(/,/g, ''))
      if (!isFinite(open) || open === 0) continue
      const colName = iVendor >= 0 ? (c[iVendor]?.value ?? '').trim() : ''
      const name = colName || here?.name || '(No supplier)'
      const vid = (iVendor >= 0 && c[iVendor]?.id) || here?.id || `name:${name}`
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
        txn_id: iType >= 0 ? c[iType]?.id ?? null : null,
        type: iType >= 0 ? c[iType]?.value || 'Bill' : 'Bill',
        num: iNum >= 0 ? c[iNum]?.value || null : null,
        date,
        due,
        open_balance: round2(open),
        days_overdue: days,
        bucket,
      })
    }
  }
  walk(report.Rows?.Row, null)

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
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STATE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
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
    client_id: env.QBO_CLIENT_ID.trim(),
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
      authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID.trim()}:${env.QBO_CLIENT_SECRET.trim()}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(request) }),
  })
  await logCall(env, realm, 'oauth2/tokens/bearer (connect)', res.status, res.headers.get('intuit_tid'))
  if (!res.ok) {
    let code = ''
    try {
      code = String(((await res.json()) as { error?: string }).error ?? '')
    } catch {
      /* body not JSON */
    }
    if (res.status === 401 || code === 'invalid_client') {
      throw new Error(
        'QuickBooks rejected the app credentials (401 invalid_client). QBO_CLIENT_ID and QBO_CLIENT_SECRET must be a matching pair, both from the same Intuit app and both Production (not Development). Re-copy both from Intuit > Keys and credentials > Production, save, and redeploy.',
      )
    }
    if (code === 'invalid_grant' || res.status === 400) {
      throw new Error(
        `QuickBooks rejected the sign-in code (${code || res.status}). Make sure ${redirectUri(request)} is added under the Production redirect URIs for your Intuit app, then use Connect a company again (codes expire in minutes and work once).`,
      )
    }
    throw new Error(`QuickBooks refused the connection (${res.status}${code ? ' ' + code : ''}).`)
  }
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

/**
 * Tests the Intuit client id + secret pair WITHOUT a sign-in: asks Intuit to refresh a dummy token.
 * Wrong credentials -> 401 invalid_client. Right credentials -> 400 invalid_grant (the dummy token is refused).
 * Never returns the secret itself, only its length and character types.
 */
export async function checkCredentials(env: Env) {
  const id = (env.QBO_CLIENT_ID ?? '').trim()
  const secret = (env.QBO_CLIENT_SECRET ?? '').trim()
  const out = {
    client_id: id ? `${id.slice(0, 6)}…${id.slice(-4)} (${id.length} characters)` : 'MISSING',
    secret: secret ? `${secret.length} characters, ${/[^A-Za-z0-9]/.test(secret) ? 'contains symbols/spaces' : 'letters and numbers only'}` : 'MISSING',
    intuit_says: '',
    verdict: '',
  }
  if (!id || !secret) {
    out.verdict = 'QBO_CLIENT_ID or QBO_CLIENT_SECRET is not set in Cloudflare (Production).'
    return out
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'credential-check' }),
  })
  const err = String(((await res.json().catch(() => ({}))) as { error?: string }).error ?? '')
  out.intuit_says = `${res.status}${err ? ' ' + err : ''}`
  out.verdict =
    res.status === 401 || err === 'invalid_client'
      ? 'REJECTED: Intuit does not accept this client ID + secret as a pair. Re-copy the secret for the SAME app and environment (Production) as the ID.'
      : res.status === 400 || err === 'invalid_grant'
        ? 'OK: Intuit accepts this ID + secret pair (it only refused the dummy token, as expected). If Connect still fails, the problem is elsewhere.'
        : 'Unexpected reply from Intuit.'
  return out
}

// ---- Abuse limits and error hygiene -----------------------------------------------------------------

/** A client may trigger a QuickBooks refresh at most once in this many seconds (admins are not limited). */
export const CLIENT_COOLDOWN_SECONDS = 120

/** When the cached copy was fetched, if that was within `seconds` (so a refresh can be skipped); else null. */
export async function fetchedWithin(env: Env, path: string, seconds: number, mustStartOnOrBefore?: string): Promise<string | null> {
  const rows = (await sb(env, path)) as { fetched_at?: string; start_date?: string }[] | null
  const row = rows?.[0]
  if (!row?.fetched_at) return null
  if (mustStartOnOrBefore && row.start_date && row.start_date > mustStartOnOrBefore) return null // saved before the history was extended
  return Date.now() - new Date(row.fetched_at).getTime() < seconds * 1000 ? row.fetched_at : null
}

/** Admins see the real error; a client gets a plain message, with the detail kept in the server log. */
export function failure(a: AuthResult | null, e: unknown, status: number): Response {
  const detail = (e as Error)?.message ?? String(e)
  console.error('DirectSight API error:', detail)
  const isClient = a !== null && !('error' in a) && a.who === 'client'
  return json({ error: isClient ? 'Something went wrong talking to QuickBooks. Please try again in a few minutes.' : detail }, status)
}
