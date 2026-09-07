// Printing a work order in IN4's OWN format.
//
// Aksha asked to open the WO/PO PDF from the orders tree, then asked the right
// question: if CT Hub renders it, how would it match IN4's format? It does not
// have to approximate it — IN4 keeps every printed report as HTML with merge
// tags in `COMMON_HtmlTemplate`, so we read IN4's template and fill it from the
// same tables IN4 fills it from. [[feedback_dont_guess_follow_the_source]].
//
// ── WHAT WAS ESTABLISHED FIRST (7 Sept 2026, live IN4) ──────────────────────
//
// The PDFs themselves are NOT available. `COMMON_DOCUMENT` holds only a path on
// the IN4 server's own disk (F:\In4re\Filestore\{guid}.pdf); no column anywhere
// stores a document as data. Only 179 of 2,157 work orders have any attachment
// at all, and those are approval screenshots, not the order. Purchase orders
// have none — `PO_Documents` is empty. So there is nothing to link to, and
// rendering is the only route.
//
// Template 109, "Work Order Medium", is the live work-order format. That is not
// a guess from the name: several WO templates are flagged Active (including one
// called "…-Test"), and `COMMON_HtmlPrintCount` — IN4's own print log — shows
// 109 used for event 3 as recently as 5 Sept 2026 by two different users. The
// log is the only honest way to tell which template a team actually gets.
//
// `ENGG_WO_BOQ_PRINT_DETAILS` is IN4's already-rendered BOQ block for the
// printed order (serial number, category, description, unit, quantity, rate,
// amount, notes), so the hardest part of the document is not rebuilt.
//
// ── HONESTY RULES ───────────────────────────────────────────────────────────
//
// A tag we cannot source is left EMPTY and reported, never filled with a guess
// or a zero (§10). The renderer returns the list of unresolved tags so the
// route can say so out loud rather than shipping a document with quiet holes.
//
// The output carries a line saying it was rendered by CT Hub from IN4 on a
// given date. A document indistinguishable from the issued order would
// eventually be treated as the issued order, and IN4 is the system of record.

import { in4Query, in4Config } from './db'

/** The six tags that make up one repeating BOQ row in template 109. */
export const BOQ_ROW_TAGS = [
  '[BOQ_Name]', '[BOQ_Description]', '[BOQQty]', '[BOQ_Unit]', '[BOQ_Rate]', '[BOQ_Amount]',
] as const

export interface PrintRow { [tag: string]: string }

