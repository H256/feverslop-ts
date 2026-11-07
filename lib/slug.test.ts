import {expect, test} from "bun:test"
import {MAX_ID_LENGTH, toSlug} from "./slug.ts"

test('a short name stays as it was', () => expect(toSlug('Circus Ring')).toBe('circus-ring'))
test('a long name is cut at a word', () => {
    const id = toSlug('a circus ring built within a vast black earthed graveyard dotted with faintly glowing headstones')
    expect(id.length).toBeLessThanOrEqual(MAX_ID_LENGTH)
    expect(id).toBe('a-circus-ring-built-within-a-vast-black-earthed')
})
test('one endless word is cut hard', () => expect(toSlug('x'.repeat(100))).toBe('x'.repeat(MAX_ID_LENGTH)))
