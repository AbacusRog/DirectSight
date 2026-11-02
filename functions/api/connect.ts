import { authorise, connectUrl, json, type Env } from '../_lib/qbo'

// POST /api/connect { label } (staff) -> { url } to send the browser to Intuit's consent screen.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if ((await authorise(request, env)) !== 'staff') return json({ error: 'Not authorised' }, 401)
  const { label } = (await request.json().catch(() => ({}))) as { label?: string }
  return json({ url: await connectUrl(env, request, label ?? '') })
}
