import { authorise, canUseRealm, json, sb, syncCompany, type Env } from '../_lib/qbo.ts'

// POST /api/sync  { realm_id }                  : refresh one company (admin: any; client: only their own)
// POST /api/sync  { all: true } + CRON_SECRET   : the daily job refreshes every connected company
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const a = await authorise(request, env)
  if ('error' in a) return json({ error: a.error }, 401)

  const body = (await request.json().catch(() => ({}))) as { realm_id?: string; all?: boolean }

  try {
    if (body.all) {
      if (a.who !== 'cron') return json({ error: 'Only the scheduled job may sync everything' }, 403)
      const conns = (await sb(env, 'ac_connections?select=realm_id')) as { realm_id: string }[]
      const results: Record<string, string> = {}
      for (const c of conns) {
        try {
          await syncCompany(env, c.realm_id)
          results[c.realm_id] = 'ok'
        } catch (e) {
          results[c.realm_id] = (e as Error).message
        }
      }
      return json({ results })
    }

    if (!body.realm_id || !/^\d+$/.test(body.realm_id)) return json({ error: 'realm_id required' }, 400)
    if (!canUseRealm(a, body.realm_id)) return json({ error: 'You do not have access to that company.' }, 403)
    const snap = await syncCompany(env, body.realm_id)
    return json({ fetched_at: snap.fetched_at })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}
