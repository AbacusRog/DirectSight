export type BucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd91plus'

export const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd91plus', label: '91+ days' },
]

export interface Bill {
  txn_id: string | null
  type: string // Bill, Vendor Credit, ...
  num: string | null
  date: string | null // YYYY-MM-DD invoice/bill date
  due: string | null // YYYY-MM-DD
  open_balance: number // negative for credits
  days_overdue: number // <= 0 means not yet due
  bucket: BucketKey
}

export interface VendorBalance {
  vendor_id: string
  name: string
  total: number
  buckets: Record<BucketKey, number>
  bills: Bill[]
}

export interface Snapshot {
  realm_id: string
  as_of: string
  fetched_at: string
  total: number
  vendors: VendorBalance[]
}

export interface Company {
  realm_id: string
  label: string
  company_name: string | null
}

export type TermsType =
  | 'due_date'
  | 'days_after_invoice'
  | 'day_of_month'
  | 'weekly_run'
  | 'immediate'

export interface SupplierRule {
  id?: string
  realm_id: string
  vendor_id: string
  vendor_name: string
  terms_type: TermsType
  terms_days: number | null
  day_of_month: number | null
  weekday: number | null // 0 = Sunday .. 6 = Saturday
  hold: boolean
  notes: string | null
}
