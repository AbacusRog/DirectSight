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
