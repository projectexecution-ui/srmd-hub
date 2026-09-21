// Shared helpers used by both parsers.

/**
 * Map IN4 indent-number project codes to canonical project names.
 * Indent numbers look like `IND/SRASSK/<CODE>/<year>/<num>` and the
 * <CODE> is the one truly reliable signal of which project the indent
 * belongs to — much more reliable than the col 0 site-header forward
 * fill (which leaks the last seen header onto unrelated indents that
 * appear between site bands). The site header is still useful for the
 * `block` / `subProject` granularity, but project grouping should
 * key off this map.
 *
 * Built from a real PURCHINDENT_TO_ISSUE_RPT export. Add codes here
 * if a new project shows up.
 */
const PROJECT_CODE_TO_NAME: Record<string, string> = {
  NGH:   'New Guest House',
  P2ST:  'P2 Stepped Terraces',
  P2I:   'P2 Infra',
  P2RH:  'P2 Row Houses',
  RU:    'Raj Uphaar',
  CVR:   'CV Renovation',
  SQ:    'Staff Facilities Block',
  SRAH:  'SR Animal Hospital',
  WH:    'Warehouse',
  DAE:   'DN Annex Extension',
  DN:    'DN Extension',
  WCRO:  'WC Reg Office',
  AB:    'Admin Block',
  PP:    'Prem Parking',
  CSS:   'Covered Seating Spaces',
  B01:   'Baby Care and Cloak Room',
  OSH:   'Old Swadhyay Hall',
  AIST:  'Ashram Infra (Security Team)',
  AIS:   'Ashram Infra Signage',
  RSM:   'Raj Sabhagruh Museum',
  VVST:  'Vinay Vivek',
}

/**
 * Pull the project code out of an indent number. Returns null when
 * the indent doesn't match the expected `IND/<org>/<code>/...` shape.
 */
