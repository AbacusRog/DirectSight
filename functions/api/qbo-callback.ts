import { completeConnect, type Env } from '../_lib/qbo'

// Intuit redirects the browser here after the client approves access.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url)
  const back = (q: string) => Response.redirect(`${u.origin}/?${q}`, 302)
  if (u.searchParams.get('error')) return back('connect_error=' + encodeURIComponent('Access was not approved in QuickBooks.'))
  try {
    const name = await completeConnect(
      env,
      request,
      u.searchParams.get('code') ?? '',
      u.searchParams.get('realmId') ?? '',
      u.searchParams.get('state') ?? '',
    )
    return back('connected=' + encodeURIComponent(name))
  } catch (e) {
    return back('connect_error=' + encodeURIComponent((e as Error).message))
  }
}
