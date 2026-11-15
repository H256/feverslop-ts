import {expect, test} from 'bun:test'
import {keptThisSession, viewerStore} from '../../src/lib/browser-store'

const g = globalThis as unknown as {window?: unknown}
const threw = (fn: () => void) => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

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
  try {
    expect(viewerStore.get('x')).toBe(null)
    expect(threw(() => viewerStore.set('x', '1'))).toBe(false)
    expect(threw(() => viewerStore.remove('x'))).toBe(false)
    expect(keptThisSession.get('x')).toBe(null)
    expect(threw(() => keptThisSession.set('x', '1'))).toBe(false)
  } finally {
    delete g.window
  }
})

test('a working storage keeps what is written', () => {
  const data = new Map<string, string>()
  g.window = {localStorage: {getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k)}}
  try {
    viewerStore.set('a', 'b')
    expect(viewerStore.get('a')).toBe('b')
    viewerStore.remove('a')
    expect(viewerStore.get('a')).toBe(null)
  } finally {
    delete g.window
  }
})
