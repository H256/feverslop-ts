/** Case-insensitive substring search over the given fields; an empty query matches everything. */
export function matchesText(query: string, ...fields: string[]) {
  const needle = query.trim().toLowerCase()
  return !needle || fields.some(field => field.toLowerCase().includes(needle))
}
