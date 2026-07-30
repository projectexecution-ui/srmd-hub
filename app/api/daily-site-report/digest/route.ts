// On-demand daily digest card (PNG). Management-only. Renders the day's
// material arrivals as a shareable image the user posts to WhatsApp by hand.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, getMyProfile, can } from '@/lib/auth'
import { renderDigest, type DigestRow } from '@/lib/daily-site-report/render'
import { deriveStage } from '@/lib/daily-site-report/stages'
import type { Project, Vendor } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RelObj<T> = T | T[] | null | undefined
function unwrap<T>(v: RelObj<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function GET(req: NextRequest) {
  const [perms, profile] = await Promise.all([getMyPermissions(), getMyProfile()])
  const role = profile?.role
  const isMgmt = role === 'admin' || role === 'project_head' || role === 'head' || role === 'founder'
  if (!can(perms, 'daily-site-report', 'view') || !isMgmt) {
    return NextResponse.json({ ok: false, reason: 'Forbidden' }, { status: 403 })
  }

  const IST = 5.5 * 3600 * 1000
  const todayIST = new Date(Date.now() + IST).toISOString().slice(0, 10)
  const q = req.nextUrl.searchParams.get('date') || ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayIST

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('dsr_reports')
    .select(
      'project_id, supplier_name_text, material_description, quantity, unit, amount,' +
      ' bill_submitted_to_ct, payment_started, grn_done, paid,' +
      ' projects ( code, name ), vendors ( name )',
    )
    .eq('received_on', date)
    .order('project_id')
  if (error) {
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  }

  type Raw = {
    supplier_name_text: string | null
    material_description: string
    quantity: number | string | null
    unit: string | null
    amount: number | string | null
    bill_submitted_to_ct: boolean
    payment_started: boolean
    grn_done: boolean
    paid: boolean
    projects: RelObj<Project>
    vendors: RelObj<Vendor>
  }
  const rows: DigestRow[] = ((data ?? []) as unknown as Raw[]).map(r => {
    const proj = unwrap(r.projects)
    const vend = unwrap(r.vendors)
    const stage = deriveStage({
      bill_submitted_to_ct: !!r.bill_submitted_to_ct,
      payment_started: !!r.payment_started,
      grn_done: !!r.grn_done,
      paid: !!r.paid,
    })
    return {
      site: proj?.code || proj?.name || '—',
      supplier: vend?.name || r.supplier_name_text || '—',
      material: r.material_description,
      qty: r.quantity != null ? `${r.quantity}${r.unit ? ' ' + r.unit : ''}` : (r.unit || ''),
      amount: r.amount != null ? Number(r.amount) : null,
      stage: stage.label,
    }
  })

  const png = await renderDigest({ date, generatedAt: new Date().toISOString(), rows })
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="site-report-${date}.png"`,
    },
  })
}
