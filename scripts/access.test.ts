import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestGet as companies } from '../functions/api/companies.ts'
import { onRequestGet as me } from '../functions/api/me.ts'
import { onRequestGet as qboCheck } from '../functions/api/qbo-check.ts'
import { onRequestPost as connect } from '../functions/api/connect.ts'
import { onRequestPost as sync } from '../functions/api/sync.ts'
import { onRequestPost as reportSync } from '../functions/api/report-sync.ts'
import { canUseRealm, type Env } from '../functions/_lib/qbo.ts'

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b' } as Env
const UID = '11111111-2222-3333-4444-555555555555'
const MINE = '111'
const OTHER = '222'

/** Pretend to be Supabase (and QuickBooks). Records every URL called. */
function pretend(opts: { admin?: boolean; access?: { realm_id: string; can_edit_rules: boolean }[] }) {
  const calls: string[] = []
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: UID }))
    if (u.includes('/rpc/is_admin')) return new Response(JSON.stringify(!!opts.admin))
    if (u.includes('/rest/v1/ac_client_access')) return new Response(JSON.stringify(opts.access ?? []))
    if (u.includes('/rest/v1/ac_connections')) return new Response(JSON.stringify([{ realm_id: MINE, label: 'direct', company_name: 'Direct Sight' }]))
    return new Response('[]')
  }) as typeof fetch
  return calls
}
const realFetch = globalThis.fetch
const ctx = (path: string, body?: unknown) =>
  ({
    env,
    request: new Request(`https://x${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  }) as never
const clientOf = (...realms: string[]) => ({ access: realms.map((r) => ({ realm_id: r, can_edit_rules: true })) })
const quickbooksCalls = (calls: string[]) => calls.filter((c) => c.includes('intuit.com'))

test.afterEach(() => {
  globalThis.fetch = realFetch
})

test('a client sees only their own company in the list', async () => {
  const calls = pretend(clientOf(MINE))
  const res = await companies(ctx('/api/companies'))
  assert.equal(res.status, 200)
  assert.ok(calls.some((c) => c.includes('ac_connections') && c.includes(`realm_id=in.(${MINE})`)), 'list query is filtered to their company')
})

test('an admin sees every company (no filter)', async () => {
  const calls = pretend({ admin: true })
  await companies(ctx('/api/companies'))
  assert.ok(calls.some((c) => c.includes('ac_connections')) && !calls.some((c) => c.includes('realm_id=in.')))
})

test('a client cannot sync or pull reports for another company, and QuickBooks is never called', async () => {
  const calls = pretend(clientOf(MINE))
  assert.equal((await sync(ctx('/api/sync', { realm_id: OTHER }))).status, 403)
  assert.equal((await reportSync(ctx('/api/report-sync', { realm_id: OTHER, kind: 'pnl' }))).status, 403)
  assert.deepEqual(quickbooksCalls(calls), [])
})

test('a client can reach their own company (passes the gate)', async () => {
  pretend(clientOf(MINE))
  const res = await sync(ctx('/api/sync', { realm_id: MINE }))
  assert.notEqual(res.status, 403)
  assert.notEqual(res.status, 401)
  const rep = await reportSync(ctx('/api/report-sync', { realm_id: MINE, kind: 'pnl' }))
  assert.notEqual(rep.status, 403)
})

test('a client cannot connect a company, check the keys, or sync everything', async () => {
  const calls = pretend(clientOf(MINE))
  assert.equal((await connect(ctx('/api/connect', { label: 'x' }))).status, 403)
  assert.equal((await qboCheck(ctx('/api/qbo-check'))).status, 403)
  assert.equal((await sync(ctx('/api/sync', { all: true }))).status, 403)
  assert.deepEqual(quickbooksCalls(calls), [])
})

test('a malformed company id is rejected before anything else', async () => {
  pretend(clientOf(MINE))
  assert.equal((await sync(ctx('/api/sync', { realm_id: `${MINE} or 1=1` }))).status, 400)
})

test('a login with no company is refused with a clear reason', async () => {
  pretend({ access: [] })
  const res = await companies(ctx('/api/companies'))
  assert.equal(res.status, 401)
  assert.match(((await res.json()) as { error: string }).error, /not been given access/)
})

test('an admin can still connect and check keys (passes the role gate)', async () => {
  pretend({ admin: true })
  assert.equal((await connect(ctx('/api/connect', { label: 'New client' }))).status, 200)
  const res = await qboCheck(ctx('/api/qbo-check'))
  assert.notEqual(res.status, 403)
})

test('/api/me tells the screen who is signed in', async () => {
  pretend(clientOf(MINE))
  assert.deepEqual(await (await me(ctx('/api/me'))).json(), { role: 'client', access: [{ realm_id: MINE, can_edit_rules: true }] })
  pretend({ admin: true })
  assert.equal(((await (await me(ctx('/api/me'))).json()) as { role: string }).role, 'admin')
})

test('canUseRealm', () => {
  assert.equal(canUseRealm({ who: 'staff' }, OTHER), true)
  assert.equal(canUseRealm({ who: 'cron' }, OTHER), true)
  assert.equal(canUseRealm({ who: 'client', access: clientOf(MINE).access }, MINE), true)
  assert.equal(canUseRealm({ who: 'client', access: clientOf(MINE).access }, OTHER), false)
})
