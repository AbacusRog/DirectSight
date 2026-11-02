import { authorise, json, type Env } from '../_lib/qbo.ts'

// Who is signed in, so the screen can show the right controls. (The server still enforces everything.)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const a = await authorise(request, env)
    if ('error' in a) return json({ error: a.error }, 401)
    if (a.who === 'client') return json({ role: 'client', access: a.access })
    return json({ role: 'admin', access: [] })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}
