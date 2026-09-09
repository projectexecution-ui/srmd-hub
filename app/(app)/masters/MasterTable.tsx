import { MasterTableClient, type MasterRow, type MasterColumn, type Cell, type CellTone, type ClientFilter } from './MasterTableClient'

export type { MasterRow, MasterColumn, Cell, CellTone }

/** A quick chip above the table, e.g. "Not in IN4". The test runs HERE, on the server. */
export type Filter = { key: string; label: string; test: (r: MasterRow) => boolean }

/**
 * The Masters table — server half. Pages hand it rows and chips whose tests
 * are functions; a function cannot cross into a client component ("Functions
 * cannot be passed directly to Client Components" — this broke Item Master,
 * Stores, Projects and the contact record on 10 Sep 2026), so each test runs
 * here and becomes a tag on the row, and the client gets only labels.
 */
export function MasterTable(props: Omit<React.ComponentProps<typeof MasterTableClient>, 'filters' | 'rows'> & { rows: MasterRow[]; filters?: Filter[] }) {
  const { filters = [], rows, ...rest } = props
  const tagged = filters.length ? rows.map(r => ({ ...r, tags: filters.filter(f => f.test(r)).map(f => f.key) })) : rows
  const chips: ClientFilter[] = filters.map(f => ({ key: f.key, label: f.label }))
  return <MasterTableClient {...rest} rows={tagged} filters={chips} />
}
