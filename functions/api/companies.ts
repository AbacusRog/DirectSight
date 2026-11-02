import { authorise, json, sb, type Env } from '../_lib/qbo'

// Lists connected QuickBooks companies WITHOUT exposing tokens to the browser.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await authorise(request, env))) return json({ error: 'Not authorised' }, 401)
  const rows = await sb(env, 'ac_connections?select=realm_id,label,company_name&order=label.asc')
  return json(rows)
}
