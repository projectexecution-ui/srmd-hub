import { describe, it, expect } from 'vitest'
import { renderTemplate, wrapForPrint, BOQ_ROW_TAGS } from './wo-print'

// Cut down from IN4's real template 109: a header line, the BOQ table with its
// ONE repeating row, and a footer. The row markup is exactly as IN4 writes it.
const TPL = `<p>Work Order [Work order No] dated [Work Order Date]</p>
<p>[Contractor Firm] &mdash; PAN [Contractor PAN]</p>
<table border="1">
  <tbody>
    <tr>
      <td style="text-align:center"><strong>BOQ Name</strong></td>
      <td style="text-align:center"><strong>BOQ Details</strong></td>
      <td style="text-align:center"><strong>Quantity</strong></td>
      <td style="text-align:center"><strong>Unit</strong></td>
      <td style="text-align:center"><strong>Rate</strong></td>
      <td style="text-align:center"><strong>Amount</strong></td>
    </tr>
    <tr>
      <td style="text-align:justify; width:25%">[BOQ_Name]</td>
      <td style="text-align:justify">[BOQ_Description]</td>
      <td style="text-align:right">[BOQQty]</td>
      <td style="text-align:center">[BOQ_Unit]</td>
      <td style="text-align:right">[BOQ_Rate]</td>
      <td style="text-align:right">[BOQ_Amount]</td>
    </tr>
  </tbody>
</table>
<p>Total [Work Order Cost]</p>`

const row = (o: Partial<Record<(typeof BOQ_ROW_TAGS)[number], string>>) => ({
  '[BOQ_Name]': '', '[BOQ_Description]': '', '[BOQQty]': '',
  '[BOQ_Unit]': '', '[BOQ_Rate]': '', '[BOQ_Amount]': '', ...o,
})

describe('renderTemplate — filling IN4’s own template', () => {
  it('substitutes the scalar tags', () => {
    const r = renderTemplate(TPL, {
      '[Work order No]': 'WO/SRASSK/NGH/2026-27/104',
      '[Contractor Firm]': 'ACME Constructions',
      '[Work Order Cost]': '29,32,934',
    }, [])
    expect(r.html).toContain('WO/SRASSK/NGH/2026-27/104')
    expect(r.html).toContain('ACME Constructions')
    expect(r.html).toContain('29,32,934')
  })

  it('REPEATS the BOQ row once per line, keeping IN4’s own cell markup', () => {
    const r = renderTemplate(TPL, {}, [
      row({ '[BOQ_Name]': 'Waterproofing', '[BOQQty]': '127.589', '[BOQ_Unit]': 'SqM', '[BOQ_Amount]': '2,04,142' }),
      row({ '[BOQ_Name]': 'Kota stone', '[BOQQty]': '40', '[BOQ_Unit]': 'SqM', '[BOQ_Amount]': '64,000' }),
      row({ '[BOQ_Name]': 'Plaster', '[BOQQty]': '12', '[BOQ_Unit]': 'SqM', '[BOQ_Amount]': '9,000' }),
    ])
    expect(r.rows).toBe(3)
    expect(r.html).toContain('Waterproofing')
    expect(r.html).toContain('Kota stone')
    expect(r.html).toContain('Plaster')
    // The header row survives; the data row is now three rows.
    expect(r.html.match(/<tr>/g)?.length).toBe(4)
    // And the styling IN4 wrote is still on each cell.
    expect(r.html.match(/text-align:justify; width:25%/g)?.length).toBe(3)
  })

  it('collapses the row block on an order with no BOQ lines — no phantom row', () => {
    const r = renderTemplate(TPL, {}, [])
    expect(r.rows).toBe(0)
    expect(r.html).not.toContain('[BOQ_Name]')
    // Header row only.
    expect(r.html.match(/<tr>/g)?.length).toBe(1)
  })

  it('REPORTS every tag it could not fill, and leaves it blank', () => {
    // The whole point: a printed page with a silent hole is worse than one
    // that says which fields nobody supplied.
    const r = renderTemplate(TPL, { '[Work order No]': 'WO/1' }, [])
    expect(r.unresolved).toContain('[Work Order Date]')
    expect(r.unresolved).toContain('[Contractor Firm]')
    expect(r.unresolved).toContain('[Contractor PAN]')
    expect(r.unresolved).not.toContain('[Work order No]')
    // Row tags are not "unresolved" — they are handled by the row block.
    for (const t of BOQ_ROW_TAGS) expect(r.unresolved).not.toContain(t)
    // Nothing is left showing a raw tag.
    expect(r.html).not.toMatch(/\[[A-Za-z0-9_.\- ]+\]/)
  })

  it('treats null and empty string as "not supplied" but does not report them twice', () => {
    const r = renderTemplate(TPL, {
      '[Work order No]': 'WO/1', '[Contractor Firm]': null, '[Contractor PAN]': '',
    }, [])
    expect(r.html).not.toContain('[Contractor Firm]')
    // They WERE supplied, deliberately blank, so they are not flagged as gaps.
    expect(r.unresolved).not.toContain('[Contractor Firm]')
    expect(r.unresolved).not.toContain('[Contractor PAN]')
  })

  it('ESCAPES values — a contractor name with an ampersand cannot break the page', () => {
    const r = renderTemplate(TPL, { '[Contractor Firm]': 'Shah & Sons <Pvt> "Ltd"' }, [])
    expect(r.html).toContain('Shah &amp; Sons &lt;Pvt&gt; &quot;Ltd&quot;')
    expect(r.html).not.toContain('<Pvt>')
  })

  it('escapes inside repeated rows too', () => {
    const r = renderTemplate(TPL, {}, [row({ '[BOQ_Description]': 'M20 <grade> & above' })])
    expect(r.html).toContain('M20 &lt;grade&gt; &amp; above')
  })

  it('leaves the template alone when the row markup is not a table row', () => {
    // Defensive: if IN4 ever restructures the template, do not mangle it.
    const odd = '<p>[BOQ_Name]</p>'
    const r = renderTemplate(odd, {}, [row({ '[BOQ_Name]': 'X' })])
    expect(r.rows).toBe(0)
    // The tag still gets cleared rather than printed raw.
    expect(r.html).not.toContain('[BOQ_Name]')
  })

  it('inserts a RAW tag as markup — IN4’s conditions are html, not text', () => {
    // The work-order conditions come out of IN4 as html (<strong>, <ol>, <br>).
    // Escaped, a contract prints as visible markup instead of clauses.
    const r = renderTemplate(
      '<div>[Wo_Terms_and_Condititons]</div>',
      { '[Wo_Terms_and_Condititons]': '<strong>Advance Payment:</strong><br>Rs 50,00,000' },
      [], undefined, ['[Wo_Terms_and_Condititons]'],
    )
    expect(r.html).toContain('<strong>Advance Payment:</strong>')
    expect(r.html).not.toContain('&lt;strong&gt;')
  })

  it('leaves IN4’s own square-bracket text inside a raw block alone', () => {
    // WO 623’s conditions contain the literal text "[Link share with mail]" —
    // an unfilled placeholder somebody left in a live contract. It is IN4’s
    // data, so it must print exactly as IN4 would print it rather than being
    // silently swallowed by the tag-clearing pass. Reporting it is a
    // conversation with Aksha, not something to paper over here.
    const r = renderTemplate(
      '<div>[Wo_Terms_and_Condititons]</div>',
      { '[Wo_Terms_and_Condititons]': 'Uploaded to Drive at [Link share with mail].' },
      [], undefined, ['[Wo_Terms_and_Condititons]'],
    )
    expect(r.html).toContain('[Link share with mail]')
    expect(r.unresolved).not.toContain('[Link share with mail]')
  })

  it('does not touch tags the template never asked for', () => {
    const r = renderTemplate('<p>[A]</p>', { '[A]': '1', '[Unused]': '2' }, [])
    expect(r.html).toBe('<p>1</p>')
  })
})

