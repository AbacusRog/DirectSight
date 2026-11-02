import { authorise, json, type Env } from '../_lib/qbo'
import { syncReport, type Basis, type ReportKind } from '../_lib/reports'

// POST /api/report-sync { realm_id, kind: 'pnl' | 'balance_sheet', basis?: 'Accrual' | 'Cash' }  (admin)
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const a = await authorise(request, env)
    if ('error' in a) return json({ error: a.error }, 401)
    const b = (await request.json().catch(() => ({}))) as { realm_id?: string; kind?: string; basis?: string }
    if (!b.realm_id || !/^\d+$/.test(b.realm_id)) return json({ error: 'realm_id required' }, 400)
    if (b.kind !== 'pnl' && b.kind !== 'balance_sheet') return json({ error: "kind must be 'pnl' or 'balance_sheet'" }, 400)
    const basis: Basis = b.basis === 'Cash' ? 'Cash' : 'Accrual'
    return json(await syncReport(env, b.realm_id, b.kind as ReportKind, basis))
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}
