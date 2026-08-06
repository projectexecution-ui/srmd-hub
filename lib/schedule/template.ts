// Standard tower work-item template — mirrors the SRMD NGH Zoho WBS
// (11 disciplines → sub-system items). Floors are tracked as matrix columns,
// so each sub-system is ONE row here, not duplicated per floor. Setup applies
// these; progress is a tap per floor in the Floors view.

export interface TemplateItem { name: string; uom: string; sub?: string }
export interface TemplateTrade { trade: string; items: TemplateItem[] }

export const DEFAULT_TEMPLATE: TemplateTrade[] = [
  {
    trade: 'Civil',
    items: [
      { name: 'External Plaster', uom: 'Sqm' },
      { name: 'Slab', uom: 'Cum' },
      { name: 'Brick Work', uom: 'Cum' },
      { name: 'Internal Plaster', uom: 'Sqm' },
      { name: 'Window Sill', uom: 'Rmt' },
      { name: 'Expansion Joint', uom: 'Sqm' },
    ],
  },
  {
    trade: 'Waterproofing',
    items: [
      { name: 'Bath & Toilets', uom: 'Nos' },
      { name: 'Balconies', uom: 'Nos' },
      { name: 'Terraces', uom: 'Nos' },
      { name: 'Windows', uom: 'Nos' },
      { name: 'OHT / UGT', uom: 'Nos' },
      { name: 'Lift Pits', uom: 'Nos' },
    ],
  },
  {
    trade: 'Plumbing & Drainage',
    items: [
      { name: 'External Chambers', uom: 'Nos' },
      { name: 'Water Supply', uom: 'Rmt' },
      { name: 'Sewage', uom: 'Rmt' },
      { name: 'SW/CP Fittings', uom: 'Nos' },
    ],
  },
  {
    trade: 'Fire Fighting',
    items: [
      { name: 'Pump Room', uom: 'Nos' },
      { name: 'Sprinklers', uom: 'Nos' },
      { name: 'Hydrants', uom: 'Rmt' },
      { name: 'FAPA', uom: 'Nos' },
      { name: 'Fire Extinguishers', uom: 'Nos' },
    ],
  },
  {
    trade: 'Electrical',
    items: [
      { name: 'Earthing & Lightning Arrestor', uom: 'Nos' },
      { name: 'DBs', uom: 'Nos' },
      { name: 'Cabling', uom: 'Rmt' },
      { name: 'Point Wiring & Switch/Sockets', uom: 'Rmt' },
      { name: 'Light Fitting', uom: 'Nos' },
      { name: 'Appliances', uom: 'Nos' },
      { name: 'UPS', uom: 'Nos' },
      { name: 'Panels', uom: 'Nos' },
    ],
  },
  {
    trade: 'Mechanical / HVAC',
    items: [
      { name: 'Lifts', uom: 'Nos' },
      { name: 'HVAC ACs', uom: 'Nos' },
      { name: 'HVAC VRV', uom: 'Nos' },
      { name: 'MS Fabrication', uom: 'Nos' },
      { name: 'Kitchen Exhaust', uom: 'Nos' },
    ],
  },
  {
    trade: 'ICT',
    items: [
      { name: 'Internet Cabling', uom: 'Rmt' },
      { name: 'Tel Cabling', uom: 'Rmt' },
      { name: 'CCTV Cabling', uom: 'Rmt' },
      { name: 'Door Access Control', uom: 'Nos' },
      { name: 'Device Fittings', uom: 'Nos' },
      { name: 'TVs / Projectors', uom: 'Nos' },
    ],
  },
  {
    trade: 'External Facade',
    items: [
      { name: 'GRC Jali', uom: 'Sqm' },
    ],
  },
  {
    trade: 'Finishes',
    items: [
      { name: 'External Paint', uom: 'Sqm' },
      { name: 'Windows', uom: 'Nos' },
      { name: 'Door Frame', uom: 'Nos' },
      { name: 'Door Shutters', uom: 'Nos' },
      { name: 'Wooden Doors', uom: 'Nos' },
      { name: 'Fire Doors', uom: 'Nos' },
      { name: 'Flooring', uom: 'Sqm' },
      { name: 'Wall Finishes', uom: 'Sqm' },
      { name: 'DADO', uom: 'Sqm' },
      { name: 'Ceiling', uom: 'Sqm' },
      { name: 'False Ceiling - Gypsum', uom: 'Sqm' },
      { name: 'False Ceiling - Calcium Silicate', uom: 'Sqm' },
      { name: 'False Ceiling - 2x2', uom: 'Sqm' },
      { name: 'Internal Partitions', uom: 'Sqm' },
      { name: 'Kitchen & Toilet Platform', uom: 'Nos' },
      { name: 'Internal Putty', uom: 'Sqm' },
      { name: 'Internal painting', uom: 'Sqm' },
      { name: 'Railings', uom: 'Rmt' },
      { name: 'Mirrors', uom: 'Nos' },
      { name: 'White Goods', uom: 'Nos' },
    ],
  },
  {
    trade: 'Interiors',
    items: [
      { name: 'Fixed Furniture', uom: 'Nos' },
      { name: 'Loose Furniture', uom: 'Nos' },
    ],
  },
  {
    trade: 'Cleaning',
    items: [
      { name: 'General Cleaning', uom: 'Nos' },
      { name: 'Deep Cleaning', uom: 'Nos' },
    ],
  },
]

export const TEMPLATE_ITEM_COUNT = DEFAULT_TEMPLATE.reduce((n, t) => n + t.items.length, 0)
