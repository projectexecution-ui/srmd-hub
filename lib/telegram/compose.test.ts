import { describe, it, expect } from 'vitest'
import { composeTelegram, inr, inrShort, projectLabel, niceName, prefersText, cardKeyboard, SEEN_PREFIX } from './compose'

const ID = 'b68b7d2a-5ae1-4c86-bb26-005d9405f172'
const URL = 'https://ct-hub.vercel.app/cost-control/working-sheets/x'

describe('helpers', () => {
  it('₹ groups the Indian way', () => {
    expect(inr(329220)).toBe('₹3,29,220')
    expect(inr(47210310.898)).toBe('₹4,72,10,311')
    expect(inrShort(186000000)).toBe('₹18.60 Cr')
    expect(inrShort(1010000)).toBe('₹10.10 L')
    expect(inrShort(4550)).toBe('₹4,550')
  })
  it('collapses a project name printed twice', () => {
    expect(projectLabel('NGH C · NGH C')).toBe('NGH C')
    expect(projectLabel('CV4 CV4')).toBe('CV4')
    expect(projectLabel('SRAH · Shrimad Rajchandra Animal Hospital')).toBe('SRAH · Shrimad Rajchandra Animal Hospital')
  })
  it('tames SHOUTING party names and leaves mixed case alone', () => {
    expect(niceName('VEER BALAJI ENTERPRISES')).toBe('Veer Balaji Enterprises')
    expect(niceName('C V INTERIOR')).toBe('C V Interior')
    expect(niceName('Sonal Ceramics')).toBe('Sonal Ceramics')
  })
  it('the daily reminder is text even though it reads like a report', () => {
    expect(prefersText('cc_approval_reminders')).toBe(true)
    expect(prefersText('procurement_digest')).toBe(false)
  })
})

describe('the frame', () => {
  it('why · fact · figure · next · who, then ✓ Seen + open', () => {
    const m = composeTelegram({
      id: ID, type: 'in4_entered', title: 'Entered in IN4 — NGH A', url: URL, role: 'head',
      body: 'NGH A · Hydrant System — the released budget (₹524,895) is now entered in IN4 (ref In4 ERP Entry Done).',
      data: { ref: 'In4 ERP Entry Done', work: 'Hydrant System', amount: 524895, project: 'NGH A' },
    })
    const lines = m.html.split('\n')
    expect(lines[0]).toBe('<i>For your record · Atm Head for NGH A</i>')
    expect(lines[1]).toBe('<b>✅ Entered in IN4</b>')
    expect(lines[2]).toBe('NGH A · Hydrant System')
    expect(lines[3]).toContain('<b>₹5,24,895</b>')
    expect(m.html).toContain('<b>Nothing for you to do. The Work Order can now proceed.</b>')
    expect(m.keyboard[0][0]).toEqual({ text: '✓ Seen', callback_data: `${SEEN_PREFIX}:${ID}` })
    expect(m.keyboard[0][1]).toEqual({ text: 'View working sheet', url: URL })
  })
  it('leaves the Seen button out when there is no notification id', () => {
    const m = composeTelegram({ type: 'in4_entered', title: 't', body: '', url: URL, data: { amount: 1 } })
    expect(m.keyboard[0].map(b => b.text)).toEqual(['View working sheet'])
  })
  it('escapes Telegram HTML in the data', () => {
    const m = composeTelegram({ type: 'comment_mention', title: 'A mentioned you — X', body: '<b>hi</b> & bye', data: { author: 'A <x>', comment: '<b>hi</b> & bye' } })
    expect(m.html).not.toContain('<b>hi</b>')
    expect(m.html).toContain('&lt;b&gt;hi&lt;/b&gt; &amp; bye')
  })
  it('an unknown type still gets the frame around its own title and body', () => {
    const m = composeTelegram({ id: ID, type: 'sr_assigned', title: 'Site entry assigned', body: 'Line one\nLine two', url: URL })
    expect(m.html.split('\n')[0]).toBe('<i>Needs you</i>')
    expect(m.html).toContain('<b>Site entry assigned</b>\nLine one\nLine two')
    const news = composeTelegram({ type: 'cc_estimate_approved', title: 't', body: 'b' })
    expect(news.html.split('\n')[0]).toBe('<i>For your record</i>')
  })
})

