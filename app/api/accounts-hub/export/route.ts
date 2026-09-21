// GET — the hub-wide Accounts lane as Excel, the same figures the screen shows.
//   ?view=trust[&trust=<id>]&raw=1
//   ?view=party[&party=<key>][&q=…][&all=1]&raw=1
//   ?view=retention&raw=1      ?view=fy&raw=1
// Same two gates as the page: cost-control view AND the named Accounts list.

import { NextResponse } from 'next/server'
import { getMyPermissions, can } from '@/lib/auth'
import { canOpenAccounts } from '@/lib/revamp/accounts-access'
import { fileSlug } from '@/lib/accounts/access'
import {
  loadByTrust, loadTrustProjects, loadTrustParties, loadByParty, loadPartyLedger, loadByFy,
  loadRetentionByTrust, loadRetentionByParty,
} from '@/lib/revamp/accounts-hub'
import { trustWorkbook, trustDetailWorkbook, partyWorkbook, ledgerWorkbook, fyWorkbook, retentionWorkbook } from '@/lib/accounts/hub-excel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'view')) return NextResponse.json({ ok: false, reason: 'Forbidden' }, { status: 403 })
  if (!(await canOpenAccounts())) return NextResponse.json({ ok: false, reason: 'Accounts is for the named accounts people' }, { status: 403 })

  const q = new URL(req.url).searchParams
  const raw = q.get('raw') === '1'
  const view = q.get('view') ?? 'trust'
  const tag = `${raw ? 'raw' : 'true'}_${new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)}`
  let body: Buffer, name: string

  try {
    if (view === 'trust' && /^\d+$/.test(q.get('trust') ?? '')) {
      const trustId = Number(q.get('trust'))
      const [all, projects, parties] = await Promise.all([loadByTrust(raw), loadTrustProjects(trustId, raw), loadTrustParties(trustId, raw)])
      const err = all.error ?? projects.error ?? parties.error
      if (err) return NextResponse.json({ ok: false, reason: err }, { status: 500 })
      const trust = all.rows.find(r => r.trust_id === trustId)
      if (!trust) return NextResponse.json({ ok: false, reason: 'No such trust' }, { status: 404 })
      body = trustDetailWorkbook(trust, projects.rows, parties.rows, raw)
      name = `Accounts_${fileSlug(trust.trust_code ?? 'trust')}_${tag}.xlsx`
    } else if (view === 'trust') {
      const r = await loadByTrust(raw)
      if (r.error) return NextResponse.json({ ok: false, reason: r.error }, { status: 500 })
      body = trustWorkbook(r.rows, raw); name = `Accounts_Trustwise_${tag}.xlsx`
    } else if (view === 'party' && /^[a-z0-9]{1,120}$/.test(q.get('party') ?? '')) {
      const key = q.get('party') as string
      const [ledger, parties] = await Promise.all([loadPartyLedger(key, raw), loadByParty({ raw, openOnly: false })])
      if (ledger.error) return NextResponse.json({ ok: false, reason: ledger.error }, { status: 500 })
      const party = parties.rows.find(x => x.party_key === key)?.party_name ?? key
      body = ledgerWorkbook(party, ledger.rows, raw); name = `Accounts_Ledger_${fileSlug(party)}_${tag}.xlsx`
    } else if (view === 'party') {
      const search = (q.get('q') ?? '').trim().slice(0, 80) || null
      const openOnly = q.get('all') !== '1' && !search
      const r = await loadByParty({ raw, openOnly, q: search })
      if (r.error) return NextResponse.json({ ok: false, reason: r.error }, { status: 500 })
      const label = search ? `firms matching "${search}"` : openOnly ? 'firms with money outstanding' : 'every firm'
      body = partyWorkbook(r.rows, raw, label); name = `Accounts_Parties${openOnly ? '_open' : ''}_${tag}.xlsx`
    } else if (view === 'retention') {
      const [t, p] = await Promise.all([loadRetentionByTrust(raw), loadRetentionByParty(raw)])
      const err = t.error ?? p.error
      if (err) return NextResponse.json({ ok: false, reason: err }, { status: 500 })
      body = retentionWorkbook(t.rows, p.rows, raw); name = `Accounts_Retention_${tag}.xlsx`
    } else if (view === 'fy') {
      const r = await loadByFy(raw)
      if (r.error) return NextResponse.json({ ok: false, reason: r.error }, { status: 500 })
      body = fyWorkbook(r.rows, raw); name = `Accounts_FYwise_${tag}.xlsx`
    } else {
      return NextResponse.json({ ok: false, reason: 'Unknown view' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  return new NextResponse(new Blob([new Uint8Array(body) as BlobPart]), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  })
}
