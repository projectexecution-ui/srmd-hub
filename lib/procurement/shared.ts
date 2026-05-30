// Shared helpers used by both parsers.

export function simplifyBlock(sp: string): string {
  if (!sp) return ''
  if (sp.includes('New Guest House B')) return 'NGH – Block B'
  if (sp.includes('New Guest House A')) return 'NGH – Block A'
  if (sp.includes('New Guest House C')) return 'NGH – Block C'
  if (sp.includes('Infra Work')) return 'NGH – Infra'
  if (sp.includes('Design')) return 'NGH – Design'
  if (sp.includes('Common')) return 'NGH – Common'
  if (sp.includes('SRAH')) return 'SRAH'
  if (sp.includes('Raj Uphaar') || sp.includes('RU')) return 'Raj Uphaar'
  if (sp.includes('Admin Block')) return 'Admin Block'
  if (sp.includes('Prem Parking')) return 'Prem Parking'
  if (sp.includes('CFB')) return 'CFB'
  if (sp.includes('Staff Facilities')) return 'Staff Facilities'
  return sp.slice(0, 28)
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
