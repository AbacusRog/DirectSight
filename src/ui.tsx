import { useEffect, useState } from 'react'
import { gbp } from './lib/supabase'
import { useTheme } from './lib/theme'
import { BUCKETS, type BucketKey } from './lib/types'

/** Small abacus mark: three rods, loose beads. */
export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <g stroke="currentColor" strokeWidth="1" opacity="0.55">
          <line x1="4.5" y1="8.5" x2="19.5" y2="8.5" />
          <line x1="4.5" y1="12" x2="19.5" y2="12" />
          <line x1="4.5" y1="15.5" x2="19.5" y2="15.5" />
        </g>
        <g fill="currentColor">
          <circle cx="7" cy="8.5" r="1.7" />
          <circle cx="10.4" cy="8.5" r="1.7" />
          <circle cx="16.5" cy="8.5" r="1.7" />
          <circle cx="8" cy="12" r="1.7" />
          <circle cx="14.5" cy="12" r="1.7" />
          <circle cx="17.9" cy="12" r="1.7" />
          <circle cx="7" cy="15.5" r="1.7" />
          <circle cx="10.4" cy="15.5" r="1.7" />
          <circle cx="13.8" cy="15.5" r="1.7" />
        </g>
      </svg>
      <span className="font-serif text-[1.25rem] font-semibold tracking-tight">DirectSight</span>
    </span>
  )
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-quiet !px-2"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
        </svg>
      )}
    </button>
  )
}

const AGE_VAR: Record<BucketKey, string> = {
  current: 'var(--age-0)',
  d1_30: 'var(--age-1)',
  d31_60: 'var(--age-2)',
  d61_90: 'var(--age-3)',
  d91plus: 'var(--age-4)',
}

type Buckets = Record<BucketKey, number>

/** Positive amounts only: credits don't have an age. */
function shares(b: Buckets) {
  const pos = BUCKETS.map((x) => ({ key: x.key, label: x.label, amount: Math.max(0, b[x.key]) }))
  const sum = pos.reduce((a, x) => a + x.amount, 0)
  return { sum, parts: pos.map((x) => ({ ...x, pct: sum > 0 ? (x.amount / sum) * 100 : 0 })) }
}

/** The whole of what is owed, split by age. Fills in once when the page loads. */
export function AgeStrip({ totals }: { totals: Buckets }) {
  const { sum, parts } = shares(totals)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), 80)
    return () => window.clearTimeout(id)
  }, [])

  if (sum <= 0) return null
  return (
    <div>
      <div className="flex h-3.5 w-full overflow-hidden rounded-[3px] bg-sunken" role="img" aria-label="What is owed, by age">
        {parts.map((p) => (
          <div key={p.key} className="age-seg h-full" style={{ width: shown ? `${p.pct}%` : '0%', background: AGE_VAR[p.key] }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start gap-2">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: AGE_VAR[p.key] }} />
            <span>
              <span className="block text-muted">{p.label}</span>
              <span className="tabular-nums">{gbp(p.amount) === '–' ? '£0' : gbp(p.amount)}</span>
              <span className="ml-1.5 text-muted tabular-nums">{p.pct >= 1 ? `${Math.round(p.pct)}%` : p.pct > 0 ? '<1%' : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The same split in miniature, one per supplier. */
export function AgeBar({ buckets }: { buckets: Buckets }) {
  const { sum, parts } = shares(buckets)
  return (
    <div className="flex h-2 w-28 overflow-hidden rounded-[2px] bg-sunken" aria-hidden="true">
      {sum > 0 && parts.map((p) => <div key={p.key} style={{ width: `${p.pct}%`, background: AGE_VAR[p.key] }} />)}
    </div>
  )
}
