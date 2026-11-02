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
