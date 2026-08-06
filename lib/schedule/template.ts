// Standard tower work-item template — applied at setup so a project's schedule
// is pre-populated by trade; the PM then only fills in the quantity per item.
// Modelled on the SRMD NGH progress report's trades + items, with default units.

export interface TemplateItem {
  name: string
  uom: string        // default unit of measure (so setup only needs the number)
  sub?: string
}
export interface TemplateTrade {
  trade: string
  items: TemplateItem[]
}

export const DEFAULT_TEMPLATE: TemplateTrade[] = [
  {
    trade: 'Substructure',
    items: [
      { name: 'Excavation', uom: 'Cum' },
      { name: 'PCC', uom: 'Cum' },
      { name: 'Footings & Raft', uom: 'Cum' },
      { name: 'Plinth beams', uom: 'Rmt' },
    ],
  },
  {
    trade: 'RCC / Structure',
    items: [
      { name: 'Columns', uom: 'Cum' },
      { name: 'Beams & Slabs', uom: 'Cum' },
      { name: 'Staircase', uom: 'Cum' },
    ],
  },
  {
    trade: 'Masonry & Plaster',
    items: [
      { name: 'Brick / Block work', uom: 'Cum' },
      { name: 'Internal Plaster', uom: 'Sqm' },
      { name: 'External Plaster', uom: 'Sqm' },
      { name: 'Window Sills', uom: 'Rmt' },
      { name: 'Toilet Window Sills', uom: 'Rmt' },
    ],
  },
  {
    trade: 'Waterproofing',
    items: [
      { name: 'Toilets WP', uom: 'Sqm' },
      { name: 'Terrace WP', uom: 'Sqm' },
      { name: 'Sunk slab WP', uom: 'Sqm' },
    ],
  },
  {
    trade: 'Plumbing & Drainage',
    items: [
      { name: 'Water supply (suspended)', uom: 'Rmt' },
      { name: 'Drain line', uom: 'Rmt' },
      { name: 'Toilet plumbing', uom: 'Nos' },
      { name: 'Rain water drain', uom: 'Rmt' },
    ],
  },
  {
    trade: 'Electrical',
    items: [
      { name: 'Walls - Zari (chasing)', uom: 'Points' },
      { name: 'Conduiting & Wiring', uom: 'Points' },
      { name: 'Ceiling pipe fitting', uom: 'Points' },
      { name: 'Concealed metal boxes', uom: 'Nos' },
      { name: 'DB fixing', uom: 'Nos' },
      { name: 'Panel installation', uom: 'Nos' },
    ],
  },
  {
    trade: 'Fire Fighting',
    items: [
      { name: 'FF - Sprinkler', uom: 'Nos' },
      { name: 'FF - Hydrant', uom: 'Nos' },
      { name: 'FF - FAPA', uom: 'Points' },
    ],
  },
  {
    trade: 'Mechanical / HVAC',
    items: [
      { name: 'Internal brackets & piping', uom: 'Rmt' },
      { name: 'PNG', uom: 'Rmt' },
      { name: 'Toilet exhaust', uom: 'Nos' },
    ],
  },
  {
    trade: 'ICT Works',
    items: [
      { name: 'Cabling', uom: 'Rmt' },
      { name: 'Device installation', uom: 'Nos' },
    ],
  },
  {
    trade: 'Finishing',
    items: [
      { name: 'Flooring', uom: 'Sqm' },
      { name: 'Skirting', uom: 'Rmt' },
      { name: 'DADO', uom: 'Sqm' },
      { name: 'Doors', uom: 'Nos' },
      { name: 'Windows', uom: 'Nos' },
      { name: 'False ceiling', uom: 'Sqm' },
      { name: 'Internal putty', uom: 'Sqm' },
      { name: 'Internal painting', uom: 'Sqm' },
      { name: 'Internal gypsum', uom: 'Sqm' },
    ],
  },
  {
    trade: 'Fittings',
    items: [
      { name: 'Light / fan / geyser fittings', uom: 'Nos' },
      { name: 'Partitions', uom: 'Sqm' },
    ],
  },
  {
    trade: 'Lift',
    items: [
      { name: 'Lift brickwork', uom: 'Cum' },
      { name: 'Lift installation', uom: 'Nos' },
    ],
  },
  {
    trade: 'Furniture',
    items: [
      { name: 'Furniture', uom: 'Lot' },
    ],
  },
]

export const TEMPLATE_ITEM_COUNT = DEFAULT_TEMPLATE.reduce((n, t) => n + t.items.length, 0)
