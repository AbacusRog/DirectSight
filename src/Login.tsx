import { useState } from 'react'
import { supabase } from './lib/supabase'
import { Brand, ThemeToggle } from './ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
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
        <button disabled={busy} className="btn btn-primary w-full justify-center py-2">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
