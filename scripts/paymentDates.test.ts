import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestForBill, suggestForSupplier } from '../src/lib/paymentDates.ts'
import type { Bill, SupplierRule, VendorBalance } from '../src/lib/types.ts'

// Mon 2 Nov 2026
const TODAY = '2026-11-02'

const bill = (over: Partial<Bill>): Bill => ({
  txn_id: '1',
  type: 'Bill',
  num: null,
  date: '2026-10-01',
  due: '2026-10-31',
  open_balance: 100,
  days_overdue: 2,
  bucket: 'd1_30',
  ...over,
})

const rule = (over: Partial<SupplierRule>): SupplierRule => ({
  realm_id: 'r',
  vendor_id: 'v',
  vendor_name: 'V',
  terms_type: 'due_date',
  terms_days: null,
  day_of_month: null,
  weekday: null,
  hold: false,
  notes: null,
  ...over,
})

test('no rule: overdue bill is paid today', () => {
  assert.equal(suggestForBill(bill({}), undefined, TODAY).pay_on, '2026-11-02')
})

test('no rule: future due date used as is (working day)', () => {
  const b = bill({ due: '2026-11-10', days_overdue: -8, bucket: 'current' }) // Tue
  assert.equal(suggestForBill(b, undefined, TODAY).pay_on, '2026-11-10')
})

test('due date on a Saturday moves to the Friday before', () => {
  const b = bill({ due: '2026-11-14', days_overdue: -12, bucket: 'current' }) // Sat
  assert.equal(suggestForBill(b, undefined, TODAY).pay_on, '2026-11-13')
})

test('day_of_month 25th: latest 25th on/before due date', () => {
  const b = bill({ due: '2026-12-10', days_overdue: -38, bucket: 'current' })
  assert.equal(suggestForBill(b, rule({ terms_type: 'day_of_month', day_of_month: 25 }), TODAY).pay_on, '2026-11-25')
})

test('day_of_month: overdue bill rolls to next run', () => {
  const b = bill({ due: '2026-10-20', days_overdue: 13 })
  assert.equal(suggestForBill(b, rule({ terms_type: 'day_of_month', day_of_month: 25 }), TODAY).pay_on, '2026-11-25')
})

test('day_of_month 31 clamps to short months', () => {
  const b = bill({ due: '2026-03-02', date: '2026-02-01', days_overdue: -120, bucket: 'current' })
  // latest 31st on/before 2 Mar 2026 is 31 Jan; that is before today, so next run on/after 2 Nov is 30 Nov (30-day month)
  assert.equal(suggestForBill(b, rule({ terms_type: 'day_of_month', day_of_month: 31 }), TODAY).pay_on, '2026-11-30')
})

test('weekly_run Friday: latest Friday on/before due', () => {
  const b = bill({ due: '2026-11-18', days_overdue: -16, bucket: 'current' }) // Wed
  assert.equal(suggestForBill(b, rule({ terms_type: 'weekly_run', weekday: 5 }), TODAY).pay_on, '2026-11-13')
})

test('weekly_run Friday: overdue bill goes in next Friday run', () => {
  assert.equal(suggestForBill(bill({}), rule({ terms_type: 'weekly_run', weekday: 5 }), TODAY).pay_on, '2026-11-06')
})

test('days_after_invoice 14 from bill date, floors at today', () => {
  const b = bill({ date: '2026-10-05', due: '2026-11-04', days_overdue: -2, bucket: 'current' })
  assert.equal(suggestForBill(b, rule({ terms_type: 'days_after_invoice', terms_days: 14 }), TODAY).pay_on, '2026-11-02')
})

test('immediate pays today', () => {
  const b = bill({ due: '2026-12-31', days_overdue: -59, bucket: 'current' })
  assert.equal(suggestForBill(b, rule({ terms_type: 'immediate' }), TODAY).pay_on, '2026-11-02')
})

test('today on a Saturday moves to Monday', () => {
  assert.equal(suggestForBill(bill({}), undefined, '2026-11-07').pay_on, '2026-11-09')
})

test('hold and credits produce no date', () => {
  assert.equal(suggestForBill(bill({}), rule({ hold: true }), TODAY).pay_on, null)
  assert.equal(suggestForBill(bill({ open_balance: -50 }), undefined, TODAY).pay_on, null)
})

test('supplier summary: earliest date and amount due on it', () => {
  const v: VendorBalance = {
    vendor_id: 'v',
    name: 'V',
    total: 350,
    buckets: { current: 250, d1_30: 100, d31_60: 0, d61_90: 0, d91plus: 0 },
    bills: [
      bill({ txn_id: 'a', open_balance: 100 }),
      bill({ txn_id: 'b', open_balance: 250, due: '2026-11-20', days_overdue: -18, bucket: 'current' }),
    ],
  }
  const s = suggestForSupplier(v, undefined, TODAY)
  assert.equal(s.next_pay_on, '2026-11-02')
  assert.equal(s.amount_on_next, 100)
  assert.equal(s.payable_total, 350)
})
