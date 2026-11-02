import test from 'node:test'
import assert from 'node:assert/strict'
import { completeConnect, connectUrl, type Env } from '../functions/_lib/qbo.ts'

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), QBO_CLIENT_ID: 'cid', QBO_CLIENT_SECRET: 'sec' } as Env
const req = new Request('https://aged.example.com/api/connect', { method: 'POST' })

test('connect URL carries client id, scope, callback on our origin and a signed state', async () => {
  const u = new URL(await connectUrl(env, req, 'Client Ltd'))
  assert.equal(u.origin + u.pathname, 'https://appcenter.intuit.com/connect/oauth2')
  assert.equal(u.searchParams.get('client_id'), 'cid')
  assert.equal(u.searchParams.get('scope'), 'com.intuit.quickbooks.accounting')
  assert.equal(u.searchParams.get('redirect_uri'), 'https://aged.example.com/api/qbo-callback')
  assert.match(u.searchParams.get('state')!, /^[\w-]+\.[\w-]+$/)
})

test('callback rejects a tampered or foreign state before calling Intuit', async () => {
  const u = new URL(await connectUrl(env, req, 'Client Ltd'))
  const state = u.searchParams.get('state')!
  const [payload] = state.split('.')
  await assert.rejects(completeConnect(env, req, 'code', '123', payload + '.forged'), /expired/)
  await assert.rejects(completeConnect(env, req, 'code', '123', 'garbage'), /expired/)
  const other = { ...env, SUPABASE_SERVICE_ROLE_KEY: 'z'.repeat(40) } as Env
  await assert.rejects(completeConnect(other, req, 'code', '123', state), /expired/)
})

import { supaUrl } from '../functions/_lib/qbo.ts'
test('supaUrl strips slashes and pasted REST endpoints', () => {
  for (const u of ['https://x.supabase.co', 'https://x.supabase.co/', 'https://x.supabase.co/rest/v1', 'https://x.supabase.co/rest/v1/', ' https://x.supabase.co/auth/v1 ']) {
    assert.equal(supaUrl({ SUPABASE_URL: u } as Env), 'https://x.supabase.co')
  }
})

import { authorise } from '../functions/_lib/qbo.ts'
test('authorise explains each refusal', async () => {
  const noAuth = new Request('https://x/api/companies')
  const withTok = new Request('https://x/api/companies', { headers: { authorization: 'Bearer tok' } })
  assert.match((await authorise(noAuth, {} as Env) as { error: string }).error, /missing SUPABASE_URL/)
  assert.match((await authorise(noAuth, env) as { error: string }).error, /Not signed in/)

  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch
    assert.match((await authorise(withTok, env) as { error: string }).error, /same project/)

    let n = 0
    globalThis.fetch = (async () => (++n === 1 ? new Response('{"id":"u"}') : new Response('false'))) as typeof fetch
    assert.match((await authorise(withTok, env) as { error: string }).error, /not an admin/)

    n = 0
    globalThis.fetch = (async () => (++n === 1 ? new Response('{"id":"u"}') : new Response('true'))) as typeof fetch
    assert.deepEqual(await authorise(withTok, env), { who: 'staff' })
  } finally {
    globalThis.fetch = realFetch
  }
})
