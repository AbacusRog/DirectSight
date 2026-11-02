export interface ReportColumn {
  label: string
  start: string | null
  end: string | null
  total: boolean
}
export interface ReportRow {
  label: string
  kind: 'header' | 'line' | 'total'
  depth: number
  values: (number | null)[]
}
export interface MonthlyReport {
  columns: ReportColumn[]
  rows: ReportRow[]
}

export interface CompareLine {
  row: ReportRow
  a: number | null
  b: number | null
  change: number | null
  pct: number | null // change as a fraction of |b|; null when b is 0/blank
}

/** Indices of the real month columns (the report's own "Total" column is excluded). */
export const monthIndexes = (r: MonthlyReport) => r.columns.map((c, i) => (c.total ? -1 : i)).filter((i) => i >= 0)

/** Compare column `ai` with column `bi`: change = a - b. */
export function compareMonths(r: MonthlyReport, ai: number, bi: number): CompareLine[] {
  return r.rows.map((row) => {
    if (row.kind === 'header' && row.values.every((v) => v === null)) return { row, a: null, b: null, change: null, pct: null }
    const a = row.values[ai] ?? null
    const b = row.values[bi] ?? null
    if (a === null && b === null) return { row, a, b, change: null, pct: null }
    const change = Math.round(((a ?? 0) - (b ?? 0)) * 100) / 100
    const pct = b !== null && b !== 0 ? change / Math.abs(b) : null
    return { row, a, b, change, pct }
  })
}

/** A detail line that is blank or zero in every column (hidden by default to keep reports short). */
export const isEmptyRow = (row: ReportRow) => row.kind === 'line' && row.values.every((v) => v === null || v === 0)

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })
export const fmtMoney = (n: number | null) => (n === null ? '' : money.format(n))
export const fmtChange = (n: number | null) => (n === null ? '' : (n > 0 ? '+' : '') + money.format(n))
export const fmtPct = (p: number | null) => (p === null ? '' : `${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%`)

// ---- Current month vs the previous N months ---------------------------------------------------------

export interface TrendLine {
  row: ReportRow
  base: number | null // the chosen month
  prev: (number | null)[] // previous months, most recent first (same order as prevIdx)
  avg: number | null // average of the previous months (blank months count as 0)
  change: number | null // base - avg
  pct: number | null // change as a fraction of |avg|; null when the average is 0
}

/** Compare column `baseIdx` with up to `n` real month columns before it, plus their average. */
export function compareToPrevious(r: MonthlyReport, baseIdx: number, n: number): { prevIdx: number[]; lines: TrendLine[] } {
  const prevIdx = monthIndexes(r)
    .filter((i) => i < baseIdx)
    .slice(-Math.max(1, n))
    .reverse()
  const lines = r.rows.map((row): TrendLine => {
    const base = row.values[baseIdx] ?? null
    const prev = prevIdx.map((i) => row.values[i] ?? null)
    if (base === null && prev.every((v) => v === null)) return { row, base, prev, avg: null, change: null, pct: null }
    const avg = Math.round((prev.reduce<number>((a, v) => a + (v ?? 0), 0) / Math.max(1, prev.length)) * 100) / 100
    const change = Math.round(((base ?? 0) - avg) * 100) / 100
    return { row, base, prev, avg, change, pct: avg !== 0 ? change / Math.abs(avg) : null }
  })
  return { prevIdx, lines }
}

/** True for a month column that has not finished yet (month to date), e.g. Nov 1-2 of November. */
export function isPartialMonth(c: ReportColumn | undefined): boolean {
  if (!c?.start || !c.end) return false
  const s = new Date(c.start + 'T00:00:00Z')
  const monthEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0))
  return new Date(c.end + 'T00:00:00Z') < monthEnd
}

// ---- Compact view: collapse each category to one line -----------------------------------------------

export type Detail = 'headline' | 'category' | 'detail' | 'full'
export const DETAIL_LABELS: Record<Detail, string> = {
  headline: 'Headline totals',
  category: 'Totals by category',
  detail: 'More detail',
  full: 'Full detail',
}
const DETAIL_DEPTH: Record<Detail, number> = { headline: 0, category: 1, detail: 2, full: Infinity }

/**
 * Which rows to show. A section nested deeper than the chosen level collapses to its own total line
 * (its heading and sub-accounts are hidden), so e.g. "Advertising" with three sub-accounts shows once.
 */
export function visibleInDetail(row: ReportRow, detail: Detail): boolean {
  const d = DETAIL_DEPTH[detail]
  if (d === Infinity) return true
  return row.kind === 'header' ? row.depth < d : row.depth <= d
}

/** A collapsed section's "Total Advertising" reads better as "Advertising" in the compact view. */
export function displayLabel(row: ReportRow, detail: Detail): string {
  if (detail !== 'full' && row.kind === 'total' && row.depth >= 1) return row.label.replace(/^total\s+/i, '')
  return row.label
}
