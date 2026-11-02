import { authorise, connectUrl, json, type Env } from '../_lib/qbo.ts'

// POST /api/connect { label } (admin) -> { url } to send the browser to Intuit's consent screen.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const a = await authorise(request, env)
    if ('error' in a) return json({ error: a.error }, 401)
    if (a.who !== 'staff') return json({ error: 'Only a signed-in admin can connect a company.' }, 403)
    if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) return json({ error: 'Server is missing QBO_CLIENT_ID or QBO_CLIENT_SECRET (Cloudflare secrets).' }, 500)
    const { label } = (await request.json().catch(() => ({}))) as { label?: string }
    return json({ url: await connectUrl(env, request, label ?? '') })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}
