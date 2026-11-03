import test from 'node:test'
import assert from 'node:assert/strict'
import { countIncluded, includeAll, includeNone, loadExcluded, saveExcluded, toggleSupplier } from '../src/lib/selection.ts'

const fakeStore = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

test('everyone is included until you say otherwise', () => {
  assert.equal(loadExcluded('123', fakeStore()).size, 0)
})

test('ticking and unticking, remembered per company', () => {
  const store = fakeStore()
  let ex = loadExcluded('123', store)
  ex = toggleSupplier(ex, 'a') // untick a
  ex = toggleSupplier(ex, 'b') // untick b
  ex = toggleSupplier(ex, 'a') // tick a again
  saveExcluded('123', ex, store)
  assert.deepEqual([...loadExcluded('123', store)], ['b'])
  assert.equal(loadExcluded('999', store).size, 0, 'another company is unaffected')
})

test('toggle never changes the set it was given', () => {
  const original = new Set(['a'])
  toggleSupplier(original, 'b')
  assert.deepEqual([...original], ['a'])
})

test('tick all / untick all, and counting', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(countIncluded(ids, includeAll()), 3)
  assert.equal(countIncluded(ids, includeNone(ids)), 0)
  assert.equal(countIncluded(ids, new Set(['b'])), 2)
  assert.equal(countIncluded(ids, new Set(['gone-supplier'])), 3, 'a supplier that no longer exists does not count')
})

test('bad saved data cannot break the page', () => {
  for (const bad of ['not json', '{"a":1}', '123', 'null', '["ok", 5, null]']) {
    const ex = loadExcluded('123', fakeStore({ ac_pay_excluded_123: bad }))
    assert.ok(ex instanceof Set)
    assert.ok([...ex].every((x) => typeof x === 'string'))
  }
  assert.deepEqual([...loadExcluded('123', fakeStore({ ac_pay_excluded_123: '["ok", 5, null]' }))], ['ok'])
})

test('storage that throws is tolerated', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(loadExcluded('123', broken).size, 0)
  assert.doesNotThrow(() => saveExcluded('123', new Set(['a']), broken))
})