describe('approval_pending', () => {
  const data = { note: 'rates verified', work: '905 Fire Extinguisher Etc', amount: 66977, note_by: 'Amit Gala', per_sft: 1, project: 'NGH C · NGH C', category: '09 Fire Fighting Works', raised_by: 'Kantilal K', stage_index: 4, stage_label: 'Trustee release', waiting_days: 5, project_erp_budget: 147021496 }
  it('reads as a budget waiting, not a database event', () => {
    const m = composeTelegram({ id: ID, type: 'approval_pending', title: 'A budget needs your Trustee release', body: 'Amit Gala approved a cc_working_sheet (ph_approved → atm_approved)', url: URL, data, role: 'founder' })
    expect(m.html).not.toContain('cc_working_sheet')
    expect(m.html).toContain('<i>Needs you · Trustee for NGH C</i>')
    expect(m.html).toContain('<b>🟠 Budget waiting for your Trustee release</b>')
    expect(m.html).toContain('NGH C · 905 Fire Extinguisher Etc · <b>₹66,977</b> · ₹1/sft')
    expect(m.html).toContain('Project budget in IN4 ₹14.70 Cr')
    expect(m.html).toContain('Amit Gala: “rates verified”')
    expect(m.html).toContain('<b>Release or return in CT Hub.</b>')
    expect(m.html).toContain('<i>Raised by Kantilal K · waiting 5d</i>')
  })
  it('a return that rides the same event is named as a return', () => {
    const m = composeTelegram({ id: ID, type: 'approval_pending', title: 'A budget needs your sign-off', body: 'Chirag Shah returned a cc_working_sheet (atm_approved → returned)', url: URL, data: { ...data, note: 'Too early to order', note_by: 'Chirag Shah' }, role: 'admin' })
    expect(m.html).toContain('<i>For your record · Admin for NGH C</i>')
    expect(m.html).toContain('<b>🔁 Budget returned by Chirag Shah</b>')
    expect(m.html).toContain('“Too early to order”')
    expect(m.html).toContain('<b>Nothing for you to do. The engineer fixes it and resubmits.</b>')
  })
})

describe('cc_approval_reminders', () => {
  it('groups by project and says how many and how old', () => {
    const m = composeTelegram({ id: ID, type: 'cc_approval_reminders', title: '5 budgets waiting', body: '', url: URL, role: 'founder', data: {
      mine: 5, theirs: 0, count: 5, total: 50263199, items: [
        { days: 24, label: 'Internal Partitions', amount: 1067262, project: 'ABGF', stage: 'atm_approved' },
        { days: 22, label: 'BHP', amount: 1107952, project: 'SRAH', stage: 'atm_approved' },
        { days: 15, label: 'Excavation', amount: 47210311, project: 'NRH', stage: 'atm_approved', escalated: true },
      ] } })
    expect(m.html.split('\n')[0]).toBe('<i>Needs you · 5 budgets, ₹5.03 Cr, oldest 24 days</i>')
    expect(m.html).toContain('<b>ABGF</b> · Internal Partitions ₹10,67,262 · 24d')
    expect(m.html).toContain('<b>NRH</b> · Excavation ₹4,72,10,311 · 15d ⚠')
    expect(m.html).toContain('<b>Approve or return each.</b>')
  })
  it('copied-to-unblock reminders say so', () => {
    const m = composeTelegram({ type: 'cc_approval_reminders', title: '1 budget stuck', body: '', data: { mine: 0, theirs: 1, items: [{ days: 49, label: 'Excavation', amount: 1, project: 'NRH', escalated: true }], total: 1 } })
    expect(m.html).toContain('For your record · 1 budget, ₹1, oldest 49 days')
    expect(m.html).toContain('Stuck with someone else')
  })
})

