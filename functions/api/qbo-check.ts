import { authorise, checkCredentials, json, type Env } from '../_lib/qbo'

// GET /api/qbo-check (admin): tests the Intuit client id + secret pair without needing a sign-in.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const a = await authorise(request, env)
    if ('error' in a) return json({ error: a.error }, 401)
    return json(await checkCredentials(env))
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}
