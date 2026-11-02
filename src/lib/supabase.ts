import { createClient } from '@supabase/supabase-js'

// Tolerate a project URL pasted with a trailing slash or the /rest/v1 (or /auth/v1) endpoint on the end.
const cleanUrl = (u?: string) => u?.trim().replace(/\/(rest|auth|storage|functions)\/v1.*$/i, '').replace(/\/+$/, '')
const url = cleanUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined)
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** True when the Cloudflare Pages front-end variables are missing (the app shows a message instead of a blank page). */
export const configMissing = !url || !key

export const supabase = createClient(url || 'https://missing.invalid', key || 'missing')

/** Call one of our Pages Functions with the signed-in user's token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${data.session?.access_token ?? ''}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export const gbp = (n: number) =>
  n === 0 ? '–' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n)

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–'
