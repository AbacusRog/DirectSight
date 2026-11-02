import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMonthlyReport, reportWindow } from '../functions/_lib/reports.ts'

const c = (value: string, id?: string) => (id ? { value, id } : { value })
const m = (s: string, e: string) => [{ Name: 'StartDate', Value: s }, { Name: 'EndDate', Value: e }]

// Shaped like a QuickBooks ProfitAndLoss report summarised by month.
const pnl = {
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      { ColTitle: 'Oct 2026', ColType: 'Money', MetaData: m('2026-10-01', '2026-10-31') },
      { ColTitle: 'Nov 2026', ColType: 'Money', MetaData: m('2026-11-01', '2026-11-30') },
      { ColTitle: 'Total', ColType: 'Money' },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        Header: { ColData: [c('Income', '1'), c(''), c(''), c('')] },
        Rows: { Row: [
          { type: 'Data', ColData: [c('Sales', '4'), c('10,000.00'), c('12,500.50'), c('22,500.50')] },
          { type: 'Data', ColData: [c('Other income', '5'), c('250.00'), c(''), c('250.00')] },
        ] },
        Summary: { ColData: [c('Total Income'), c('10,250.00'), c('12,500.50'), c('22,750.50')] },
      },
      {
        type: 'Section',
        Summary: { ColData: [c('Gross Profit'), c('10,250.00'), c('12,500.50'), c('22,750.50')] },
      },
      {
        type: 'Section',
        Header: { ColData: [c('Expenses'), c(''), c(''), c('')] },
        Rows: { Row: [
          { type: 'Data', ColData: [c('Rent', '9'), c('2,000.00'), c('2,000.00'), c('4,000.00')] },
          { type: 'Data', ColData: [c('Refunds', '10'), c('(150.00)'), c('0.00'), c('(150.00)')] },
        ] },
        Summary: { ColData: [c('Total Expenses'), c('1,850.00'), c('2,000.00'), c('3,850.00')] },
      },
      { type: 'Section', Summary: { ColData: [c('Net Income'), c('8,400.00'), c('10,500.50'), c('18,900.50')] } },
    ],
  },
}

test('parses month columns, nesting, totals, blanks and bracketed negatives', () => {
  const r = parseMonthlyReport(pnl)
  assert.deepEqual(r.columns.map((x) => [x.label, x.start, x.end, x.total]), [
    ['Oct 2026', '2026-10-01', '2026-10-31', false],
    ['Nov 2026', '2026-11-01', '2026-11-30', false],
    ['Total', null, null, true],
  ])
  assert.deepEqual(r.rows.map((x) => [x.kind, x.label, x.depth]), [
    ['header', 'Income', 0],
    ['line', 'Sales', 1],
    ['line', 'Other income', 1],
    ['total', 'Total Income', 0],
    ['total', 'Gross Profit', 0],
    ['header', 'Expenses', 0],
    ['line', 'Rent', 1],
    ['line', 'Refunds', 1],
    ['total', 'Total Expenses', 0],
    ['total', 'Net Income', 0],
  ])
  assert.deepEqual(r.rows[1].values, [10000, 12500.5, 22500.5])
  assert.deepEqual(r.rows[2].values, [250, null, 250]) // blank cell -> null
  assert.deepEqual(r.rows[7].values, [-150, 0, -150]) // (150.00) -> -150
})

test('balance-sheet style report with month-end columns parses the same way', () => {
  const bs = {
    Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Oct 31, 2026', MetaData: m('2026-10-01', '2026-10-31') }] },
    Rows: { Row: [{ type: 'Section', Header: { ColData: [c('ASSETS'), c('')] }, Rows: { Row: [{ type: 'Data', ColData: [c('Bank'), c('5,000.00')] }] }, Summary: { ColData: [c('TOTAL ASSETS'), c('5,000.00')] } }] },
  }
  const r = parseMonthlyReport(bs)
  assert.equal(r.columns[0].end, '2026-10-31')
  assert.deepEqual(r.rows.map((x) => x.label), ['ASSETS', 'Bank', 'TOTAL ASSETS'])
})

test('rejects a report with no value columns; window is first of month 11 months ago through today', () => {
  assert.throws(() => parseMonthlyReport({ Columns: { Column: [{ ColTitle: '' }] }, Rows: {} }), /no value columns/)
  assert.deepEqual(reportWindow(new Date('2026-11-02T10:00:00Z'), 12), { start: '2025-12-01', end: '2026-11-02' })
  assert.deepEqual(reportWindow(new Date('2026-03-15T10:00:00Z'), 12), { start: '2025-04-01', end: '2026-03-15' })
})
