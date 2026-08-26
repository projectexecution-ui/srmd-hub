/** Reading more than a thousand rows.
 *
 *  PostgREST answers an unpaginated select with AT MOST 1,000 rows and says
 *  nothing about the ones it left out. There is no error, no flag — just a
 *  shorter array. Whatever consumes it then quietly drops what it cannot
 *  resolve, and a screen shows a number that is simply wrong.
 *
 *  That is not hypothetical. The Stock screen reported 436 items in stock out of
 *  472, because it resolved item names against an unpaginated read of a
 *  2,803-row catalogue and discarded every line whose item fell outside the
 *  first thousand. The Item Master's category chips counted 1,000 items and
 *  offered two categories out of sixteen. Both looked completely plausible.
 *
 *  So: any read of a table that can pass a thousand rows goes through here.
 */

const PAGE = 1000

/** Hard stop. 200 pages is 200,000 rows — far past anything this module
 *  produces, and better than looping for ever on a cursor that never advances. */
const MAX_PAGES = 200

export type Paged<T> = { rows: T[]; error: string | null }

/** Page a select until the source is exhausted.
 *
 *  `build` receives the inclusive range for each page and must return the same
 *  query shape every time — only the range changes. Order the query by
 *  something stable, or Postgres may repeat or skip rows between pages. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
): Promise<Paged<T>> {
  const rows: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1)
    if (error) return { rows, error: error.message }
    const batch = data ?? []
    rows.push(...batch)
    // A short page means the end. Equal to PAGE means there may be more.
    if (batch.length < PAGE) return { rows, error: null }
    if (page >= MAX_PAGES) {
      return { rows, error: 'Too many rows to read in one go — narrow the filter.' }
    }
  }
}

/** The same, for callers that only want the rows and treat a failure as empty.
 *  Use it where an empty list is already handled and an error banner would be
 *  noise — never where the count is the answer the screen is giving. */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
): Promise<T[]> {
  return (await fetchAll(build)).rows
}
