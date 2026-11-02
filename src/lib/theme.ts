import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'theme'

const current = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

function apply(t: Theme, remember: boolean) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  if (remember) {
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* private mode: the choice just won't persist */
    }
  }
}

/** Light/dark toggle. Follows the device setting until the person picks one, then remembers it. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      let chosen: string | null = null
      try {
        chosen = localStorage.getItem(KEY)
      } catch {
        /* ignore */
      }
      if (!chosen) {
        apply(mq.matches ? 'dark' : 'light', false)
        setTheme(current())
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    apply(next, true)
    setTheme(next)
  }
  return { theme, toggle }
}

/** Reports are printed on white paper whatever the screen theme. */
export function installPrintGuard() {
  let wasDark = false
  window.addEventListener('beforeprint', () => {
    wasDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.remove('dark')
  })
  window.addEventListener('afterprint', () => {
    if (wasDark) document.documentElement.classList.add('dark')
  })
}
