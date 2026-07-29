import { describe, it, expect } from 'vitest'
import {
  buildBoqTemplateModel,
  buildMetaSheet,
  readMetaFromAoa,
  isBoqTemplateMeta,
  boqTemplateFilename,
  BOQ_COLS,
  BOQ_UNITS,
  BOQ_TEMPLATE_MARKER,
  BOQ_SHEET,
  BOQ_META_SHEET,
  BOQ_MEASURE_SHEET,
} from './boq-template'

describe('buildBoqTemplateModel — shape', () => {
  const m = buildBoqTemplateModel({ blankRows: 10 })
  const boq = m.sheets.find(s => s.name === BOQ_SHEET)!

  it('produces a visible BOQ + a visible Measurement tab + a very-hidden _meta sheet', () => {
    expect(m.sheets).toHaveLength(3)
    expect(boq.visibility).toBe('')
    const measure = m.sheets.find(s => s.name === BOQ_MEASURE_SHEET)!
    expect(measure.visibility).toBe('')
    const meta = m.sheets.find(s => s.name === BOQ_META_SHEET)!
    expect(meta.visibility).toBe('veryHidden')
  })

  it('withMeasurement:false drops the tab and keeps Qty empty + Amount = Qty*Rate (legacy)', () => {
    const lm = buildBoqTemplateModel({ blankRows: 10, withMeasurement: false })
    expect(lm.sheets).toHaveLength(2)
    const lboq = lm.sheets.find(s => s.name === BOQ_SHEET)!
    expect(lboq.cells[`D${lm.itemRowStart}`]).toBeUndefined()
    expect(lboq.cells[`I${lm.itemRowStart}`]?.f).toBe(`D${lm.itemRowStart}*H${lm.itemRowStart}`)
  })

  it('header row carries the fixed column order A..J', () => {
    BOQ_COLS.forEach((name, c) => {
      const cell = boq.cells[`${String.fromCharCode(65 + c)}${m.headerRow}`]
      expect(cell?.v).toBe(name)
    })
  })

  it('Rate is SUM(Material:M+L) and Amount is Qty*Rate on every item row', () => {
    for (let r = m.itemRowStart; r <= m.itemRowEnd; r++) {
      expect(boq.cells[`H${r}`]?.f).toBe(`SUM(E${r}:G${r})`)
      expect(boq.cells[`I${r}`]?.f).toBe(`D${r}*H${r}`)
    }
  })

  it('item rows leave Qty and the three rate cells empty — the engineer fills Qty (number / formula / link)', () => {
    for (let r = m.itemRowStart; r <= m.itemRowEnd; r++) {
      expect(boq.cells[`D${r}`]).toBeUndefined() // Qty
      expect(boq.cells[`E${r}`]).toBeUndefined() // Material
      expect(boq.cells[`F${r}`]).toBeUndefined() // Installation
      expect(boq.cells[`G${r}`]).toBeUndefined() // M+L
    }
  })

  it('the rule note explains the three ways to fill Qty', () => {
    const note = String(boq.cells['A3']?.v ?? '')
    expect(note).toMatch(/ESTIMATE/i)
    expect(note).toMatch(/=946\+104\.5/)
    expect(note).toMatch(/Measurement!G7/)
  })

  it('Measurement tab: Qty auto-computes Nos × (L|1) × (B|1) × (H|1), blank Nos ⇒ ""', () => {
    const measure = m.sheets.find(s => s.name === BOQ_MEASURE_SHEET)!
    for (let r = m.itemRowStart; r <= m.itemRowEnd; r++) {
      expect(measure.cells[`G${r}`]?.f)
        .toBe(`IF(C${r}="","",C${r}*IF(D${r}="",1,D${r})*IF(E${r}="",1,E${r})*IF(F${r}="",1,F${r}))`)
    }
  })

  it('totals ladder: subtotal → contingency → gst → grand total, all formulas', () => {
    expect(boq.cells[`I${m.subtotalRow}`]?.f).toBe(`SUM(I${m.itemRowStart}:I${m.itemRowEnd})`)
    expect(boq.cells[`I${m.contingencyRow}`]?.f)
      .toBe(`ROUND(I${m.subtotalRow}*H${m.contingencyRow}/100,0)`)
    expect(boq.cells[`I${m.gstRow}`]?.f)
      .toBe(`ROUND((I${m.subtotalRow}+I${m.contingencyRow})*H${m.gstRow}/100,0)`)
    expect(boq.cells[`I${m.grandTotalRow}`]?.f)
      .toBe(`I${m.subtotalRow}+I${m.contingencyRow}+I${m.gstRow}`)
  })

  it('pre-fills 5% contingency and 18% GST in the Rate column', () => {
    expect(boq.cells[`H${m.contingencyRow}`]?.v).toBe(5)
    expect(boq.cells[`H${m.gstRow}`]?.v).toBe(18)
  })

  it('the rule note mentions the M+L guard and lists the units', () => {
    const note = String(boq.cells['A3']?.v ?? '')
    expect(note).toMatch(/never both/i)
    expect(note).toContain('LS')
    BOQ_UNITS.forEach(u => expect(note).toContain(u))
  })

  it('blankRows is respected and floored at 5', () => {
    expect(buildBoqTemplateModel({ blankRows: 40 }).itemRowEnd
      - buildBoqTemplateModel({ blankRows: 40 }).itemRowStart + 1).toBe(40)
    const tiny = buildBoqTemplateModel({ blankRows: 1 })
    expect(tiny.itemRowEnd - tiny.itemRowStart + 1).toBe(5)
  })
})

