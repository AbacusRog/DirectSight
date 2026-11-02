import { authorise, json, sb, type Env } from '../_lib/qbo'

// Lists connected QuickBooks companies WITHOUT exposing tokens to the browser.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const a = await authorise(request, env)
    if ('error' in a) return json({ error: a.error }, 401)
    return json(await sb(env, 'ac_connections?select=realm_id,label,company_name&order=label.asc'))
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}