describe('wrapForPrint', () => {
  const meta = { displayNo: 'WO/SRASSK/NGH/2026-27/104', templateName: 'Work Order Medium', unresolved: [], rows: 5 }

  it('names the template it used, so the format is traceable', () => {
    const html = wrapForPrint('<p>doc</p>', meta)
    expect(html).toContain('Work Order Medium')
    expect(html).toContain('WO/SRASSK/NGH/2026-27/104')
  })

  it('says CT Hub rendered it and that IN4 is the record — never passes as the issued order', () => {
    const html = wrapForPrint('<p>doc</p>', meta)
    expect(html).toContain('Rendered by CT Hub from IN4')
    expect(html).toContain('IN4 remains the system of record')
  })

  it('prints A4 portrait and hides its own toolbar on paper', () => {
    const html = wrapForPrint('<p>doc</p>', meta)
    expect(html).toContain('size: A4 portrait')
    expect(html).toMatch(/@media print { .ct-bar { display: none }/)
  })

  it('KEEPS background fills when printed — the colours went white on paper', () => {
    // A browser drops every background fill on print unless the page asks for
    // them, so IN4's shaded bands printed blank while looking right on screen.
    const html = wrapForPrint('<p>doc</p>', meta)
    expect(html).toContain('print-color-adjust: exact')
    expect(html).toContain('-webkit-print-color-adjust: exact')
  })

  it('never breaks a table row across pages, and repeats a table head', () => {
    const html = wrapForPrint('<p>doc</p>', meta)
    expect(html).toContain('page-break-inside: avoid')
    expect(html).toContain('display: table-header-group')
  })

  it('tells the reader the two print-dialogue settings CSS cannot control', () => {
    const html = wrapForPrint('<p>doc</p>', meta)
    expect(html).toContain('Background graphics')
    expect(html).toContain('Headers and footers')
  })

  it('lists unfilled fields on the page itself', () => {
    const html = wrapForPrint('<p>doc</p>', { ...meta, unresolved: ['[GSTNo_SRM]', '[Retention Type]'] })
    expect(html).toContain('[GSTNo_SRM]')
    expect(html).toContain('[Retention Type]')
  })

  it('says nothing about gaps when there are none', () => {
    expect(wrapForPrint('<p>doc</p>', meta)).not.toContain('not asked for them yet')
  })
})
