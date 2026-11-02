import { useEffect, useState } from 'react'
import { WEEKDAYS } from './lib/paymentDates'
import type { SupplierRule, TermsType } from './lib/types'

const OPTIONS: { value: TermsType; label: string }[] = [
  { value: 'due_date', label: 'On the bill due date' },
  { value: 'days_after_invoice', label: 'A set number of days after the bill date' },
  { value: 'day_of_month', label: 'On a fixed day each month' },
  { value: 'weekly_run', label: 'In a weekly payment run' },
  { value: 'immediate', label: 'Immediately' },
]

export default function RuleEditor({
  rule,
  onSave,
  onClose,
}: {
  rule: SupplierRule
  onSave: (r: SupplierRule) => Promise<void>
  onClose: () => void
}) {
  const [r, setR] = useState<SupplierRule>(rule)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Escape closes the dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave({
        ...r,
        terms_days: r.terms_type === 'days_after_invoice' ? r.terms_days ?? 30 : null,
        day_of_month: r.terms_type === 'day_of_month' ? r.day_of_month ?? 25 : null,
        weekday: r.terms_type === 'weekly_run' ? r.weekday ?? 5 : null,
        notes: r.notes?.trim() || null,
      })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="panel w-full max-w-md space-y-4 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Payment rule for ${r.vendor_name}`}>
        <div>
          <h2 className="text-xl leading-tight">{r.vendor_name}</h2>
          <p className="text-sm text-muted">Payment rule</p>
        </div>

        <label className="block text-sm">
          <span className="text-muted">When do you pay this supplier?</span>
          <select autoFocus value={r.terms_type} onChange={(e) => setR({ ...r, terms_type: e.target.value as TermsType })} className="field mt-1 w-full">
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {r.terms_type === 'days_after_invoice' && (
          <label className="block text-sm">
            <span className="text-muted">Days after the bill date</span>
            <input type="number" min={0} value={r.terms_days ?? 30} onChange={(e) => setR({ ...r, terms_days: Number(e.target.value) })} className="field mt-1 w-full" />
          </label>
        )}
        {r.terms_type === 'day_of_month' && (
          <label className="block text-sm">
            <span className="text-muted">Day of the month (1 to 31; short months use their last day)</span>
            <input type="number" min={1} max={31} value={r.day_of_month ?? 25} onChange={(e) => setR({ ...r, day_of_month: Number(e.target.value) })} className="field mt-1 w-full" />
          </label>
        )}
        {r.terms_type === 'weekly_run' && (
          <label className="block text-sm">
            <span className="text-muted">Payment run day</span>
            <select value={r.weekday ?? 5} onChange={(e) => setR({ ...r, weekday: Number(e.target.value) })} className="field mt-1 w-full">
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={r.hold} onChange={(e) => setR({ ...r, hold: e.target.checked })} />
          Hold payment (dispute or query)
        </label>

        <label className="block text-sm">
          <span className="text-muted">Notes: requirements, contacts, bank detail reminders</span>
          <textarea rows={3} value={r.notes ?? ''} onChange={(e) => setR({ ...r, notes: e.target.value })} className="field mt-1 w-full" />
        </label>

        {error && <p className="notice notice-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? 'Saving…' : 'Save rule'}
          </button>
        </div>
      </div>
    </div>
  )
}
