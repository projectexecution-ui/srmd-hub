// "Raise next version" download: stream the PREVIOUS version's own uploaded
// Excel back, byte-for-byte, named as v(N+1). The engineer edits their real
// working (Working Sheet take-off, formulas, remarks intact) and re-uploads;
// the hub numbers it on upload. See lib/cost-control/next-version-file.ts.
//
// Called by fetch() from NewWSQuickForm, which falls back to the seeded fresh
// template on any non-200 — so every failure here is JSON with a reason:
//   403 no cost-control edit / [IB] estimate baseline
//   404 sheet or file missing
//   409 the stored file is not the standard template (legacy free-form upload)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { formatDate } from '@/lib/utils'
import { isStandardTemplateFile, nextVersionFilename } from '@/lib/cost-control/next-version-file'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const fail = (status: number, reason: string) => NextResponse.json({ ok: false, reason }, { status })

  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'edit')) return fail(403, 'no_permission')

  const { id } = await params
  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_ws_with_versions')
    .select('id, version_no, source_excel_url, summary_notes, project_id, discipline_id, sub_skill_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !ws) return fail(404, 'not_found')
  // The [IB…] Internal Estimate baseline is management-confidential and never
  // the start of an engineer's next version.
  if ((ws.summary_notes ?? '').startsWith('[IB')) return fail(403, 'estimate_baseline')
  if (!ws.source_excel_url) return fail(404, 'no_file')

  const { data: blob, error: dlErr } = await supabase.storage.from('cc-sheets').download(ws.source_excel_url)
  if (dlErr || !blob) return fail(404, 'download_failed')
  const buf = new Uint8Array(await blob.arrayBuffer())
  if (!isStandardTemplateFile(buf)) return fail(409, 'not_template')

  // Name it like a fresh template would be named, with the NEXT version number.
  const [pRes, dRes, sRes] = await Promise.all([
    supabase.from('projects').select('code, name').eq('id', ws.project_id).maybeSingle(),
    supabase.from('cc_disciplines').select('code, name').eq('id', ws.discipline_id).maybeSingle(),
    ws.sub_skill_id
      ? supabase.from('cc_sub_skills').select('code, name').eq('id', ws.sub_skill_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const filename = nextVersionFilename({
    projectCode: pRes.data?.code ?? undefined,       projectName: pRes.data?.name ?? undefined,
    disciplineCode: dRes.data?.code ?? undefined,    disciplineName: dRes.data?.name ?? undefined,
    subSkillCode: sRes.data?.code ?? undefined,      subSkillName: sRes.data?.name ?? undefined,
    versionNo: (ws.version_no ?? 1) + 1,
    dateText: formatDate(new Date()),
  })

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
