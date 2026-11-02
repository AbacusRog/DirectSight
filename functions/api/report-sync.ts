import { CLIENT_COOLDOWN_SECONDS, authorise, canUseRealm, failure, fetchedWithin, json, type AuthResult, type Env } from '../_lib/qbo.ts'
import { REPORTS_FROM, syncReport, type Basis, type ReportKind } from '../_lib/reports.ts'

// POST /api/report-sync { realm_id, kind: 'pnl' | 'balance_sheet', basis?: 'Accrual' | 'Cash' }
// Admin: any company. Client: only their own, and at most once every couple of minutes per report.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let a: AuthResult | null = null
  try {
    a = await authorise(request, env)
    if ('error' in a) return json({ error: a.error }, 401)
    const b = (await request.json().catch(() => ({}))) as { realm_id?: string; kind?: string; basis?: string }
    if (!b.realm_id || !/^\d+$/.test(b.realm_id)) return json({ error: 'realm_id required' }, 400)
    if (!canUseRealm(a, b.realm_id)) return json({ error: 'You do not have access to that company.' }, 403)
    if (b.kind !== 'pnl' && b.kind !== 'balance_sheet') return json({ error: "kind must be 'pnl' or 'balance_sheet'" }, 400)
    const basis: Basis = b.basis === 'Cash' ? 'Cash' : 'Accrual'

    if (a.who === 'client') {
      const recent = await fetchedWithin(
        env,
        `ac_reports?realm_id=eq.${b.realm_id}&kind=eq.${b.kind}&basis=eq.${basis}&select=fetched_at,start_date`,
        CLIENT_COOLDOWN_SECONDS,
        REPORTS_FROM,
      )
      if (recent) return json({ fetched_at: recent, cached: true })
    }
    return json(await syncReport(env, b.realm_id, b.kind as ReportKind, basis))
  } catch (e) {
    return failure(a, e, 502)
  }
}
