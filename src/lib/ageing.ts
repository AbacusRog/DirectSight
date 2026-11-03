import { BUCKETS, type VendorBalance } from './types.ts'

export type AgeMode = 'days' | 'months'
export type AgeBasis = 'bill' | 'due'

export interface AgeColumn {
  key: string
  label: string
  /** 0 = healthy (green) ... 4 = oldest (deep red). Drives colour and shading. */
  ramp: number
}

export interface Ageing {
  columns: AgeColumn[]
  /** Amount per column for each supplier, same order as `columns`. Credits are netted in. */
  rows: Record<string, number[]>
  /** Total per column across all suppliers. */
  totals: number[]
}

const monthIndex = (iso: string) => +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Fixed names, not the browser's locale (some write "Sept"), so labels read the same everywhere.
const monthLabel = (idx: number) => `${MONTHS[((idx % 12) + 12) % 12]} ${Math.floor(idx / 12)}`

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Age every supplier's open bills.
 *  - 'days': the 30/60/90-day periods QuickBooks gives us (by due date), unchanged.
 *  - 'months': by calendar month of the bill date (or the due date), this month first, then back `prevMonths`
 *    months, then everything older. A "Later" column appears only if something falls after this month.
 */
export function buildAgeing(
  vendors: VendorBalance[],
  opts: { mode: AgeMode; basis: AgeBasis; prevMonths: number; today: string },
): Ageing {
  if (opts.mode === 'days') {
    const columns = BUCKETS.map((b, i) => ({ key: b.key, label: b.label, ramp: i }))
    const rows: Record<string, number[]> = {}
    const totals = columns.map(() => 0)
    for (const v of vendors) {
      rows[v.vendor_id] = BUCKETS.map((b, i) => {
        totals[i] = round2(totals[i] + v.buckets[b.key])
        return v.buckets[b.key]
      })
    }
    return { columns, rows, totals }
  }

  const n = Math.min(Math.max(1, Math.round(opts.prevMonths)), 24)
  const cur = monthIndex(opts.today)

  // 0 = later than this month, 1 = this month, 2..n+1 = previous months, n+2 = older
  const slotOf = (bill: { date: string | null; due: string | null }): number => {
    const d = (opts.basis === 'due' ? bill.due ?? bill.date : bill.date ?? bill.due) ?? opts.today
    const diff = cur - monthIndex(d)
    if (diff < 0) return 0
    if (diff > n) return n + 2
    return diff + 1
  }

  const perVendor: Record<string, number[]> = {}
  const slotTotals = Array.from({ length: n + 3 }, () => 0)
  for (const v of vendors) {
    const row = Array.from({ length: n + 3 }, () => 0)
    for (const b of v.bills) {
      const s = slotOf(b)
      row[s] = round2(row[s] + b.open_balance)
      slotTotals[s] = round2(slotTotals[s] + b.open_balance)
    }
    perVendor[v.vendor_id] = row
  }

  const hasLater = vendors.some((v) => v.bills.some((b) => slotOf(b) === 0))
  const keep: number[] = []
  if (hasLater) keep.push(0)
  for (let s = 1; s <= n + 2; s++) keep.push(s)

  // Colour ramp: oldest is always deep red. "Later" is green; with no "Later", this month is green.
  const aged = keep.filter((s) => s !== 0)
  const rampStart = hasLater ? 1 : 0
  const rampOf = (s: number) => (s === 0 ? 0 : Math.round(rampStart + (aged.indexOf(s) / Math.max(1, aged.length - 1)) * (4 - rampStart)))

  const columns: AgeColumn[] = keep.map((s) => ({
    key: `m${s}`,
    label: s === 0 ? 'Later' : s === n + 2 ? `Before ${monthLabel(cur - n)}` : monthLabel(cur - (s - 1)),
    ramp: rampOf(s),
  }))
  const rows: Record<string, number[]> = {}
  for (const v of vendors) rows[v.vendor_id] = keep.map((s) => perVendor[v.vendor_id][s])
  return { columns, rows, totals: keep.map((s) => slotTotals[s]) }
}
