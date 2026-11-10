import { useEffect, useRef } from 'react'

// Cloudflare Turnstile widget. The site key is public (safe in the browser); the secret is never in this code.
const SITE_KEY = '0x4AAAAAAF20-R4Al6pZ-Hrj'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  if (api()) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => { scriptPromise = null; reject(new Error('Could not load the security check')) }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

interface Props {
  onToken: (token: string | null) => void
  /** Change this number to force a fresh challenge (tokens are single-use). */
  resetKey?: number
}

export default function Turnstile({ onToken, resetKey = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const cb = useRef(onToken)
  cb.current = onToken

  useEffect(() => {
    let cancelled = false
    cb.current(null)
    loadScript()
      .then(() => {
        const t = api()
        if (cancelled || !ref.current || !t) return
        widgetId.current = t.render(ref.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => cb.current(token),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        })
      })
      .catch(() => cb.current(null))
    return () => {
      cancelled = true
      const t = api()
      if (widgetId.current && t) t.remove(widgetId.current)
      widgetId.current = null
    }
  }, [])

  useEffect(() => {
    const t = api()
    if (resetKey > 0 && widgetId.current && t) {
      cb.current(null)
      t.reset(widgetId.current)
    }
  }, [resetKey])

  return <div ref={ref} className="mb-4 flex justify-center" />
}
