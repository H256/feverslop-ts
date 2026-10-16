import {describe, expect, test} from "bun:test";
import {countWords, formatDuration, formatRate, suffix} from "./log.ts";

describe('formatDuration', () => {
    test('seconds with one decimal under a minute', () => {
        expect(formatDuration(0)).toBe('0.0s')
        expect(formatDuration(12_340)).toBe('12.3s')
    })
    test('minutes and padded seconds above', () => {
        expect(formatDuration(185_000)).toBe('3m 05s')
        expect(formatDuration(60_000)).toBe('1m 00s')
    })
})

describe('formatRate', () => {
    test('tokens per second, a decimal only for small rates', () => {
        expect(formatRate(410, 10_000)).toBe('41 t/s')
        expect(formatRate(25, 10_000)).toBe('2.5 t/s')
    })
    test('empty when tokens or time are unknown', () => {
        expect(formatRate(undefined, 1000)).toBe('')
        expect(formatRate(0, 1000)).toBe('')
        expect(formatRate(10, 0)).toBe('')
    })
})

test('countWords ignores runs of whitespace and newlines', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  one  two\nthree\t')).toBe(3)
})

test('suffix drops empty parts', () => {
    expect(suffix('12.3s', '', undefined, '41 t/s')).toBe('12.3s · 41 t/s')
})