export interface RenderResult {
  html: string
  /** Tags the template asked for and nothing supplied. Reported, not hidden. */
  unresolved: string[]
  /** How many repeating rows were written. */
  rows: number
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Fill an IN4 template.
 *
 * `scalars` are the once-per-document tags. `rows` are the repeating ones: the
 * template carries ONE `<tr>` holding the row tags, and IN4 duplicates it per
 * line — so this finds that row, clones it, and substitutes per line.
 *
 * Pure and synchronous on purpose: the substitution is the part that can go
 * subtly wrong, so it is unit-tested away from any database.
 */
export function renderTemplate(
  templateHtml: string,
  scalars: Record<string, string | null | undefined>,
  rows: PrintRow[],
  rowTags: readonly string[] = BOQ_ROW_TAGS,
): RenderResult {
  let html = templateHtml
  const asked = new Set(html.match(/\[[A-Za-z0-9_.\- ]+\]/g) ?? [])

  // ── The repeating block ──────────────────────────────────────────────────
  let rowsWritten = 0
  let rowBlockRendered = false
  const anchor = rowTags.find(t => html.includes(t))
  if (anchor) {
    const at = html.indexOf(anchor)
    const open = html.lastIndexOf('<tr', at)
    const closeAt = html.indexOf('</tr>', at)
    if (open !== -1 && closeAt !== -1) {
      const rowTemplate = html.slice(open, closeAt + '</tr>'.length)
      const rendered = rows.map(r =>
        rowTags.reduce(
          (acc, tag) => acc.split(tag).join(escapeHtml(r[tag] ?? '')),
          rowTemplate,
        ),
      ).join('\n')
      // An order with no BOQ lines gets no phantom row: the block collapses.
      html = html.slice(0, open) + rendered + html.slice(closeAt + '</tr>'.length)
      rowsWritten = rows.length
      rowBlockRendered = true
    }
  }

  // ── The scalars ──────────────────────────────────────────────────────────
  const supplied = new Set<string>()
  for (const [tag, value] of Object.entries(scalars)) {
    if (!html.includes(tag)) continue
    supplied.add(tag)
    html = html.split(tag).join(value == null || value === '' ? '' : escapeHtml(String(value)))
  }

  // Anything the template still asks for goes blank — but is named in the
  // result so nobody has to spot a silent hole on a printed page.
  const unresolved: string[] = []
  for (const tag of asked) {
    if (supplied.has(tag)) continue
    // A row tag is normally consumed by the block above. If that block could
    // not be found — IN4 restructuring the template, say — the tag would
    // otherwise PRINT RAW on the page. Clear and report it instead.
    if (rowBlockRendered && (rowTags as readonly string[]).includes(tag)) continue
    unresolved.push(tag)
    html = html.split(tag).join('')
  }

  return { html, unresolved: unresolved.sort(), rows: rowsWritten }
}

/* ── loading one work order out of IN4 ──────────────────────────────────── */

export interface WoPrintData {
  woId: number
  displayNo: string
  scalars: Record<string, string | null>
  rows: PrintRow[]
  templateId: number
  templateName: string
  templateHtml: string
}

/** IN4's date format on a printed order. */
function fmtDate(v: unknown): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Money as the printed order shows it — grouped, no paise. */
function fmtMoney(v: unknown): string | null {
  const n = v == null ? NaN : Number(v)
  if (!Number.isFinite(n)) return null
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

/** A quantity keeps its decimals; a rate keeps two. */
function fmtNum(v: unknown, dp = 3): string | null {
  const n = v == null ? NaN : Number(v)
  if (!Number.isFinite(n)) return null
  return n.toLocaleString('en-IN', { maximumFractionDigits: dp })
}

export class In4NotConfigured extends Error {
  constructor() {
    super('IN4 is not configured on this deployment, so the work order cannot be rendered from its own template. Set IN4_DB_USER and IN4_DB_PASSWORD.')
    this.name = 'In4NotConfigured'
  }
}

/**
 * Everything template 109 needs for one work order.
 *
 * The work-order id is IN4's own `ENGG_WORK_ORDER.ID`, which is exactly what
 * the orders tree already carries as `wo_id`, so there is no name matching
 * anywhere in this path.
 */
export async function loadWoPrint(woId: number): Promise<WoPrintData> {
  if (!in4Config()) throw new In4NotConfigured()
  if (!Number.isInteger(woId) || woId <= 0) throw new Error(`Not a work-order id: ${woId}`)

  // Which template IN4 actually prints for event 3 (work order), decided by
  // IN4's own print log rather than by a name — then the newest active one as
  // a fallback if nothing has been printed yet.
  const [tpl] = await in4Query<{ TemplateID: number; TemplateName: string; html: string }>(`
    SELECT TOP 1 t.TemplateID, t.TemplateName, CAST(t.TemplateHtml AS nvarchar(MAX)) AS html
    FROM COMMON_HtmlTemplate t
    LEFT JOIN (
      SELECT TEMPLATE_ID, COUNT(*) AS prints, MAX(PRINT_DATE) AS last_print
      FROM COMMON_HtmlPrintCount WHERE EVENT_ID = 3 GROUP BY TEMPLATE_ID
    ) p ON p.TEMPLATE_ID = t.TemplateID
    WHERE t.EventID = 3 AND t.Active = 1
      AND LEN(CAST(t.TemplateHtml AS nvarchar(MAX))) > 0
    ORDER BY p.last_print DESC, p.prints DESC, t.LastModifiedOn DESC`)
  if (!tpl?.html) throw new Error('IN4 holds no active work-order print template (event 3).')

  const [wo] = await in4Query<Record<string, unknown>>(`
    SELECT w.ID, w.DISPLAY_NO, w.WORK_DESCRIPTION, w.WORK_ORDER_VALUE, w.FROM_DT, w.TO_DT,
           w.TERMS_CONDITIONS, w.CONTACT_DETAILS,
           sp.FIRM_NAME contractor, sp.PAN_NO contractor_pan, sp.GSTIN_NO contractor_gstin,
           sp.CONTACT_PERSON cp_name, sp.CONTACT_DETAILS cp_contact,
           a.ADDR addr, a.PIN pin, a.OFF_PHONE off_phone, a.MOBILE mobile, a.EMAIL email,
           l.NAME city, st.NAME state,
           sk.NAME work_category,
           prj.NAME project, sub.SUBPROJECT_NAME subproject,
           co.CompanyName company, co.CompanyCode company_code, co.CompanyPrintName company_print
    FROM ENGG_WORK_ORDER w
    LEFT JOIN ENGG_SERVICE_PROVIDER sp ON sp.ID = w.SERVICE_PROVIDER_ID
    LEFT JOIN COMMON_ADDRESS a ON a.ID = sp.ADDR_ID
    LEFT JOIN COMMON_LOCATION_LOOKUP l ON l.ID = a.LOCATION_ID
    LEFT JOIN COMMON_STATE_LOOKUP st ON st.ID = a.STATE_ID
    LEFT JOIN ENGG_SKILLS_LOOKUP sk ON sk.ID = w.SKILL_ID
    LEFT JOIN ENGG_PROJECT prj ON prj.ID = w.PROJECT_ID
    LEFT JOIN ENGG_SUBPROJECT sub ON sub.ID = w.SUBPROJECT_ID
    LEFT JOIN COMMON.TBLCOMMONCOMPANY co ON co.CompanyID = w.PAYING_CO_ID
    WHERE w.ID = ${woId}`)
  if (!wo) throw new Error(`IN4 has no work order with id ${woId}.`)

  // IN4's own printed BOQ block for this order.
  const boq = await in4Query<Record<string, unknown>>(`
    SELECT SLNO, CATEGORY, SUBCATEGORY, NAME, DESCRIPTION, ITEM_CODE, UNIT, QUANTITY, RATE, AMOUNT, NOTES
    FROM ENGG_WO_BOQ_PRINT_DETAILS WHERE WORK_ORDER_ID = ${woId}
    ORDER BY TRY_CAST(SLNO AS float), SLNO`)

  const displayNo = String(wo.DISPLAY_NO ?? `WO ${woId}`)
  const str = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())

  const scalars: Record<string, string | null> = {
    // The order
    '[Work order No]': displayNo,
    '[Work Order Cost]': fmtMoney(wo.WORK_ORDER_VALUE),
    '[Work Order Gross Value]': fmtMoney(wo.WORK_ORDER_VALUE),
    '[From Date ]': fmtDate(wo.FROM_DT),
    '[To Date]': fmtDate(wo.TO_DT),
    '[Work Description]': str(wo.WORK_DESCRIPTION),
    '[Scope of Work]': str(wo.WORK_DESCRIPTION),
    '[Work Category]': str(wo.work_category),
    '[Project]': str(wo.project),
    '[Sub Project]': str(wo.subproject),
    '[Wo_Terms_and_Condititons]': str(wo.TERMS_CONDITIONS),

    // The contractor
    '[Contractor Firm]': str(wo.contractor),
    '[Contractor PAN]': str(wo.contractor_pan),
    '[Street]': str(wo.addr),
    '[City]': str(wo.city),
    '[State]': str(wo.state),
    '[Pin]': str(wo.pin),
    '[Phone No]': str(wo.mobile) ?? str(wo.off_phone),
    '[Email]': str(wo.email),
    '[CP_Name]': str(wo.cp_name),
    '[CP_Mobile]': str(wo.mobile) ?? str(wo.cp_contact),
    '[CP_Email]': str(wo.email),

    // The paying company
    '[COMPANYNAME]': str(wo.company_print) ?? str(wo.company),
    '[COMPANYCODE]': str(wo.company_code),
  }

  const rows: PrintRow[] = boq.map(b => ({
    '[BOQ_Name]': str(b.NAME) ?? str(b.SUBCATEGORY) ?? '',
    '[BOQ_Description]': str(b.DESCRIPTION) ?? '',
    '[BOQQty]': fmtNum(b.QUANTITY) ?? '',
    '[BOQ_Unit]': str(b.UNIT) ?? '',
    '[BOQ_Rate]': fmtNum(b.RATE, 2) ?? '',
    '[BOQ_Amount]': fmtNum(b.AMOUNT, 2) ?? '',
  }))

  return {
    woId,
    displayNo,
    scalars,
    rows,
    templateId: tpl.TemplateID,
    templateName: tpl.TemplateName,
    templateHtml: tpl.html,
  }
}

/** A complete, printable page: IN4's template, filled, wrapped so a browser
 *  prints it at A4 with the provenance line at the foot. */
export function wrapForPrint(
  body: string,
  meta: { displayNo: string; templateName: string; unresolved: string[]; rows: number },
): string {
  const stamp = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${meta.displayNo}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { margin: 0; font-family: Verdana, Geneva, sans-serif; color: #000; }
  table { border-collapse: collapse; }
  .ct-bar { background:#f1f5f9; border-bottom:1px solid #cbd5e1; padding:8px 12px;
            font: 12px/1.4 system-ui, sans-serif; color:#334155; display:flex;
            gap:12px; align-items:center; flex-wrap:wrap; }
  .ct-bar button { font: 600 12px system-ui, sans-serif; padding:6px 12px; border:0;
                   border-radius:6px; background:#4f46e5; color:#fff; cursor:pointer; }
  .ct-doc { padding: 8px 0; }
  .ct-foot { margin-top:14px; padding-top:8px; border-top:1px solid #cbd5e1;
             font:10px/1.5 system-ui, sans-serif; color:#64748b; }
  .ct-warn { color:#92400e; }
  @media print { .ct-bar { display: none } }
</style></head>
<body>
  <div class="ct-bar">
    <button onclick="window.print()">Print or save as PDF</button>
    <span>${meta.displayNo} · rendered from IN4's own template &ldquo;${meta.templateName}&rdquo;</span>
  </div>
  <div class="ct-doc">${body}</div>
  <div class="ct-foot">
    Rendered by CT Hub from IN4 on ${stamp} · ${meta.rows} BOQ line${meta.rows === 1 ? '' : 's'}.
    IN4 remains the system of record for this order.
    ${meta.unresolved.length > 0
      ? `<br><span class="ct-warn">Blank on this copy because IN4 was not asked for them yet: ${meta.unresolved.join(', ')}</span>`
      : ''}
  </div>
</body></html>`
}
