import {describe, expect, test} from 'bun:test'
import {bandBreaks, barCuts, shotCuts} from './shot-cuts.ts'

// tides-of-eternal-flame-261113, slot-025 (the bridge): guitar, bass and drums break off at 2:42.45 and come back at 2:46.65
const slot = {start: 160.287, end: 168.229, bars: 4}
const downbeats = [156.32, 158.29, 160.29, 162.26, 164.26, 166.32, 168.23, 170.22]
const guitar = [
    {start: 0.6, end: 162.45},
    {start: 166.65, end: 178.7},
]
const bass = [
    {start: 0.45, end: 152.7},
    {start: 154.95, end: 162.9},
    {start: 165.9, end: 213.15},
]
const drums = [
    {start: 0, end: 163.65},
    {start: 165.9, end: 214.55},
]

describe('bandBreaks', () => {
    test('only where every instrument is silent, for at least MIN_BREAK', () => {
        // the bass is out at 152.7-154.95, but guitar and drums play on: no break
        expect(bandBreaks([guitar, bass, drums], 215)).toEqual([{start: 163.65, end: 165.9}])
        expect(bandBreaks([guitar], 215)).toEqual([
            {start: 162.45, end: 166.65},
            {start: 178.7, end: 215},
        ])
    })

    test('a hit between two pauses shorter than MIN_BREAK is no break', () => {
        expect(
            bandBreaks(
                [
                    [
                        {start: 0, end: 1.45},
                        {start: 2.44, end: 2.8},
                        {start: 3.7, end: 4.1},
                        {start: 4.94, end: 8},
                    ],
                ],
                8,
            ),
        ).toEqual([])
    })

    test('no instruments, no breaks', () => {
        expect(bandBreaks([], 100)).toEqual([])
    })
})

describe('shotCuts', () => {
    test('without a break: the cuts on the bars', () => {
        expect(shotCuts(slot, 2, downbeats, [])).toEqual(barCuts(slot, 2, downbeats))
        expect(barCuts(slot, 2, downbeats)).toEqual([0, 3.973])
    })

    test('the quiet is a shot of its own, cut on the downbeats nearest to where it begins and ends', () => {
        const breaks = bandBreaks([guitar], 215)
        // 2:42.45 -> the downbeat 2:42.26, 2:46.65 -> 2:46.32; the cut on the bar at 2:44.26 is inside the quiet and goes
        expect(shotCuts(slot, 2, downbeats, breaks)).toEqual([0, 1.973, 6.033])
    })

    test('a break with no downbeat near it is cut where it is', () => {
        expect(shotCuts({start: 0, end: 8, bars: 4}, 1, [0, 4], [{start: 2.5, end: 5.5}])).toEqual([0, 2.5, 5.5])
    })

    test('no shot shorter than MIN_SHOT: a change near the edge of the clip is left out', () => {
        // the band comes back 0.5 s before the clip ends
        expect(shotCuts({start: 0, end: 8, bars: 4}, 1, [0, 2, 4, 6], [{start: 3, end: 7.5}])).toEqual([0, 3])
        // a bar cut too close to a change goes
        expect(shotCuts({start: 0, end: 8, bars: 4}, 2, [0, 2, 4, 6], [{start: 5, end: 20}])).toEqual([0, 5])
    })

    test('a break around the whole clip changes nothing', () => {
        expect(shotCuts(slot, 2, downbeats, [{start: 150, end: 170}])).toEqual([0, 3.973])
    })
})
