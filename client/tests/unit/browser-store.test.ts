import {afterEach, expect, test} from 'bun:test'
import {keptThisSession, viewerStore} from '../../src/lib/browser-store'

const g = globalThis as unknown as {window?: unknown}
afterEach(() => {
  delete g.window
})

test('blocked browser storage reads as nothing and writes nothing instead of throwing (#974)', () => {
  g.window = {
    get localStorage(): never {
      throw new Error('SecurityError')
    },
    sessionStorage: {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('quota')
      },
      removeItem() {
        throw new Error('blocked')
      },
    },
  }
  expect(viewerStore.get('x')).toBeNull()
  expect(() => viewerStore.set('x', '1')).not.toThrow()
  expect(() => viewerStore.remove('x')).not.toThrow()
  expect(keptThisSession.get('x')).toBeNull()
  expect(() => keptThisSession.set('x', '1')).not.toThrow()
})

test('a working storage keeps what is written', () => {
  const data = new Map<string, string>()
  g.window = {localStorage: {getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k)}}
  viewerStore.set('a', 'b')
  expect(viewerStore.get('a')).toBe('b')
  viewerStore.remove('a')
  expect(viewerStore.get('a')).toBeNull()
})
