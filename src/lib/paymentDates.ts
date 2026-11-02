import type { Bill, SupplierRule, VendorBalance } from './types'

// All dates are handled as UTC midnight to avoid DST/timezone drift.
const DAY = 86_400_000

export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function fmtISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY)
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

/** Date in the given month with day-of-month clamped to the month length. */
function onDay(y: number, m0: number, day: number): Date {
  return new Date(Date.UTC(y, m0, Math.min(day, daysInMonth(y, m0))))
}

/** Latest occurrence of `day` of the month that is on or before `limit`. */
function latestDayOnOrBefore(limit: Date, day: number): Date {
  let y = limit.getUTCFullYear()
  let m = limit.getUTCMonth()
  let c = onDay(y, m, day)
  if (c > limit) {
    m -= 1
    if (m < 0) {
      m = 11
      y -= 1
    }
    c = onDay(y, m, day)
  }
  return c
}

/** First occurrence of `day` of the month that is on or after `from`. */
function nextDayOnOrAfter(from: Date, day: number): Date {
  let y = from.getUTCFullYear()
  let m = from.getUTCMonth()
  let c = onDay(y, m, day)
  if (c < from) {
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
    c = onDay(y, m, day)
  }
  return c
}

function latestWeekdayOnOrBefore(limit: Date, weekday: number): Date {
  const diff = (limit.getUTCDay() - weekday + 7) % 7
  return addDays(limit, -diff)
}

function nextWeekdayOnOrAfter(from: Date, weekday: number): Date {
  const diff = (weekday - from.getUTCDay() + 7) % 7
  return addDays(from, diff)
}

/**
 * Move a weekend date to a working day. Prefers the previous Friday (paying a
 * day or two early is safe) unless that would be before `today`, then Monday.
 * UK bank holidays are not handled.
 */
function toWorkingDay(d: Date, today: Date): Date {
  const dow = d.getUTCDay()
  if (dow !== 0 && dow !== 6) return d
  const friday = addDays(d, dow === 6 ? -1 : -2)
  if (friday >= today) return friday
  return addDays(d, dow === 6 ? 2 : 1)
}

export interface BillSuggestion {
  bill: Bill
  pay_on: string | null // null when on hold
  reason: string
}

/** The payment date a rule would pick for one bill. Credits are not scheduled. */
export function suggestForBill(
  bill: Bill,
  rule: SupplierRule | undefined,
  todayISO: string,
): BillSuggestion {
  const today = parseDate(todayISO)

  if (bill.open_balance <= 0) {
    return { bill, pay_on: null, reason: 'Credit – offset against payments' }
  }
  if (rule?.hold) {
    return { bill, pay_on: null, reason: 'On hold' }
  }

  const due = bill.due ? parseDate(bill.due) : bill.date ? parseDate(bill.date) : today
  const billDate = bill.date ? parseDate(bill.date) : due
  const type = rule?.terms_type ?? 'due_date'

  let target: Date
  let reason: string

  switch (type) {
    case 'immediate':
      target = today
      reason = 'Pay on receipt of funds / immediately'
      break
    case 'days_after_invoice': {
      const n = rule?.terms_days ?? 30
      target = addDays(billDate, n)
      reason = `${n} days after bill date`
      break
    }
    case 'day_of_month': {
      const day = rule?.day_of_month ?? 25
      target = latestDayOnOrBefore(due, day)
      reason = `Monthly run on the ${day}${ordinal(day)}`
      if (target < today) {
        target = nextDayOnOrAfter(today, day)
        reason += ' (overdue – next run)'
      }
      break
    }
    case 'weekly_run': {
      const wd = rule?.weekday ?? 5
      target = latestWeekdayOnOrBefore(due, wd)
      reason = `Weekly run on ${WEEKDAYS[wd]}`
      if (target < today) {
        target = nextWeekdayOnOrAfter(today, wd)
        reason += ' (overdue – next run)'
      }
      break
    }
    default:
      target = due
      reason = 'On bill due date'
  }

  if (target < today) {
    target = today
    if (bill.days_overdue > 0) reason += ' – overdue, pay now'
  }
  target = toWorkingDay(target, today)

  return { bill, pay_on: fmtISO(target), reason }
}

export interface SupplierSuggestion {
  /** Earliest date on which something should be paid, or null if all on hold / credits. */
  next_pay_on: string | null
  /** Total of bills scheduled on or before next_pay_on. */
  amount_on_next: number
  /** Sum of all positive open bills, ignoring holds. */
  payable_total: number
  per_bill: BillSuggestion[]
  on_hold: boolean
}

export function suggestForSupplier(
  vendor: VendorBalance,
  rule: SupplierRule | undefined,
  todayISO: string,
): SupplierSuggestion {
  const per_bill = vendor.bills.map((b) => suggestForBill(b, rule, todayISO))
  const dated = per_bill.filter((s) => s.pay_on)
  const next = dated.length ? dated.map((s) => s.pay_on as string).sort()[0] : null
  const amount_on_next = next
    ? dated.filter((s) => (s.pay_on as string) <= next).reduce((a, s) => a + s.bill.open_balance, 0)
    : 0
  const payable_total = vendor.bills.filter((b) => b.open_balance > 0).reduce((a, b) => a + b.open_balance, 0)
  return { next_pay_on: next, amount_on_next, payable_total, per_bill, on_hold: !!rule?.hold }
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

export function describeRule(rule: SupplierRule | undefined): string {
  if (!rule) return 'Not set – defaults to bill due date'
  if (rule.hold) return 'On hold'
  switch (rule.terms_type) {
    case 'immediate':
      return 'Pay immediately'
    case 'days_after_invoice':
      return `${rule.terms_days ?? 30} days after bill date`
    case 'day_of_month':
      return `Monthly run on the ${rule.day_of_month ?? 25}${ordinal(rule.day_of_month ?? 25)}`
    case 'weekly_run':
      return `Weekly run on ${WEEKDAYS[rule.weekday ?? 5]}`
    default:
      return 'On bill due date'
  }
}
