import test from 'node:test'
import assert from 'node:assert/strict'
import { compareMonths, fmtChange, fmtPct, isEmptyRow, monthIndexes, type MonthlyReport } from '../src/lib/reportCompare.ts'

const rep: MonthlyReport = {
  columns: [
    { label: 'Oct', start: '2026-10-01', end: '2026-10-31', total: false },
    { label: 'Nov', start: '2026-11-01', end: '2026-11-30', total: false },
    { label: 'Total', start: null, end: null, total: true },
  ],
  rows: [
    { label: 'Income', kind: 'header', depth: 0, values: [null, null, null] },
    { label: 'Sales', kind: 'line', depth: 1, values: [10000, 12500.5, 22500.5] },
    { label: 'Other', kind: 'line', depth: 1, values: [250, null, 250] },
    { label: 'Unused', kind: 'line', depth: 1, values: [0, null, 0] },
    { label: 'Net Income', kind: 'total', depth: 0, values: [-400, 1000, 600] },
  ],
}

test('month indexes skip the Total column', () => assert.deepEqual(monthIndexes(rep), [0, 1]))

test('compare Nov (a) with Oct (b): change and percentage', () => {
  const c = compareMonths(rep, 1, 0)
  assert.equal(c[0].change, null) // header
  assert.deepEqual([c[1].a, c[1].b, c[1].change], [12500.5, 10000, 2500.5])
  assert.ok(Math.abs(c[1].pct! - 0.25005) < 1e-9)
  assert.deepEqual([c[2].a, c[2].b, c[2].change], [null, 250, -250]) // blank treated as 0 for the change
  assert.equal(c[2].pct, -1)
  assert.equal(c[3].change, 0) // 0 vs blank: no NaN
  assert.equal(c[3].pct, null)
})

test('percentage is relative to |b| so a loss turning to profit reads as an improvement', () => {
  const net = compareMonths(rep, 1, 0)[4]
  assert.equal(net.change, 1400)
  assert.equal(net.pct, 3.5)
})

test('no percentage when the comparison month is zero or blank', () => {
  const c = compareMonths(rep, 0, 1)
  assert.equal(c[2].pct, null) // b blank
})

test('empty-line detection and formatting', () => {
  assert.equal(isEmptyRow(rep.rows[3]), true)
  assert.equal(isEmptyRow(rep.rows[1]), false)
  assert.equal(isEmptyRow(rep.rows[4]), false) // totals are never hidden
  assert.equal(fmtPct(0.25005), '+25.0%')
  assert.equal(fmtPct(-0.1), '-10.0%')
  assert.ok(fmtChange(-250).includes('250'))
})

import { compareToPrevious, displayLabel, isPartialMonth, visibleInDetail, type ReportRow } from '../src/lib/reportCompare.ts'

const mcol = (label: string) => ({ label, start: null, end: null, total: false })
const trend: MonthlyReport = {
  columns: [mcol('Aug'), mcol('Sep'), mcol('Oct'), mcol('Nov'), { label: 'Total', start: null, end: null, total: true }],
  rows: [
    { label: 'Sales', kind: 'line', depth: 1, values: [100, 200, 300, 600, 1200] },
    { label: 'Sporadic', kind: 'line', depth: 1, values: [null, 90, null, 30, 120] },
    { label: 'Nothing', kind: 'line', depth: 1, values: [null, null, null, null, null] },
  ],
}

test('current month vs previous N months: most recent first, average and change', () => {
  const { prevIdx, lines } = compareToPrevious(trend, 3, 2)
  assert.deepEqual(prevIdx, [2, 1]) // Oct then Sep
  assert.deepEqual(lines[0].prev, [300, 200])
  assert.equal(lines[0].avg, 250)
  assert.equal(lines[0].change, 350)
  assert.equal(lines[0].pct, 1.4)
})

test('blank months count as zero in the average; fully blank lines stay blank', () => {
  const { lines } = compareToPrevious(trend, 3, 3) // Oct, Sep, Aug
  assert.equal(lines[1].avg, 30) // (0 + 90 + 0) / 3
  assert.equal(lines[1].change, 0) // Nov 30 vs average 30
  assert.deepEqual([lines[2].avg, lines[2].change], [null, null])
})

test('N larger than the history is capped; the Total column is never used; N below 1 means 1', () => {
  assert.deepEqual(compareToPrevious(trend, 3, 99).prevIdx, [2, 1, 0])
  assert.ok(!compareToPrevious(trend, 3, 99).prevIdx.includes(4))
  assert.deepEqual(compareToPrevious(trend, 3, 0).prevIdx, [2])
})

test('no percentage when the previous-months average is zero', () => {
  const r: MonthlyReport = { columns: [mcol('Oct'), mcol('Nov')], rows: [{ label: 'New', kind: 'line', depth: 1, values: [null, 500] }] }
  const l = compareToPrevious(r, 1, 1).lines[0]
  assert.deepEqual([l.avg, l.change, l.pct], [0, 500, null])
})

test('partial month detection', () => {
  assert.equal(isPartialMonth({ label: 'Nov', start: '2026-11-01', end: '2026-11-02', total: false }), true)
  assert.equal(isPartialMonth({ label: 'Oct', start: '2026-10-01', end: '2026-10-31', total: false }), false)
  assert.equal(isPartialMonth({ label: 'Feb', start: '2028-02-01', end: '2028-02-29', total: false }), false)
  assert.equal(isPartialMonth(undefined), false)
})

// A P&L where "Advertising" is a parent account with sub-accounts.
const R = (label: string, kind: ReportRow['kind'], depth: number): ReportRow => ({ label, kind, depth, values: [1] })
const pnlRows: ReportRow[] = [
  R('Income', 'header', 0), R('Sales', 'line', 1), R('Total Income', 'total', 0),
  R('Expenses', 'header', 0),
  R('Office costs', 'line', 1),
  R('Advertising', 'header', 1), R('Google Ads', 'line', 2), R('Leaflets', 'line', 2), R('Total Advertising', 'total', 1),
  R('Total Expenses', 'total', 0),
  R('Net Income', 'total', 0),
]
const shown = (d: Parameters<typeof visibleInDetail>[1]) => pnlRows.filter((r) => visibleInDetail(r, d)).map((r) => displayLabel(r, d))

test('compact view: totals by category collapse a parent account to one line', () => {
  assert.deepEqual(shown('category'), ['Income', 'Sales', 'Total Income', 'Expenses', 'Office costs', 'Advertising', 'Total Expenses', 'Net Income'])
})

test('headline totals show only the top-level totals', () => {
  assert.deepEqual(shown('headline'), ['Total Income', 'Total Expenses', 'Net Income'])
})

test('more detail reveals sub-accounts; full detail changes nothing', () => {
  assert.deepEqual(shown('detail').filter((l) => ['Google Ads', 'Leaflets'].includes(l)), ['Google Ads', 'Leaflets'])
  assert.deepEqual(shown('full'), pnlRows.map((r) => r.label))
})
