import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgeing } from '../src/lib/ageing.ts'
import type { Bill, VendorBalance } from '../src/lib/types.ts'

const bill = (date: string | null, due: string | null, open: number): Bill => ({
  txn_id: null, type: 'Bill', num: null, date, due, open_balance: open, days_overdue: 0, bucket: 'current',
})
const vendor = (id: string, bills: Bill[]): VendorBalance => ({
  vendor_id: id, name: id, total: bills.reduce((a, b) => a + b.open_balance, 0),
  buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91plus: 0 }, bills,
})
const TODAY = '2026-11-03'
const by = (basis: 'bill' | 'due', prev = 4) => ({ mode: 'months' as const, basis, prevMonths: prev, today: TODAY })

test('buckets by calendar month of the bill date, current month first, oldest last', () => {
  const v = vendor('A', [
    bill('2026-11-01', '2026-12-01', 100), // this month
    bill('2026-10-31', '2026-11-30', 200), // last month, on the boundary
    bill('2026-09-15', null, 300),
    bill('2026-07-01', null, 400), // 4 months back: still in
    bill('2026-06-30', null, 500), // 5 months back: older
    bill('2025-01-10', null, 600), // much older
  ])
  const a = buildAgeing([v], by('bill'))
  assert.deepEqual(a.columns.map((c) => c.label), ['Nov 2026', 'Oct 2026', 'Sep 2026', 'Aug 2026', 'Jul 2026', 'Before Jul 2026'])
  assert.deepEqual(a.rows.A, [100, 200, 300, 0, 400, 1100])
  assert.deepEqual(a.totals, [100, 200, 300, 0, 400, 1100])
})

test('by due date: bills due after this month go in a "Later" column, which appears only when needed', () => {
  const v = vendor('A', [bill('2026-10-20', '2026-12-05', 100), bill('2026-10-20', '2026-11-20', 50), bill('2026-08-01', '2026-08-31', 70)])
  const a = buildAgeing([v], by('due', 3))
  assert.deepEqual(a.columns.map((c) => c.label), ['Later', 'Nov 2026', 'Oct 2026', 'Sep 2026', 'Aug 2026', 'Before Aug 2026'])
  assert.deepEqual(a.rows.A, [100, 50, 0, 0, 70, 0])
  const none = buildAgeing([vendor('B', [bill('2026-10-20', '2026-10-30', 10)])], by('due', 3))
  assert.ok(!none.columns.some((c) => c.label === 'Later'))
})

test('credits net off in their own month, so each supplier row and the grand total still add up', () => {
  const v = vendor('A', [bill('2026-11-02', null, 500), bill('2026-11-02', null, -120), bill('2026-09-02', null, 80)])
  const w = vendor('B', [bill('2026-10-02', null, 40)])
  const a = buildAgeing([v, w], by('bill', 2))
  assert.deepEqual(a.rows.A, [380, 0, 80, 0])
  const sum = (xs: number[]) => Math.round(xs.reduce((p, c) => p + c, 0) * 100) / 100
  assert.equal(sum(a.rows.A), v.total)
  assert.equal(sum(a.totals), v.total + w.total)
})

test('missing dates fall back to the other date, then to today', () => {
  const a = buildAgeing([vendor('A', [bill(null, '2026-10-05', 10), bill(null, null, 20)])], by('bill', 2))
  assert.deepEqual(a.rows.A, [20, 10, 0, 0]) // undated -> this month; due-only -> its due month
})

test('month boundaries across a year end', () => {
  const a = buildAgeing([vendor('A', [bill('2025-12-31', null, 1), bill('2026-01-01', null, 2)])], { mode: 'months', basis: 'bill', prevMonths: 3, today: '2026-01-15' })
  assert.deepEqual(a.columns.map((c) => c.label), ['Jan 2026', 'Dec 2025', 'Nov 2025', 'Oct 2025', 'Before Oct 2025'])
  assert.deepEqual(a.rows.A, [2, 1, 0, 0, 0])
})

test('colour ramp runs green to deep red, oldest always the deepest', () => {
  const a = buildAgeing([vendor('A', [bill('2026-11-01', null, 1)])], by('bill', 4))
  const ramps = a.columns.map((c) => c.ramp)
  assert.equal(ramps[0], 0)
  assert.equal(ramps[ramps.length - 1], 4)
  assert.deepEqual([...ramps].sort((x, y) => x - y), ramps) // never goes backwards
  const withLater = buildAgeing([vendor('A', [bill('2026-10-01', '2027-01-01', 1)])], by('due', 4))
  assert.equal(withLater.columns[0].label, 'Later')
  assert.equal(withLater.columns[0].ramp, 0)
  assert.equal(withLater.columns[withLater.columns.length - 1].ramp, 4)
})

test('number of months is kept sensible', () => {
  assert.equal(buildAgeing([], by('bill', 0)).columns.length, 1 + 1 + 1) // clamps up to 1 previous month
  assert.equal(buildAgeing([], by('bill', 99)).columns.length, 1 + 24 + 1) // clamps to 24
})

test('days mode is exactly the existing 30/60/90 periods', () => {
  const v = { ...vendor('A', []), total: 10, buckets: { current: 1, d1_30: 2, d31_60: 3, d61_90: 4, d91plus: 0 } }
  const a = buildAgeing([v], { mode: 'days', basis: 'due', prevMonths: 4, today: TODAY })
  assert.deepEqual(a.columns.map((c) => c.label), ['Not yet due', '1–30 days', '31–60 days', '61–90 days', '91+ days'])
  assert.deepEqual(a.rows.A, [1, 2, 3, 4, 0])
  assert.deepEqual(a.totals, [1, 2, 3, 4, 0])
})
