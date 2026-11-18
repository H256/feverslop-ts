import {describe, expect, test} from 'bun:test'
import {RATE} from '../../shared/timing-fit.ts'
import type {LyricsTiming} from '../project.ts'
import {earlyLines} from './requests.ts'

// singing from 1.0 s on without a pause, the line's first word timed at 2.0 s: a second of it before the first word
const peaks = Array.from({length: 4 * RATE}, (_, k) => (k >= RATE ? 1 : 0))
const line = (byHand?: boolean) => ({
    line: 0,
    sectionIndex: 0,
    section: 'Verse 1',
    text: 'By the flame',
    start: 2,
    end: 3,
    words: [
        {text: 'By', start: 2, end: 2.5},
        {text: 'the flame', start: 2.5, end: 3},
    ],
    confidence: 1,
    ...(byHand ? {byHand} : {}),
})

describe('lines heard before their first word', () => {
    test('a line the timing placed is named with its lead', () => {
        expect(earlyLines({lines: [line()]} as LyricsTiming, peaks)).toEqual(['"By the flame" (1.0 s)'])
    })
    // tides-261115: all 27 lines placed by hand, 7 of them warned about - each right after the line before
    test('a line placed by hand was checked on the Timing page already', () => {
        expect(earlyLines({lines: [line(true)]} as LyricsTiming, peaks)).toEqual([])
    })
})
