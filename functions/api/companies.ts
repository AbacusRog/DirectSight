import { authorise, json, sb, type Env } from '../_lib/qbo.ts'

// Lists connected QuickBooks companies WITHOUT exposing tokens to the browser.
// Admins see every company. A client login sees only the company it has been given.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const a = await authorise(request, env)
    if ('error' in a) return json({ error: a.error }, 401)
    const only = a.who === 'client' ? `&realm_id=in.(${a.access.map((x) => x.realm_id.replace(/\D/g, '')).join(',')})` : ''
    return json(await sb(env, `ac_connections?select=realm_id,label,company_name&order=label.asc${only}`))
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}
