import { describe, it, expect } from 'vitest'
import { parseSourceRef } from './formula-ref'

describe('parseSourceRef', () => {
  it('cross-sheet reference', () => {
    expect(parseSourceRef('=Measurement!D11')).toEqual({ sheet: 'Measurement', cell: 'D11' })
  })
  it('quoted sheet name with spaces + absolute refs', () => {
    expect(parseSourceRef("='Take Off'!$D$11")).toEqual({ sheet: 'Take Off', cell: 'D11' })
  })
  it('same-sheet formula → no sheet, first cell', () => {
    expect(parseSourceRef('=D11*H11')).toEqual({ sheet: null, cell: 'D11' })
  })
  it('SUM range → first cell', () => {
    expect(parseSourceRef('=SUM(E6:G6)')).toEqual({ sheet: null, cell: 'E6' })
  })
  it('empty / null → nulls', () => {
    expect(parseSourceRef(null)).toEqual({ sheet: null, cell: null })
    expect(parseSourceRef('')).toEqual({ sheet: null, cell: null })
    expect(parseSourceRef('=42')).toEqual({ sheet: null, cell: null })
  })
})
