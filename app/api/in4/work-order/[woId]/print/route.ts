// The printable work order, in IN4's own format.
//
// Returns HTML rather than a PDF on purpose: the browser's own print dialogue
// makes the PDF, which keeps a headless Chrome out of the deployment and means
// the page is also readable on screen. The wrapper carries a Print button and
// an A4 page rule.
//
// Gated on cost-control view — the same permission as the orders tree this is
// opened from, which already shows the order value and every line item. It
// carries no Internal Estimate figure, so the reviewer-only gate that guards
// the Budget tab's first pill does not apply here.

import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { loadWoPrint, renderTemplate, wrapForPrint, In4NotConfigured, RAW_TAGS } from '@/lib/in4/wo-print'
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
  { params }: { params: Promise<{ woId: string }> },
) {
  await requirePermission('cost-control', 'view')

  const { woId: raw } = await params
  const woId = Number(raw)
  if (!Number.isInteger(woId) || woId <= 0) {
    return page('Not a work order', `<p>“${raw}” is not a work-order id.</p>`, 400)
  }

  try {
    const d = await loadWoPrint(woId)
    const r = renderTemplate(d.templateHtml, d.scalars, d.rows, undefined, RAW_TAGS)
    const html = wrapForPrint(r.html, {
      displayNo: d.displayNo,
      templateName: d.templateName,
      unresolved: r.unresolved,
      rows: r.rows,
      sources: d.sources,
    })
    return new NextResponse(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Never cached: it is read straight from IN4 and must not be a stale
        // copy of an order that has since been amended.
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof In4NotConfigured) {
      // Say WHICH variable is absent, not just that something is. Two things
      // catch people out here and neither is visible from the old message:
      // Vercel scopes a variable per environment, and the trial site is a
      // PREVIEW deployment, so setting it on Production alone changes nothing
      // here; and a variable only reaches a deployment BUILT after it was
      // added, so an existing deployment keeps answering this page until it
      // is redeployed.
      const missing = in4MissingVars()
      return page('IN4 is not connected on this deployment', `
        <p>This work order is rendered live from IN4&rsquo;s own print template, so it needs the
        IN4 database login. ${missing.length === 2
          ? 'Neither variable is set on this deployment.'
          : `<b>${missing.join(', ')}</b> ${missing.length === 1 ? 'is' : 'are'} not set on this deployment (the other one is).`}</p>
        <p>Missing here: ${missing.map(v => `<code>${v}</code>`).join(', ') || 'nothing — so the failure is elsewhere'}</p>
        <p>Two things catch this out. A Vercel variable is scoped per environment, and this
        trial runs as a <b>Preview</b> deployment — setting it on Production only will not reach
        here. And a variable only reaches a deployment <b>built after</b> it was added, so this
        page keeps saying the same thing until the branch is redeployed.</p>`, 503)
    }
    const msg = e instanceof Error ? e.message : String(e)
    return page('The work order could not be rendered', `
      <p>IN4 was reachable but this order did not come back.</p>
      <p><code>${msg.replace(/[<>&]/g, '')}</code></p>`, 502)
  }
}
