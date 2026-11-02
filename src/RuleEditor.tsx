import { useState } from 'react'
import { WEEKDAYS } from './lib/paymentDates'
import type { SupplierRule, TermsType } from './lib/types'

const OPTIONS: { value: TermsType; label: string }[] = [
  { value: 'due_date', label: 'On the bill due date' },
  { value: 'days_after_invoice', label: 'X days after bill date' },
  { value: 'day_of_month', label: 'Fixed day each month' },
  { value: 'weekly_run', label: 'Weekly payment run' },
  { value: 'immediate', label: 'Pay immediately' },
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{r.vendor_name}</h2>

        <label className="block text-sm">
          <span className="text-slate-600">How do you pay this supplier?</span>
          <select
            value={r.terms_type}
            onChange={(e) => setR({ ...r, terms_type: e.target.value as TermsType })}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          >
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {r.terms_type === 'days_after_invoice' && (
          <label className="block text-sm">
            <span className="text-slate-600">Days after bill date</span>
            <input
              type="number"
              min={0}
              value={r.terms_days ?? 30}
              onChange={(e) => setR({ ...r, terms_days: Number(e.target.value) })}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </label>
        )}
        {r.terms_type === 'day_of_month' && (
          <label className="block text-sm">
            <span className="text-slate-600">Day of the month (1–31; short months use their last day)</span>
            <input
              type="number"
              min={1}
              max={31}
              value={r.day_of_month ?? 25}
              onChange={(e) => setR({ ...r, day_of_month: Number(e.target.value) })}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </label>
        )}
        {r.terms_type === 'weekly_run' && (
          <label className="block text-sm">
            <span className="text-slate-600">Payment run day</span>
            <select
              value={r.weekday ?? 5}
              onChange={(e) => setR({ ...r, weekday: Number(e.target.value) })}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            >
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
          Hold – don't suggest payment (dispute / query)
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Notes (requirements, contact, bank detail reminders…)</span>
          <textarea
            rows={3}
            value={r.notes ?? ''}
            onChange={(e) => setR({ ...r, notes: e.target.value })}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