describe('IN4 watch notices', () => {
  it('indent: drops the "ok" remark IN4 leaves in the field', () => {
    const m = composeTelegram({ id: ID, type: 'in4_indent_verify', title: 'Indent IND/SRASSK/CVR/2026-27/183 is waiting for your approval in IN4', body: '', url: URL, role: 'head',
      data: { kind: 'indent', ref: 'IND/SRASSK/CVR/2026-27/183', who: 'Kalyan Singh', since: '2026-09-24T05:00:00Z', status: 'Verify', what: 'Finishes · 1 item · ok', context: 'for WO/CVR/CV4/9' } })
    expect(m.html).toContain('<b>IND/SRASSK/CVR/2026-27/183</b> · Finishes · 1 item')
    expect(m.html).not.toContain(' ok')
    expect(m.html).toContain('<i>for WO/CVR/CV4/9</i>')
    expect(m.html).toContain('<b>Open IN4 and verify it.</b>')
    expect(m.html).toContain('<i>Reached Verify 24 Sept · raised by Kalyan Singh</i>')
  })
  it('work order: party, value, category, and the description cut short', () => {
    const long = 'Providing skylight with lighting mural, size 2 m × 3 m, using 3-layer PVC fabric with UV print, including fixing with aluminium profile and aluminium LED strip lighting, with 4-year warranty.'
    const m = composeTelegram({ id: ID, type: 'in4_wo_verify', title: 't', body: '', url: URL,
      data: { kind: 'wo', ref: 'WO/SRJT/SRAH/2026-27/45', who: 'Subhash Mahyavanshi', value: 80730, status: 'Verify', contractor: 'C V INTERIOR', context: `Finishes · ${long}` } })
    expect(m.html).toContain('C V Interior · <b>₹80,730</b> · Finishes')
    expect(m.html).not.toContain(long)
    expect(m.html).toContain('…')
    expect(m.keyboard[0][1].text).toBe('Rates vs last paid')
  })
  it('purchase order: the pieces in a sensible order', () => {
    const m = composeTelegram({ type: 'in4_po_verify', title: 't', body: '', data: { kind: 'po', ref: 'DRAFT-PO/1470', supplier: 'SONAL CERAMICS', value: 465993, context: 'for IND/176', status: 'Verify' } })
    expect(m.html).toContain('<b>DRAFT-PO/1470</b>\nSonal Ceramics · <b>₹4,65,993</b>\n<i>for indent IND/176</i>')
  })
  it('material received: first item, count of the rest, units and value', () => {
    const m = composeTelegram({ type: 'in4_grn_received', title: 't', body: '', data: { ref: 'GRN/1', po: 'PO/40', supplier: 'MEHTA TUBES LIMITED', qty: 280, value: 145744, date: '2026-09-25T00:00:00Z', materials: 'COPPER REDUCER ELBOW-22 x 15 MM, COPPER COUPLER-15 MM, 15 MM PLASTIC SADDLE' } })
    expect(m.html).toContain('<b>Copper Reducer Elbow-22 x 15 MM</b> +2 more items')
    expect(m.html).toContain('<b>280 units · ₹1,45,744</b>')
    expect(m.html).toContain('<i>From Mehta Tubes Limited · 25 Sept</i>')
  })
})

