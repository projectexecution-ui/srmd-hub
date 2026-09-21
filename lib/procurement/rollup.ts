// Shared rollup logic — both parsers emit LineRecord[], this collapses
// them into IndentRollup[], VendorRollup[], ProjectSummary[].

import type {
  LineRecord, IndentRollup, VendorRollup, ProjectSummary, IndentStatus,
} from './types'

export function buildProjectSummaries(lines: LineRecord[]): ProjectSummary[] {
  // ─── Per-indent rollups ─────────────────────────────────────────
  const byIndent = new Map<string, IndentRollup>()
  for (const ln of lines) {
    let rollup = byIndent.get(ln.indentNo)
    if (!rollup) {
      rollup = {
        indentNo: ln.indentNo,
        indentDate: ln.indentDate,
        block: ln.block,
        project: ln.project,
        subProject: ln.subProject,
        lineIds: [],
        totalLines: 0,
        linesWithPo: 0,
        linesReceived: 0,
        linesPartial: 0,
        linesPending: 0,
        linesNoPo: 0,
        linesInvoiced: 0,
        pendingValue: 0,
        grnValue: 0,
        invoiceAmount: 0,
        worstAgeDays: ln.indentAgeDays,
        suppliers: [],
        poNos: [],
        status: 'Indent Only – No PO',
      }
      byIndent.set(ln.indentNo, rollup)
    }
    rollup.lineIds.push(ln.id)
    rollup.totalLines++
    if (ln.pos.length > 0) rollup.linesWithPo++
    if (ln.status === 'received') rollup.linesReceived++
    else if (ln.status === 'partial') rollup.linesPartial++
    else if (ln.status === 'pending') rollup.linesPending++
    else rollup.linesNoPo++
    if (ln.invoices.length > 0) rollup.linesInvoiced++
    rollup.pendingValue += ln.pendingValue
    rollup.grnValue += ln.grnValue
    rollup.invoiceAmount += ln.invoiceAmount
    if (ln.indentAgeDays != null) {
      rollup.worstAgeDays = Math.max(rollup.worstAgeDays ?? -Infinity, ln.indentAgeDays)
    }
    for (const po of ln.pos) {
      if (po.supplier && !rollup.suppliers.includes(po.supplier)) rollup.suppliers.push(po.supplier)
      if (po.poNo && !rollup.poNos.includes(po.poNo)) rollup.poNos.push(po.poNo)
    }
  }
  for (const r of byIndent.values()) {
    if (r.worstAgeDays === -Infinity) r.worstAgeDays = null
    if (r.linesWithPo === 0) r.status = 'Indent Only – No PO' as IndentStatus
    else if (r.linesReceived === r.totalLines) r.status = 'PO Done & GRN Received' as IndentStatus
    else r.status = 'PO Raised – GRN Pending' as IndentStatus
  }

  // ─── Per-project summaries ──────────────────────────────────────
  const byProject = new Map<string, ProjectSummary>()
  const lineById = new Map(lines.map(l => [l.id, l] as const))

  for (const rollup of byIndent.values()) {
    const key = rollup.project || 'Unknown'
    let p = byProject.get(key)
    if (!p) {
      p = {
        projectName: key,
        total: 0,
        poDoneGrnReceived: 0,
        poRaisedGrnPending: 0,
        indentOnlyNoPo: 0,
        totalGrnValue: 0,
        totalPoValue: 0,
        pendingValue: 0,
        pendingLineCount: 0,
        totalInvoiceAmount: 0,
        pendingInvoiceValue: 0,
        oldestPendingPo: null,
        biggestPendingLine: null,
        biggestPendingInvoice: null,
        worstVendor: null,
        byDiscipline: {},
        topVendors: [],
        lines: [],
        indents: [],
      }
      byProject.set(key, p)
    }
    p.total++
    if (rollup.status === 'PO Done & GRN Received') p.poDoneGrnReceived++
    else if (rollup.status === 'PO Raised – GRN Pending') p.poRaisedGrnPending++
    else p.indentOnlyNoPo++
    p.indents.push(rollup)
  }

  for (const p of byProject.values()) {
    for (const rollup of p.indents) {
      for (const id of rollup.lineIds) {
        const ln = lineById.get(id)
        if (ln) p.lines.push(ln)
      }
    }
    // Only compute invoice-pending math when the report actually carries
    // invoice data — banded reports don't, and treating "grnValue >
    // invoiceAmount (zero)" as a gap would wrongly flag every received
    // line as un-invoiced.
    const reportHasInvoiceData = p.lines.some(l => l.invoices.length > 0)
    let totalPo = 0
    for (const ln of p.lines) {
      p.totalGrnValue += ln.grnValue
      p.pendingValue += ln.pendingValue
      p.totalInvoiceAmount += ln.invoiceAmount
      if (reportHasInvoiceData && ln.grnValue > ln.invoiceAmount + 0.01) {
        p.pendingInvoiceValue += (ln.grnValue - ln.invoiceAmount)
      }
      if (ln.pendingQty > 0) p.pendingLineCount++
      const rate = ln.pos[0]?.rate ?? 0
      if (ln.orderedQty && rate) totalPo += ln.orderedQty * rate
      const d = ln.discipline
      if (!p.byDiscipline[d]) p.byDiscipline[d] = { total: 0, done: 0, pending: 0, noPo: 0 }
      p.byDiscipline[d].total++
      if (ln.status === 'received') p.byDiscipline[d].done++
      else if (ln.status === 'no_po') p.byDiscipline[d].noPo++
      else p.byDiscipline[d].pending++
    }
    p.totalPoValue = totalPo

    p.oldestPendingPo = p.indents
      .filter(r => r.linesNoPo > 0 && r.worstAgeDays != null)
      .sort((a, b) => (b.worstAgeDays ?? 0) - (a.worstAgeDays ?? 0))[0] ?? null

    p.biggestPendingLine = p.lines
      .filter(ln => ln.pendingQty > 0 && ln.pendingValue > 0)
      .sort((a, b) => b.pendingValue - a.pendingValue)[0] ?? null

    p.biggestPendingInvoice = reportHasInvoiceData
      ? (p.lines
          .filter(ln => ln.grnValue > ln.invoiceAmount + 0.01)
          .map(ln => ({ ln, gap: ln.grnValue - ln.invoiceAmount }))
          .sort((a, b) => b.gap - a.gap)[0]?.ln ?? null)
      : null

    // ─── Vendor rollup (with avg lag + on-time %) ────────────────
    const vendorMap = new Map<string, VendorRollup>()
    const vendorLags = new Map<string, { sum: number; count: number; onTime: number }>()
    for (const ln of p.lines) {
      for (const po of ln.pos) {
        if (!po.supplier) continue
        let v = vendorMap.get(po.supplier)
        if (!v) {
          v = {
            name: po.supplier, indents: 0, poValue: 0, pendingValue: 0,
            pendingLines: 0, overdueLines: 0, receivedLines: 0,
            avgLagDays: null, onTimePct: null, invoiceAmount: 0,
          }
          vendorMap.set(po.supplier, v)
        }
        v.poValue += po.qty * (po.rate || 0)
      }
      if (ln.supplier) {
        const v = vendorMap.get(ln.supplier)
        if (v) {
          v.indents++
          v.invoiceAmount += ln.invoiceAmount
          if (ln.pendingQty > 0) {
            v.pendingLines++
            v.pendingValue += ln.pendingValue
            if ((ln.oldestPoAgeDays ?? 0) >= 7) v.overdueLines++
          }
          if (ln.status === 'received') {
            v.receivedLines++
            // Tally lag stats: avg lag from po -> grn for this received line.
            if (ln.avgGrnLagDays != null) {
              let agg = vendorLags.get(ln.supplier)
              if (!agg) { agg = { sum: 0, count: 0, onTime: 0 }; vendorLags.set(ln.supplier, agg) }
              agg.sum += ln.avgGrnLagDays
              agg.count++
              if (ln.avgGrnLagDays <= 14) agg.onTime++
            }
          }
        }
      }
    }
    for (const [name, agg] of vendorLags.entries()) {
      const v = vendorMap.get(name)
      if (!v || agg.count === 0) continue
      v.avgLagDays = Math.round(agg.sum / agg.count)
      v.onTimePct = Math.round((agg.onTime / agg.count) * 100)
    }

    p.topVendors = Array.from(vendorMap.values())
      .sort((a, b) => (b.pendingValue + b.poValue * 0.05) - (a.pendingValue + a.poValue * 0.05))
      .slice(0, 8)
    p.worstVendor = Array.from(vendorMap.values())
      .filter(v => v.overdueLines > 0)
      .sort((a, b) => b.overdueLines - a.overdueLines || b.pendingValue - a.pendingValue)[0] ?? null
  }

  return Array.from(byProject.values()).sort((a, b) => b.total - a.total)
}
