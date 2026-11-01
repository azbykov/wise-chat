/** One page of a cursor-paginated list. `nextCursor: null` means there is nothing further. */
export interface Page<T, C = string> {
  items: T[];
  nextCursor: C | null;
}

/**
 * Turns `limit + 1` documents, read in paging order, into a page: the extra one only says that
 * there is more, and the next cursor is the last document kept.
 */
export function toPage<D, T, C>(
  docs: D[],
  limit: number,
  toItem: (doc: D) => T,
  cursorOf: (doc: D) => C,
): Page<T, C> {
  const kept = docs.slice(0, limit);
  const last = kept[kept.length - 1];
  return {
    items: kept.map(toItem),
    nextCursor: docs.length > limit && last !== undefined ? cursorOf(last) : null,
  };
}
