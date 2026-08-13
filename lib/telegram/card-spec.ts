// A structured description of a report card — the visual vocabulary shared by
// the HTML emails (header, project chips, colored stat tiles, sectioned lists,
// warning banners). A report generator maps its data to a CardSpec and stores
// it on the notification's `data.card_spec`; the Telegram sender renders it to
// a PNG that mirrors the email. Kept types-only (no server deps) so pure report
// modules can build a spec without pulling the SVG/Resvg renderer.

export type CardTone = 'danger' | 'warn' | 'ok' | 'neutral' | 'brand'

export interface CardStat {
  label: string
  value: string
  sub?: string
  tone?: CardTone
}

export interface CardRow {
  main: string          // bold left text (e.g. the indent no)
  sub?: string          // muted second line (project · category · vendor)
  right?: string        // right-aligned value (e.g. "12d" or "₹18.4 L")
  rightTone?: CardTone
}

export interface CardSection {
  heading: string
  sub?: string
  rows?: CardRow[]
  more?: number
  banner?: { text: string; tone: CardTone }
}

export interface CardSpec {
  brand?: string        // header label after "CT HUB ·" (e.g. "Indent → PO")
  title: string
  chips?: string[]      // e.g. project names
  stats?: CardStat[]    // up to 2 big tiles
  sections?: CardSection[]
  dateLabel?: string
  footer?: string
}