export function extractIndentCode(indentNo: string): string | null {
  const m = indentNo.match(/^IND\/[A-Z]+\/([A-Z0-9]+)\//)
  return m ? m[1] : null
}

/**
 * Resolve an indent number to its canonical project name. Falls back
 * to the raw code (uppercase) when we don't have a mapping — the
 * admin can hide it via /procurement-tracker/admin if it's spurious,
 * or it'll just show up as a project named after the code. Returns
 * null only when the indent number is malformed.
 */
export function projectFromIndentNo(indentNo: string): string | null {
  const code = extractIndentCode(indentNo)
  if (!code) return null
  return PROJECT_CODE_TO_NAME[code] ?? code
}

/**
 * Turn an IN4 sub-project / cost-centre string into a short block label.
 *
 * IMPORTANT: the NGH sub-block rules ("Common", "Infra Work", "Design")
 * only apply when the row is ACTUALLY a New Guest House row. Previously
 * those bare word-matches ran globally and hijacked other projects — e.g.
 * Raj Uphaar's own "Raj Uphaar - Common Expenses" cost-centre was stamped
 * "NGH – Common" (≈1,000 rows). The IN4 sub-project always leads with the
 * real project name, so we branch on that first.
 */
export function simplifyBlock(sp: string): string {
  if (!sp) return ''

  // New Guest House — its blocks/cost-centres.
  if (sp.includes('New Guest House') || sp.includes('NGH')) {
    if (sp.includes('New Guest House B')) return 'NGH – Block B'
    if (sp.includes('New Guest House A')) return 'NGH – Block A'
    if (sp.includes('New Guest House C')) return 'NGH – Block C'
    if (sp.includes('Infra Work')) return 'NGH – Infra'
    if (sp.includes('Design')) return 'NGH – Design'
    if (sp.includes('Common')) return 'NGH – Common'
    return 'NGH'
  }

  if (sp.includes('SRAH')) return 'SRAH'

  // Raj Uphaar — keep its own cost-centre granularity.
  if (sp.includes('Raj Uphaar') || sp.includes('RU -') || sp.includes('/RU/')) {
    if (sp.includes('Common')) return 'RU – Common'
    if (sp.includes('Infra')) return 'RU – Infra'
    if (sp.includes('Design')) return 'RU – Design'
    return 'Raj Uphaar'
  }

  if (sp.includes('Admin Block')) return 'Admin Block'
  if (sp.includes('Prem Parking')) return 'Prem Parking'
  if (sp.includes('CFB')) return 'CFB'
  if (sp.includes('Staff Facilities')) return 'Staff Facilities'
  return sp.slice(0, 28)
}

/**
 * Drop the leading `IND/<org>/` from an indent number so the project code,
 * year and running number lead (e.g. `IND/SRET/RU/2023-24/13` → `RU/2023-24/13`).
 * Generic across every org segment (SRET, SRASSK, SRJT, …) so display stays
 * consistent everywhere — use this instead of hard-coded .replace() chains.
 */
export function shortIndent(no: string): string {
  return String(no || '').replace(/^IND\/[A-Z0-9]+\//, '')
}

export function extractDiscipline(material: string): string {
  const m = String(material || '')
  // Banded: "13 (A) Interiors - 1302 (A) Loose Furniture-Bed Wooden Single"
  // Flat  : "13 (A) Interiors-1302 (A) Loose Furniture-Bed Wooden Single."
  // Both prefix with two-digit discipline code + optional (M)/(A).
  const match = m.match(/^(\d{2})\s*(?:\([AM]\))?\s*([^-]+)/)
  if (match) return match[0].replace(/\([AM]\)\s*/g, '').trim().slice(0, 35)
  return 'Other'
}

export function cleanMaterial(raw: string): string {
  if (!raw) return ''
  const parts = String(raw).split('-')
  if (parts.length >= 3) return parts.slice(2).join('-').trim()
  if (parts.length === 2) return parts[1].trim()
  return String(raw).slice(0, 80)
}

export function daysSince(raw: string): number | null {
  if (!raw) return null
  let d: Date | null = null
  const isoMatch = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    d = new Date(raw)
  } else {
    const dmy = String(raw).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (dmy) {
      const day = Number(dmy[1]), mon = Number(dmy[2]) - 1
      let year = Number(dmy[3]); if (year < 100) year += 2000
      d = new Date(year, mon, day)
    } else {
      const parsed = new Date(String(raw))
      if (!isNaN(parsed.getTime())) d = parsed
    }
  }
  if (!d || isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

/** Days between two date strings (later - earlier). Null if either is unparseable. */
export function daysBetween(earlier: string, later: string): number | null {
  if (!earlier || !later) return null
  const parse = (s: string): Date | null => {
    let d: Date | null = null
    const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) d = new Date(s)
    else {
      const dmy = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
      if (dmy) {
        const day = Number(dmy[1]), mon = Number(dmy[2]) - 1
        let year = Number(dmy[3]); if (year < 100) year += 2000
        d = new Date(year, mon, day)
      } else {
        const parsed = new Date(String(s))
        if (!isNaN(parsed.getTime())) d = parsed
      }
    }
    if (!d || isNaN(d.getTime())) return null
    return d
  }
  const a = parse(earlier), b = parse(later)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * Format a day-count into a humans-can-scan-quickly label. We still
 * display the raw day count alongside (so it stays precise — tables
 * are easier to compare in same units) but the "(~2y 3mo)" suffix
 * makes 800d feel less abstract.
 */
export function formatAgeFriendly(days: number | null): { short: string; long: string } {
  if (days == null) return { short: '—', long: '' }
  const absDays = Math.abs(days)
  const sign = days < 0 ? '−' : ''
  if (absDays < 30) return { short: `${sign}${absDays}d`, long: '' }
  if (absDays < 365) {
    const months = Math.round(absDays / 30)
    return { short: `${sign}${absDays}d`, long: `~${months}mo` }
  }
  const years = Math.floor(absDays / 365)
  const remainderMonths = Math.round((absDays % 365) / 30)
  const long = remainderMonths > 0 ? `~${years}y ${remainderMonths}mo` : `~${years}y`
  return { short: `${sign}${absDays}d`, long }
}

export const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export const str = (v: unknown): string => (v == null ? '' : String(v).trim())
