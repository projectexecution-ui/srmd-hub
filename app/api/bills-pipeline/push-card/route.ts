// Renders the current "Push today" list to a PNG for one-click copy to WhatsApp.
// The client posts the rows it is already showing; we only draw them into an
// image for the same authenticated viewer (cap + clamp to keep the SVG bounded).

import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions, can } from '@/lib/auth'
import { renderPushCard, type PushCardInput, type PushCardRow } from '@/lib/bills-pipeline/render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'view')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid JSON' }, { status: 400 })
  }

  const str = (v: unknown, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '')
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const rawRows = Array.isArray(body.rows) ? (body.rows as unknown[]).slice(0, 20) : []
  const rows: PushCardRow[] = rawRows.map(x => {
    const r = (x ?? {}) as Record<string, unknown>
    return {
      vendor: str(r.vendor),
      project: str(r.project, 12),
      area: str(r.area, 60),
      stage: str(r.stage, 60),
      billNo: str(r.billNo, 40),
      claimed: num(r.claimed),
      age: Math.max(0, Math.round(num(r.age))),
      idle: Math.max(0, Math.round(num(r.idle))),
      noWO: !!r.noWO,
      stalled: !!r.stalled,
    }
  })

  const input: PushCardInput = {
    scope: str(body.scope, 40) || 'All sites',
    rank: body.rank === 'days' ? 'days' : 'amt',
    asOf: str(body.asOf, 40) || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    rows,
  }

  const png = await renderPushCard(input)
  return new NextResponse(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  })
}
