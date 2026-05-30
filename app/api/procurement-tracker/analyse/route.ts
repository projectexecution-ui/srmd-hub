import { NextRequest, NextResponse } from 'next/server'
import { parseProcurementReport } from '@/lib/procurement-tracker'
import { requirePermission } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  // Gate by hub-wide procurement-tracker view perm. requirePermission
  // redirects on fail when called from a page; here we want a 403 JSON
  // instead, so we re-do the check inline by trying it and catching the
  // NEXT redirect — simpler to just call it and let the redirect throw
  // up to the runtime, which converts it into a redirect response. For
  // an API route consumed by fetch() that's fine: client gets a 307 with
  // Location: /dashboard which they can detect and surface.
  await requirePermission('procurement-tracker', 'view')

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]
    if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      return NextResponse.json({ error: 'Please upload an Excel file (.xlsx or .xls)' }, { status: 400 })
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 20MB.' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const result = parseProcurementReport(buffer)

    // Shape MUST match what client.tsx consumes:
    //   AnalyseResponse = ParseResult & { success, fileName, error? }
    // i.e. the parsed payload lives under `projects`, not `summaries`.
    // (Earlier draft used `summaries` here, which made every upload
    // crash on the client with `Cannot read properties of undefined
    // (reading '0')` from `json.projects[0]`.)
    return NextResponse.json({
      success: true,
      fileName: file.name,
      format: result.format,
      projects: result.projects,
    })
  } catch (err) {
    console.error('Procurement parse error:', err)
    const message = err instanceof Error ? err.message : 'Failed to parse file.'
    return NextResponse.json(
      { error: message },
      { status: 500 },
    )
  }
}
