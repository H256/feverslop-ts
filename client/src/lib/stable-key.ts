/**
 * A stable key for each object of a v-for list of forms (a draft that is added to and removed from): removing one form does not move
 * the typing of another, which the index as key would. One counter per call - one per list.
 */
export function stableKeys<T extends object>(): (item: T) => number {
  const keys = new WeakMap<T, number>()
  let next = 0
  return item => keys.get(item) ?? keys.set(item, next++).get(item)!
}
