// The printable purchase order, in IN4's own format — the PO twin of
// /api/in4/work-order/[woId]/print. HTML on purpose: the browser's print
// dialogue makes the PDF, and the page is readable on screen.
//
// Gated on cost-control view, the same permission as the orders tree it is
// opened from, which already shows the order value and every line. It carries
// no Internal Estimate figure.

import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { renderTemplateGroups, wrapForPrint, In4NotConfigured } from '@/lib/in4/wo-print'
import { loadPoPrint } from '@/lib/in4/po-print'
import { in4MissingVars } from '@/lib/in4/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function page(title: string, body: string, status: number) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
     <style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
     background:#f8fafc;color:#0f172a;font:14px/1.55 system-ui,sans-serif}
     .c{max-width:560px}h1{font-size:19px;margin:0 0 8px}p{margin:0 0 8px;color:#475569}
     code{font:12.5px ui-monospace,Menlo,monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px}</style>
     </head><body><div class="c"><h1>${title}</h1>${body}</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ poId: string }> },
) {
  await requirePermission('cost-control', 'view')

  const { poId: raw } = await params
  const poId = Number(raw)
  if (!Number.isInteger(poId) || poId <= 0) {
    return page('Not a purchase order', `<p>“${raw.replace(/[<>&]/g, '')}” is not a purchase-order id.</p>`, 400)
  }

  try {
    const d = await loadPoPrint(poId)
    const r = renderTemplateGroups(d.templateHtml, d.scalars, d.groups)
    const html = wrapForPrint(r.html, {
      displayNo: d.displayNo,
      templateName: d.templateName,
      unresolved: r.unresolved,
      rows: r.rows,
      noun: 'item',
      sources: { conditions: d.sources.conditions, gaps: d.sources.gaps },
    })
    return new NextResponse(html, {
      status: 200,
      // Never cached: read straight from IN4, and an order can be amended.
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (e) {
    if (e instanceof In4NotConfigured) {
      const missing = in4MissingVars()
      return page('IN4 is not connected on this deployment', `
        <p>This purchase order is rendered live from IN4&rsquo;s own print template, so it needs the
        IN4 database login. ${missing.length === 2
          ? 'Neither variable is set on this deployment.'
          : `<b>${missing.join(', ')}</b> ${missing.length === 1 ? 'is' : 'are'} not set on this deployment (the other one is).`}</p>
        <p>Missing here: ${missing.map(v => `<code>${v}</code>`).join(', ') || 'nothing — so the failure is elsewhere'}</p>
        <p>A Vercel variable is scoped per environment and this trial runs as a <b>Preview</b>
        deployment; and a variable only reaches a deployment <b>built after</b> it was added.</p>`, 503)
    }
    const msg = e instanceof Error ? e.message : String(e)
    return page('The purchase order could not be rendered', `
      <p>IN4 was reachable but this order did not come back.</p>
      <p><code>${msg.replace(/[<>&]/g, '')}</code></p>`, 502)
  }
}