describe('meta sheet round-trip', () => {
  it('embeds the marker + ids and reads back via AoA', () => {
    const meta = buildMetaSheet({
      projectId: 'p1', disciplineId: 'd1', subSkillId: 'ss1',
      projectCode: 'NGH', disciplineCode: '03', subSkillCode: '301',
    })
    // Reconstruct an AoA from the meta cells (A/B columns).
    const aoa: unknown[][] = []
    for (let r = 1; r <= meta.lastRow; r++) {
      aoa.push([meta.cells[`A${r}`]?.v ?? null, meta.cells[`B${r}`]?.v ?? null])
    }
    const map = readMetaFromAoa(aoa)
    expect(isBoqTemplateMeta(map)).toBe(true)
    expect(map.marker).toBe(BOQ_TEMPLATE_MARKER)
    expect(map.project_id).toBe('p1')
    expect(map.discipline_id).toBe('d1')
    expect(map.sub_skill_id).toBe('ss1')
  })

  it('isBoqTemplateMeta rejects a foreign / empty workbook', () => {
    expect(isBoqTemplateMeta({})).toBe(false)
    expect(isBoqTemplateMeta({ marker: 'something-else' })).toBe(false)
  })
})

describe('context header + filename', () => {
  it('context line reflects supplied project / raiser / date', () => {
    const m = buildBoqTemplateModel({
      projectCode: 'NGH', projectName: 'A Block', raisedBy: 'Ramesh', dateText: '2-Jun-2026',
    })
    const boq = m.sheets.find(s => s.name === BOQ_SHEET)!
    const ctx = String(boq.cells['A2']?.v ?? '')
    expect(ctx).toContain('NGH A Block')
    expect(ctx).toContain('Ramesh')
    expect(ctx).toContain('2-Jun-2026')
  })

  it('filename carries project, discipline, sub-skill, version + date and is filesystem-safe', () => {
    const fn = boqTemplateFilename({
      projectName: 'NGH A',
      disciplineCode: '03', disciplineName: 'Civil',
      subSkillCode: '301/A', subSkillName: 'Footings',
      versionNo: 2,
      dateText: '29 Jul 2026',
    })
    expect(fn).toMatch(/^BOQ_/)
    expect(fn).toContain('NGH-A')        // exact project name
    expect(fn).toContain('03-Civil')     // discipline code + name
    expect(fn).toContain('301-A')        // sub-skill (slash sanitized)
    expect(fn).toContain('_v2_')         // version stamp
    expect(fn).toContain('29-Jul-2026')  // download date
    expect(fn.endsWith('.xlsx')).toBe(true)
    expect(fn).not.toMatch(/[/\\]/)      // filesystem-safe: no slashes
  })

  it('filename defaults to v1 when no prior version is given', () => {
    const fn = boqTemplateFilename({ projectName: 'VINAY', subSkillName: 'Plumbing' })
    expect(fn).toContain('_v1')
    expect(fn.endsWith('.xlsx')).toBe(true)
  })
})
