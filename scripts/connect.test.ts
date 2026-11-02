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
    assert.match((await authorise(withTok, env) as { error: string }).error, /Supabase rejected your login \(401\)/)

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

function jwt(payload: object) {
  const b = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b({ alg: 'HS256' })}.${b(payload)}.sig`
}
test('authorise names the mismatched project', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch
  try {
    const user = jwt({ iss: 'https://clientsref.supabase.co/auth/v1' })
    const req = new Request('https://x/api/companies', { headers: { authorization: `Bearer ${user}` } })
    const wrongKey = { ...env, SUPABASE_URL: 'https://clientsref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: 'abacusref', role: 'service_role' }) } as Env
    assert.match((await authorise(req, wrongKey) as { error: string }).error, /belongs to project abacusref, not clientsref/)
    const wrongUrl = { ...env, SUPABASE_URL: 'https://abacusref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: 'abacusref', role: 'service_role' }) } as Env
    assert.match((await authorise(req, wrongUrl) as { error: string }).error, /signed in to project clientsref, but SUPABASE_URL is project abacusref/)
    const anon = { ...env, SUPABASE_URL: 'https://clientsref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: 'clientsref', role: 'anon' }) } as Env
    assert.match((await authorise(req, anon) as { error: string }).error, /'anon' key, not the service_role key/)
    const newStyle = { ...env, SUPABASE_URL: 'https://clientsref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc' } as Env
    assert.match((await authorise(req, newStyle) as { error: string }).error, /not a legacy JWT key/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('connect failure messages tell credentials apart from redirect problems', async () => {
  const u = new URL(await connectUrl(env, req, 'Client Ltd'))
  const state = u.searchParams.get('state')!
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('{"error":"invalid_client"}', { status: 401 })) as typeof fetch
    await assert.rejects(completeConnect(env, req, 'code', '123', state), /matching pair, both from the same Intuit app and both Production/)
    globalThis.fetch = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch
    await assert.rejects(completeConnect(env, req, 'code', '123', state), /https:\/\/aged\.example\.com\/api\/qbo-callback is added under the Production redirect URIs/)
  } finally {
    globalThis.fetch = realFetch
  }
})

import { checkCredentials } from '../functions/_lib/qbo.ts'
test('checkCredentials tells a bad pair from a good one and never leaks the secret', async () => {
  const e = { ...env, QBO_CLIENT_ID: 'ABabcdefghij1234', QBO_CLIENT_SECRET: 'sEcReTvAlUe1234567890' } as Env
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('{"error":"invalid_client"}', { status: 401 })) as typeof fetch
    const bad = await checkCredentials(e)
    assert.match(bad.verdict, /REJECTED/)
    globalThis.fetch = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch
    const good = await checkCredentials(e)
    assert.match(good.verdict, /^OK/)
    assert.ok(!JSON.stringify([bad, good]).includes('sEcReTvAlUe'))
    assert.match((await checkCredentials({ ...e, QBO_CLIENT_SECRET: '' } as Env)).verdict, /not set/)
  } finally {
    globalThis.fetch = realFetch
  }
})
