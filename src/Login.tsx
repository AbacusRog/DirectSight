import { useState } from 'react'
import { supabase } from './lib/supabase'
import Turnstile from './Turnstile'
import { Brand, ThemeToggle } from './ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken ?? undefined } })
    setCaptchaReset((n) => n + 1)
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 p-7">
        <Brand size={26} />
        <h1 className="pt-2 text-[1.5rem] leading-tight">Sign in</h1>
        <label className="block text-sm">
          <span className="text-muted">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1 w-full" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1 w-full" />
        </label>
        {error && <p className="notice notice-error">{error}</p>}
        <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />

        <button disabled={busy || !captchaToken} className="btn btn-primary w-full justify-center py-2">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
