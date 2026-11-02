import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestGet as companies } from '../functions/api/companies.ts'
import { onRequestGet as me } from '../functions/api/me.ts'
import { onRequestGet as qboCheck } from '../functions/api/qbo-check.ts'
import { onRequestPost as connect } from '../functions/api/connect.ts'
import { onRequestPost as sync } from '../functions/api/sync.ts'
import { onRequestPost as reportSync } from '../functions/api/report-sync.ts'
import { authorise, canUseRealm, connectUrl, completeConnect, safeEqual, type Env } from '../functions/_lib/qbo.ts'

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b' } as Env
const UID = '11111111-2222-3333-4444-555555555555'
const MINE = '111'
const OTHER = '222'

/** Pretend to be Supabase (and QuickBooks). Records every URL called. */
function pretend(opts: { admin?: boolean; access?: { realm_id: string; can_edit_rules: boolean }[]; snapshotAt?: string; reportAt?: { fetched_at: string; start_date: string } }) {
  const calls: string[] = []
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: UID }))
    if (u.includes('/rpc/is_admin')) return new Response(JSON.stringify(!!opts.admin))
    if (u.includes('/rest/v1/ac_client_access')) return new Response(JSON.stringify(opts.access ?? []))
    if (u.includes('/rest/v1/ac_snapshots') && opts.snapshotAt) return new Response(JSON.stringify([{ fetched_at: opts.snapshotAt }]))
    if (u.includes('/rest/v1/ac_reports') && opts.reportAt) return new Response(JSON.stringify([opts.reportAt]))
    if (u.includes('/rpc/ac_get_connection')) return new Response(JSON.stringify([{ realm_id: MINE, label: 'direct', company_name: 'Direct Sight', access_token: 'ACCESS', refresh_token: 'REFRESH', access_expires_at: new Date(Date.now() + 3600_000).toISOString(), refresh_expires_at: new Date(Date.now() + 8e9).toISOString() }]))
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
  const list = calls.find((c) => c.includes('/rest/v1/ac_connections'))!
  assert.ok(!/token/.test(list) && !/select=\*/.test(list), 'the company list never asks for token columns')
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

const secondsAgo = (n: number) => new Date(Date.now() - n * 1000).toISOString()

test('a client who refreshed seconds ago gets the saved copy, with no QuickBooks call', async () => {
  const calls = pretend({ ...clientOf(MINE), snapshotAt: secondsAgo(10) })
  const res = await sync(ctx('/api/sync', { realm_id: MINE }))
  assert.equal(res.status, 200)
  assert.equal(((await res.json()) as { cached?: boolean }).cached, true)
  assert.deepEqual(quickbooksCalls(calls), [])
})

test('after the cooldown a client can refresh again; admins are never limited', async () => {
  pretend({ ...clientOf(MINE), snapshotAt: secondsAgo(600) })
  assert.notEqual(((await (await sync(ctx('/api/sync', { realm_id: MINE }))).json()) as { cached?: boolean }).cached, true)
  pretend({ admin: true, snapshotAt: secondsAgo(5) })
  assert.notEqual(((await (await sync(ctx('/api/sync', { realm_id: MINE }))).json()) as { cached?: boolean }).cached, true)
})

test('report refresh has the same limit, except a copy saved before the 2024 history was added', async () => {
  const calls = pretend({ ...clientOf(MINE), reportAt: { fetched_at: secondsAgo(10), start_date: '2024-01-01' } })
  const res = await reportSync(ctx('/api/report-sync', { realm_id: MINE, kind: 'pnl' }))
  assert.equal(((await res.json()) as { cached?: boolean }).cached, true)
  assert.deepEqual(quickbooksCalls(calls), [])
  pretend({ ...clientOf(MINE), reportAt: { fetched_at: secondsAgo(10), start_date: '2025-12-01' } })
  const old = await reportSync(ctx('/api/report-sync', { realm_id: MINE, kind: 'pnl' }))
  assert.notEqual(((await old.json()) as { cached?: boolean }).cached, true)
})

test('a client never sees internal error detail; an admin does', async () => {
  pretend(clientOf(MINE))
  const c = (await (await sync(ctx('/api/sync', { realm_id: MINE }))).json()) as { error: string }
  assert.match(c.error, /try again in a few minutes/)
  assert.doesNotMatch(c.error, /AgedPayableDetail|Supabase|layout/)
  pretend({ admin: true })
  const a = (await (await sync(ctx('/api/sync', { realm_id: MINE }))).json()) as { error: string }
  assert.match(a.error, /AgedPayableDetail|QuickBooks/)
})

test('secret comparison and the daily-job secret', async () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', ''), true)
  const cronEnv = { ...env, CRON_SECRET: 'x'.repeat(40) } as Env
  const withTok = (t: string) => new Request('https://x/api/sync', { headers: { authorization: `Bearer ${t}` } })
  assert.deepEqual(await authorise(withTok('x'.repeat(40)), cronEnv), { who: 'cron' })
  pretend({ access: [] })
  assert.ok('error' in (await authorise(withTok('x'.repeat(39) + 'y'), cronEnv)))
})

test('the connect link can be signed with its own secret, and a link signed with the database key no longer works', async () => {
  const req = new Request('https://aged.example.com/api/connect', { method: 'POST' })
  const withOwn = { ...env, STATE_SECRET: 's'.repeat(32) } as Env
  const stateOwn = new URL(await connectUrl(withOwn, req, 'Client')).searchParams.get('state')!
  const stateDb = new URL(await connectUrl(env, req, 'Client')).searchParams.get('state')!
  await assert.rejects(completeConnect(withOwn, req, 'c', '123', stateDb), /expired/) // signed with the old key
  await assert.rejects(completeConnect(env, req, 'c', '123', stateOwn), /expired/) // not valid without the secret
})
