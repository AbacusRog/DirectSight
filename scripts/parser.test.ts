import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAgedPayableDetail } from '../functions/_lib/qbo.ts'

// Shaped like QuickBooks' AgedPayableDetail response (sections by ageing, Data rows per bill).
const col = (value: string, id?: string) => (id ? { value, id } : { value })
const report = {
  Columns: {
    Column: [
      { ColTitle: 'Date' },
      { ColTitle: 'Transaction Type' },
      { ColTitle: 'Num' },
      { ColTitle: 'Vendor' },
      { ColTitle: 'Due Date' },
      { ColTitle: 'Past Due' },
      { ColTitle: 'Amount' },
      { ColTitle: 'Open Balance' },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        Header: { ColData: [col('Current')] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [col('2026-10-20'), col('Bill', '11'), col('INV1'), col('Acme Ltd', '5'), col('2026-11-19'), col(''), col('400.00'), col('400.00')] },
          ],
        },
      },
      {
        type: 'Section',
        Header: { ColData: [col('91 or more days past due')] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [col('2026-06-01'), col('Bill', '12'), col('INV2'), col('Acme Ltd', '5'), col('2026-07-01'), col('124'), col('1000.00'), col('1000.00')] },
            { type: 'Data', ColData: [col('2026-06-10'), col('Vendor Credit', '13'), col(''), col('Acme Ltd', '5'), col('2026-06-10'), col('145'), col('-100.00'), col('-100.00')] },
            { type: 'Data', ColData: [col('2026-05-01'), col('Bill', '14'), col('X9'), col('Bolt & Co', '6'), col('2026-08-01'), col('93'), col('250.50'), col('250.50')] },
          ],
        },
      },
      { type: 'Section', Header: { ColData: [col('1 - 30 days past due')] }, Rows: { Row: [
        { type: 'Data', ColData: [col('2026-09-20'), col('Bill', '15'), col('B1'), col('Bolt & Co', '6'), col('2026-10-25'), col('8'), col('75.25'), col('75.25')] },
        { type: 'Data', ColData: [col('2026-09-20'), col('Bill', '16'), col('Z'), col('Zero Ltd', '7'), col('2026-10-25'), col('8'), col('10.00'), col('0.00')] },
      ] } },
    ],
  },
}

test('groups by vendor, buckets by due date, keeps credits, skips zero balances', () => {
  const r = parseAgedPayableDetail(report, '2026-11-02')
  assert.equal(r.vendors.length, 2)
  assert.equal(r.total, 400 + 1000 - 100 + 250.5 + 75.25)

  const acme = r.vendors.find((v) => v.vendor_id === '5')!
  assert.equal(acme.total, 1300)
  assert.equal(acme.buckets.current, 400)
  assert.equal(acme.buckets.d91plus, 900)
  assert.equal(acme.bills.length, 3)

  const bolt = r.vendors.find((v) => v.vendor_id === '6')!
  assert.equal(bolt.buckets.d91plus, 250.5) // due 1 Aug -> 93 days overdue on 2 Nov
  assert.equal(bolt.buckets.d1_30, 75.25) // due 25 Oct -> 8 days
  assert.equal(r.vendors[0].name, 'Acme Ltd') // sorted by total desc
})

test('rejects an unexpected layout', () => {
  assert.throws(() => parseAgedPayableDetail({ Columns: { Column: [{ ColTitle: 'Foo' }] }, Rows: { Row: [] } }, '2026-11-02'))
})

// Layout where the supplier is the SECTION HEADING (no Vendor column) and columns carry ColKey metadata.
const meta = (key: string) => [{ Name: 'ColKey', Value: key }]
const grouped = {
  Columns: {
    Column: [
      { ColTitle: 'Date', MetaData: meta('tx_date') },
      { ColTitle: 'Transaction type', MetaData: meta('txn_type') },
      { ColTitle: 'No.', MetaData: meta('doc_num') },
      { ColTitle: 'Due date', MetaData: meta('due_date') },
      { ColTitle: 'Amount', MetaData: meta('subt_nat_amount') },
      { ColTitle: 'Open balance', MetaData: meta('rbal_nat_amount') },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Acme Ltd', id: '5' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [col('2026-06-01'), col('Bill', '12'), col('INV2'), col('2026-07-01'), col('1,000.00'), col('1,000.00')] },
            { type: 'Data', ColData: [col('2026-10-20'), col('Bill', '11'), col('INV1'), col('2026-11-19'), col('400.00'), col('400.00')] },
          ],
        },
        Summary: { ColData: [col('Total for Acme Ltd')] },
      },
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Bolt & Co', id: '6' }] },
        Rows: { Row: [{ type: 'Data', ColData: [col('2026-09-20'), col('Bill', '15'), col('B1'), col('2026-10-25'), col('75.25'), col('75.25')] }] },
      },
    ],
  },
}

test('supplier taken from the section heading when there is no Vendor column; thousands separators handled', () => {
  const r = parseAgedPayableDetail(grouped, '2026-11-02')
  assert.equal(r.vendors.length, 2)
  const acme = r.vendors.find((v) => v.vendor_id === '5')!
  assert.equal(acme.name, 'Acme Ltd')
  assert.equal(acme.total, 1400)
  assert.equal(acme.buckets.d91plus, 1000)
  assert.equal(acme.buckets.current, 400)
  assert.equal(r.vendors.find((v) => v.name === 'Bolt & Co')!.buckets.d1_30, 75.25)
})

test('empty report gives no suppliers; bad layout error lists the columns QuickBooks sent', () => {
  assert.deepEqual(parseAgedPayableDetail({ Columns: grouped.Columns, Rows: {} }, '2026-11-02').vendors, [])
  assert.throws(
    () => parseAgedPayableDetail({ Columns: { Column: [{ ColTitle: 'Foo' }, { ColTitle: 'Bar' }] }, Rows: { Row: [] } }, '2026-11-02'),
    /got: Foo, Bar/,
  )
})
