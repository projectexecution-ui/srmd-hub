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
  /** Tags whose value is IN4's OWN html (the work-order conditions) and is
   *  inserted as markup. Everything else is escaped. Only ever IN4 data,
   *  never anything a CT Hub user typed. */
  rawTags: readonly string[] = [],
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
    const v = value == null || value === '' ? ''
      : rawTags.includes(tag) ? String(value) : escapeHtml(String(value))
    html = html.split(tag).join(v)
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

/** Tags carrying IN4's own html rather than plain text. */
export const RAW_TAGS = ['[Wo_Terms_and_Condititons]'] as const

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
  // IN4 writes 1900-01-01 for "never set". Printing it as a real expiry date
  // on a contract would be worse than leaving the line blank.
  const iso = v instanceof Date ? v.toISOString() : String(v)
  if (iso.startsWith('1900-01-01')) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** A percentage IN4 holds as a number. Null and 0 both mean "none here", and
 *  printing "0 %" on a retention line reads as a decision nobody made. */
function pct(v: unknown): string | null {
  const n = v == null ? NaN : Number(v)
  if (!Number.isFinite(n) || n === 0) return null
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`
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
    SELECT w.ID, w.DISPLAY_NO, w.WORK_DESCRIPTION, w.FROM_DT, w.TO_DT,
           w.WORK_ORDER_VALUE, w.WO_GROSS_VALUE, w.CREATION_DT, w.WO_PRINT_DATE,
           w.RETENTION_PCT, w.DISCOUNT_PCT, w.DISCOUNT_AMT, w.LABOUR_LICENSE_EXPIRY_DT,
           w.CONTACT_DETAILS,
           sp.FIRM_NAME contractor, sp.PAN_NO contractor_pan, sp.GSTIN_NO contractor_gstin,
           sp.CONTACT_PERSON cp_name, sp.CONTACT_DETAILS cp_contact,
           a.ADDR addr, a.PIN pin, a.OFF_PHONE off_phone, a.MOBILE mobile, a.EMAIL email,
           l.NAME city, st.NAME state,
           sk.NAME work_category,
           prj.NAME project, sub.SUBPROJECT_NAME subproject,
           co.CompanyName company, co.CompanyCode company_code, co.CompanyPrintName company_print,
           co.CompanyAddress1 co_addr1, co.CompanyAddress2 co_addr2, co.CompanyPinCode co_pin,
           co.PrintAddress1 co_paddr1, co.PrintAddress2 co_paddr2, co.PrintPinCode co_ppin,
           co.PANNumber co_pan, cl.NAME co_city, cst.NAME co_state, gst.GSTIN_NO co_gstin
    FROM ENGG_WORK_ORDER w
    LEFT JOIN ENGG_SERVICE_PROVIDER sp ON sp.ID = w.SERVICE_PROVIDER_ID
    LEFT JOIN COMMON_ADDRESS a ON a.ID = sp.ADDR_ID
    LEFT JOIN COMMON_LOCATION_LOOKUP l ON l.ID = a.LOCATION_ID
    LEFT JOIN COMMON_STATE_LOOKUP st ON st.ID = a.STATE_ID
    LEFT JOIN ENGG_SKILLS_LOOKUP sk ON sk.ID = w.SKILL_ID
    LEFT JOIN ENGG_PROJECT prj ON prj.ID = w.PROJECT_ID
    LEFT JOIN ENGG_SUBPROJECT sub ON sub.ID = w.SUBPROJECT_ID
    LEFT JOIN COMMON.TBLCOMMONCOMPANY co ON co.CompanyID = w.PAYING_CO_ID
    LEFT JOIN COMMON_LOCATION_LOOKUP cl ON cl.ID = co.LocationID
    LEFT JOIN COMMON_STATE_LOOKUP cst ON cst.ID = co.StateID
    -- One company can hold a GSTIN per state; take the one for its own state.
    OUTER APPLY (SELECT TOP 1 g.GSTIN_NO FROM FIN_COMPANY_GSTIN_LOOKUP g
                 WHERE g.COMPANY_ID = co.CompanyID
                 ORDER BY CASE WHEN g.STATE_ID = co.StateID THEN 0 ELSE 1 END, g.ID) gst
    WHERE w.ID = ${woId}`)
  if (!wo) throw new Error(`IN4 has no work order with id ${woId}.`)

  // IN4's own printed BOQ block for this order.
  const boq = await in4Query<Record<string, unknown>>(`
    SELECT SLNO, CATEGORY, SUBCATEGORY, NAME, DESCRIPTION, ITEM_CODE, UNIT, QUANTITY, RATE, AMOUNT, NOTES
    FROM ENGG_WO_BOQ_PRINT_DETAILS WHERE WORK_ORDER_ID = ${woId}
    ORDER BY TRY_CAST(SLNO AS float), SLNO`)

  // The contract conditions. The header's own TERMS_CONDITIONS column is
  // EMPTY on the orders checked — WO 623 has 0 characters there and 16,379
  // across ten rows of this table. Reading the header column alone printed a
  // work order with no terms on it at all.
  const conds = await in4Query<Record<string, unknown>>(`
    SELECT c.CONDITION_ID, CAST(c.CONDITIONS AS nvarchar(MAX)) html
    FROM ENGG_WORK_ORDER_TERMS_AND_CONDITION c
    WHERE c.WORK_ORDER_ID = ${woId} AND LEN(CAST(c.CONDITIONS AS nvarchar(MAX))) > 0
    ORDER BY c.ID`)

  const displayNo = String(wo.DISPLAY_NO ?? `WO ${woId}`)
  const str = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())

  const scalars: Record<string, string | null> = {
    // The order
    '[Work order No]': displayNo,
    '[Work Order Cost]': fmtMoney(wo.WORK_ORDER_VALUE),
    '[Work Order Gross Value]': fmtMoney(wo.WO_GROSS_VALUE),
    '[From Date ]': fmtDate(wo.FROM_DT),
    '[To Date]': fmtDate(wo.TO_DT),
    '[Work Description]': str(wo.WORK_DESCRIPTION),
    '[Scope of Work]': str(wo.WORK_DESCRIPTION),
    '[Work Category]': str(wo.work_category),
    '[Work Order Date]': fmtDate(wo.WO_PRINT_DATE) ?? fmtDate(wo.CREATION_DT),
    '[Expiry Date]': fmtDate(wo.LABOUR_LICENSE_EXPIRY_DT),
    '[Retention Percentage]': pct(wo.RETENTION_PCT),
    '[Discount Percentage]': pct(wo.DISCOUNT_PCT),
    '[Discount Amount]': fmtMoney(wo.DISCOUNT_AMT),
    '[Project]': str(wo.project),
    '[Sub Project]': str(wo.subproject),
    // IN4's own markup, inserted raw. Each condition becomes its own block so
    // ten of them do not run together into one wall of text.
    '[Wo_Terms_and_Condititons]': conds.length
      ? conds.map(c => `<div style="margin:0 0 10px">${String(c.html ?? '')}</div>`).join('')
      : null,

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
    '[COMPANYPAN_NO]': str(wo.co_pan),
    '[GSTNo_SRM]': str(wo.co_gstin),
    '[COMPANYADDRESS1]': str(wo.co_addr1) ?? str(wo.co_paddr1),
    '[COMPANYADDRESS2]': str(wo.co_addr2) ?? str(wo.co_paddr2),
    '[COMPANY_PRINT_ADDRESS1]': str(wo.co_paddr1) ?? str(wo.co_addr1),
    '[COMPANY_PRINT_ADDRESS2]': str(wo.co_paddr2) ?? str(wo.co_addr2),
    '[COMPANYPINCODE]': str(wo.co_pin) ?? str(wo.co_ppin),
    '[COMPANYCITYNAME]': str(wo.co_city),
    '[COMPANYSTATENAME]': str(wo.co_state),
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
  /* Tight but not cramped: IN4 sets the document, this only sets the page. */
  @page { size: A4 portrait; margin: 10mm 8mm; }
  body { margin: 0; font-family: Verdana, Geneva, sans-serif; color: #000; font-size: 11px; }

  /* THE COLOUR PROBLEM. A browser drops every background fill when it prints
     unless the page asks for them, so IN4's shaded header bands and banner
     came out plain white on paper while looking right on screen. This is what
     keeps them. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  /* IN4's template is one wide table per block. Let a long BOQ table break
     across pages, but never mid-row, and never leave a header stranded at the
     foot of a page. Without this a 22-line order spread over 14 pages. */
  table { border-collapse: collapse; width: 100% !important; max-width: 100% !important; }
  td, th { vertical-align: top; padding: 2px 4px; word-break: break-word; }
  tr, td, th { page-break-inside: avoid; break-inside: avoid; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  img { max-width: 100%; height: auto; }
  p { margin: 4px 0; }
  ol, ul { margin: 4px 0 4px 18px; padding: 0; }
  li { margin: 2px 0; }

  .ct-bar { background:#f1f5f9; border-bottom:1px solid #cbd5e1; padding:8px 12px;
            font: 12px/1.4 system-ui, sans-serif; color:#334155; display:flex;
            gap:12px; align-items:center; flex-wrap:wrap; }
  .ct-bar button { font: 600 12px system-ui, sans-serif; padding:6px 12px; border:0;
                   border-radius:6px; background:#4f46e5; color:#fff; cursor:pointer; }
  .ct-bar .hint { color:#64748b; font-size:11px; }
  .ct-doc { padding: 4px 0; }
  .ct-foot { margin-top:12px; padding-top:6px; border-top:1px solid #cbd5e1;
             font:9px/1.45 system-ui, sans-serif; color:#64748b; }
  .ct-warn { color:#92400e; }
  @media print { .ct-bar { display: none } body { font-size: 10px } }
</style></head>
<body>
  <div class="ct-bar">
    <button onclick="window.print()">Print or save as PDF</button>
    <span>${meta.displayNo} · rendered from IN4's own template &ldquo;${meta.templateName}&rdquo;</span>
    <!-- The two settings CSS cannot reach. Without "Background graphics" a
         browser prints every shaded band white, which is why the first copy
         came out colourless; "Headers and footers" is what puts the date and
         the URL on a document that should carry neither. -->
    <span class="hint">In the print dialogue: turn ON &ldquo;Background graphics&rdquo;, turn OFF &ldquo;Headers and footers&rdquo;.</span>
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
