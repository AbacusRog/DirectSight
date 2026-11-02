import test from 'node:test'
import assert from 'node:assert/strict'
import { completeConnect, connectUrl, syncCompany, type Env } from '../functions/_lib/qbo.ts'

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), QBO_CLIENT_ID: 'cid', QBO_CLIENT_SECRET: 'sec' } as Env
const REALM = '111'
const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})

interface Seen {
  url: string
  method: string
  body: string
  auth: string
}

/** Pretend to be Supabase, Intuit's token service and the QuickBooks API; remember every request. */
function pretend(opts: { expired: boolean }) {
  const seen: Seen[] = []
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const headers = (init?.headers ?? {}) as Record<string, string>
    seen.push({ url: u, method: init?.method ?? 'GET', body: String(init?.body ?? ''), auth: headers.authorization ?? '' })
    if (u.includes('/rpc/ac_get_connection'))
      return new Response(
        JSON.stringify([
          {
            realm_id: REALM,
            label: 'direct',
            company_name: 'Direct Sight',
            access_token: 'OLD_ACCESS',
            refresh_token: 'OLD_REFRESH',
            access_expires_at: new Date(Date.now() + (opts.expired ? -60_000 : 3_600_000)).toISOString(),
            refresh_expires_at: new Date(Date.now() + 8e9).toISOString(),
          },
        ]),
      )
    if (u.includes('oauth.platform.intuit.com'))
      return new Response(JSON.stringify({ access_token: 'NEW_ACCESS', refresh_token: 'NEW_REFRESH', expires_in: 3600, x_refresh_token_expires_in: 8640000 }))
    if (u.includes('/companyinfo/')) return new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'Direct Sight (Jersey) Limited' } }))
    if (u.includes('/reports/AgedPayableDetail'))
      return new Response(JSON.stringify({ Columns: { Column: [{ ColTitle: 'Date' }, { ColTitle: 'Vendor' }, { ColTitle: 'Due Date' }, { ColTitle: 'Open Balance' }] }, Rows: { Row: [] } }))
    if (u.includes('/rest/v1/ac_connections')) return new Response(JSON.stringify([{ realm_id: REALM, label: 'direct', company_name: 'Direct Sight' }]))
    return new Response('null')
  }) as typeof fetch
  return seen
}

const tableWrites = (seen: Seen[]) => seen.filter((r) => /\/rest\/v1\/ac_connections/.test(r.url) && r.method !== 'GET')

test('a token refresh stores the new tokens through the encrypted function, never by writing the table', async () => {
  const seen = pretend({ expired: true })
  await syncCompany(env, REALM)

  const update = seen.find((r) => r.url.includes('/rpc/ac_update_tokens'))
  assert.ok(update, 'rotated tokens are saved via ac_update_tokens')
  const sent = JSON.parse(update.body)
  assert.equal(sent.p_realm, REALM)
  assert.equal(sent.p_access, 'NEW_ACCESS')
  assert.equal(sent.p_refresh, 'NEW_REFRESH')
  assert.deepEqual(tableWrites(seen), [], 'nothing writes tokens into ac_connections directly')

  // and the report call used the NEW access token, not the expired one
  const report = seen.find((r) => r.url.includes('/reports/AgedPayableDetail'))!
  assert.equal(report.auth, 'Bearer NEW_ACCESS')
})

test('an unexpired token is used as is: no refresh, no token writes', async () => {
  const seen = pretend({ expired: false })
  await syncCompany(env, REALM)
  assert.equal(seen.some((r) => r.url.includes('oauth.platform.intuit.com')), false)
  assert.equal(seen.some((r) => r.url.includes('/rpc/ac_update_tokens')), false)
  assert.equal(seen.find((r) => r.url.includes('/reports/AgedPayableDetail'))!.auth, 'Bearer OLD_ACCESS')
})

test('connecting a company saves its tokens through the encrypted function only', async () => {
  const seen = pretend({ expired: false })
  const req = new Request('https://aged.example.com/api/connect', { method: 'POST' })
  const state = new URL(await connectUrl(env, req, 'Direct Sight')).searchParams.get('state')!
  const name = await completeConnect(env, req, 'auth-code', REALM, state)
  assert.equal(name, 'Direct Sight (Jersey) Limited')

  const save = seen.find((r) => r.url.includes('/rpc/ac_save_connection'))
  assert.ok(save, 'saved via ac_save_connection')
  const sent = JSON.parse(save.body)
  assert.deepEqual([sent.p_realm, sent.p_label, sent.p_access, sent.p_refresh], [REALM, 'Direct Sight', 'NEW_ACCESS', 'NEW_REFRESH'])
  assert.deepEqual(tableWrites(seen), [])
})

test('the sync code never selects token columns from the table', async () => {
  const seen = pretend({ expired: true })
  await syncCompany(env, REALM)
  const tableReads = seen.filter((r) => /\/rest\/v1\/ac_connections/.test(r.url)).map((r) => r.url)
  assert.ok(tableReads.every((u) => !/select=\*/.test(u) && !/token/.test(u)), `table reads stay token-free: ${tableReads.join(' | ')}`)
})