describe('the rest', () => {
  it('budget transfer parses the sentence it was given', () => {
    const m = composeTelegram({ type: 'cc_budget_transfer', title: '₹6,590 moved inside 07 Electrical Works · CV4 CV4', body: '₹6,590 moved from 717 Contractor Cost to 704 Fittings in IN4. The total for 07 Electrical Works is unchanged.', role: 'head' })
    expect(m.html).toContain('<i>For your record · Atm Head for CV4</i>')
    expect(m.html).toContain('<b>↔ ₹6,590 moved inside 07 Electrical Works</b>')
    expect(m.html).toContain('717 Contractor Cost → 704 Fittings')
  })
  it('access request names the person', () => {
    const m = composeTelegram({ type: 'access_request', title: 'New access request', body: 'Atmarpit Yash signed in and is awaiting your approval' })
    expect(m.html).toContain('<b>Atmarpit Yash</b>')
  })
  it('material request keeps the deadline and the return note', () => {
    const m = composeTelegram({ type: 'wh_request_raised', title: 'Rq: 22Aug26/004 — Akshay Atmarpit needs your approval', body: '1 item from Yunus Land Store for CV5. Slab Needed by 22 Aug 2026. Some of it must come back.', data: { items: 1, reqNo: 'Rq: 22Aug26/004', store: 'Yunus Land Store', project: 'CV5' } })
    expect(m.html).toContain('<b>1 item</b> from Yunus Land Store · for CV5')
    expect(m.html).toContain('<i>Slab Needed by 22 Aug 2026. Some of it must come back.</i>')
    expect(m.html).toContain('<i>Request 22Aug26/004 · by Akshay Atmarpit</i>')
  })
  it('sanction mismatch makes the gap the loud line', () => {
    const m = composeTelegram({ id: ID, type: 'bills_sanction_mismatch', title: 'x', url: URL, body: 'Sanctioned ₹70,15,501; IN4 says ₹1,24,168. Entered by Akshay Parekh. Open it.', data: { certificate: 'ENP/225', sanctioned: 7015501, in4: 124168, difference: -6891333 } })
    expect(m.html).toContain('<b>₹68,91,333 lower in IN4</b>')
    expect(m.html).toContain('<i>Entered in IN4 by Akshay Parekh</i>')
    expect(m.keyboard[0].map(b => b.text)).toEqual(['Open the sanction'])
  })
  it('bills verdict: the MFP warning goes to the billing desk as "needs you"', () => {
    const body = 'Certificate ENP/SRJT/SRAH/2026-27/237 approved in IN4 by Amit Gala on 12 Oct 2026 14:05.\nIN4 payable ₹80,730 · CT Hub net ₹80,730 · same figure.\n⚠ No MFP instruction in IN4\'s remark (it is blank) — add “MFP AS PER COP INSTRUCTION BY …” before Accounts processes it.'
    const billing = composeTelegram({ type: 'bb_in4_verdict', title: 'C V Interior — IN4 approval matches CT Hub', body, data: { stage: 'ct_billing' }, role: 'billing' })
    expect(billing.html).toContain('<i>Needs you · CT Billing</i>')
    expect(billing.html).toContain('<b>🔴 MFP line missing on the certificate</b>')
    expect(billing.html).toContain('ENP/SRJT/SRAH/2026-27/237 · C V Interior')
    expect(billing.html).toContain('<i>Remark in IN4 is blank</i>')
    expect(billing.html).toContain('<b>Add “MFP AS PER COP INSTRUCTION BY …” on the certificate in IN4 before Accounts processes it.</b>')
    const atm = composeTelegram({ type: 'bb_in4_verdict', title: 'C V Interior — IN4 approval matches CT Hub', body, data: { stage: 'atm_in4' }, role: 'head' })
    expect(atm.html).toContain('<i>For your record · Atm Head</i>')
    expect(atm.html).toContain('<b>✅ IN4 approval matches CT Hub</b>')
    expect(atm.html).toContain('<i>Approved in IN4 by Amit Gala</i>')
  })
  it('mention quotes the comment without the leading @name', () => {
    const m = composeTelegram({ type: 'comment_mention', title: 'Atm Akshay mentioned you — Internal Estimate', body: '@Chirag Shah bhai I have rectified the numbers - pls approve', data: { author: 'Atm Akshay', module: 'Internal Estimate', context: 'NGH A · SW & CP Fittings', comment: '@Chirag Shah bhai I have rectified the numbers - pls approve' } })
    expect(m.html).toContain('<b>💬 Atm Akshay mentioned you</b>')
    expect(m.html).toContain('<i>NGH A · SW &amp; CP Fittings · Internal Estimate</i>')
    expect(m.html).toContain('“bhai I have rectified the numbers - pls approve”')
  })
  it('a trustee return tells the Project Head and Atm Head what comes next', () => {
    const m = composeTelegram({ id: ID, type: 'cc_trustee_returned', title: 'Trustee returned NGHC-905-Q01', body: '', url: URL, role: 'project_head',
      data: { ws_code: 'NGHC-905-Q01', project: 'NGH C', work: '905 Fire Extinguisher Etc', amount: 66977, reason: 'Too early to order', by: 'Chirag Shah', raised_by: 'Kantilal K' } })
    expect(m.html).toContain('<i>For your record · Project Head for NGH C</i>')
    expect(m.html).toContain('<b>🔁 Trustee returned a budget</b>')
    expect(m.html).toContain('NGH C · 905 Fire Extinguisher Etc · <b>₹66,977</b>')
    expect(m.html).toContain('“Too early to order”')
    expect(m.html).toContain('comes back to you for sign-off.</b>')
    expect(m.html).toContain('<i>Returned by Chirag Shah · raised by Kantilal K</i>')
  })
  it('the engineer’s own return notice still works from title and body alone', () => {
    const m = composeTelegram({ type: 'cc_ws_returned', title: 'Working sheet returned · NGHC-905-Q01', body: 'Your working sheet was sent back for changes. Reason: Too early to order.' })
    expect(m.html).toContain('<b>NGHC-905-Q01</b>\n“Too early to order.”')
    expect(m.html).toContain('<b>Fix it and resubmit.</b>')
  })
  it('picture cards get the same Seen + open row', () => {
    expect(cardKeyboard({ id: ID, type: 'procurement_digest', title: '', body: '', url: URL }, 'Open the tracker')).toEqual([[
      { text: '✓ Seen', callback_data: `${SEEN_PREFIX}:${ID}` }, { text: 'Open the tracker', url: URL },
    ]])
  })
})
