// The unit tests run under `bun test`; the client has no Bun types of its own, so the little they use is declared here.
declare module 'bun:test' {
  type Matchers = {
    toBe(value: unknown): void
    toEqual(value: unknown): void
    toHaveLength(length: number): void
    toBeUndefined(): void
    toBeCloseTo(value: number, digits?: number): void
  }
  export function describe(name: string, body: () => void): void
  export function test(name: string, body: () => void | Promise<void>): void
  export function expect(value: unknown): Matchers
}
