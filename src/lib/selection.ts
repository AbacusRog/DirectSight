// Which suppliers are left out of the payment schedule. Everyone is included by default, so a brand-new
// supplier shows up straight away; the choice is remembered per company in this browser.

type ReadStore = Pick<Storage, 'getItem'>
type WriteStore = Pick<Storage, 'setItem'>

const key = (realm: string) => `ac_pay_excluded_${realm}`

export function loadExcluded(realm: string, store: ReadStore = localStorage): Set<string> {
  try {
    const v: unknown = JSON.parse(store.getItem(key(realm)) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set() // missing, corrupted or blocked storage: include everyone
  }
}

export function saveExcluded(realm: string, excluded: Set<string>, store: WriteStore = localStorage): void {
  try {
    store.setItem(key(realm), JSON.stringify([...excluded]))
  } catch {
    /* private mode: the choice just won't be remembered */
  }
}

export function toggleSupplier(excluded: Set<string>, id: string): Set<string> {
  const next = new Set(excluded)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export const includeAll = (): Set<string> => new Set()
export const includeNone = (allIds: string[]): Set<string> => new Set(allIds)

/** How many of these suppliers are ticked. */
export const countIncluded = (allIds: string[], excluded: Set<string>): number => allIds.filter((id) => !excluded.has(id)).length
