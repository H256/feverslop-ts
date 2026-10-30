import {describe, expect, test} from "bun:test";
import {clipFailureRisks} from "./render-state.ts";
import type {Timing} from "./timings.ts";

const now = Date.parse('2026-10-31T00:00:00.000Z')
const job = (frames: number, failed: boolean, more: Partial<Timing> = {}): Timing => ({
    at: '2026-10-30T00:00:00.000Z', kind: 'clip', name: 'wf', seconds: 600, server: 'a', frames,
    ...(failed ? {outcome: 'failed' as const} : {}), ...more,
})
const jobs = (frames: number, failed: number, ok: number, more: Partial<Timing> = {}) => [
    ...Array.from({length: failed}, () => job(frames, true, more)),
    ...Array.from({length: ok}, () => job(frames, false, more)),
]
const risks = (timings: Timing[], frames = 209) => clipFailureRisks(timings, [{frames}], 'wf', ['a'], now)

describe('clipFailureRisks', () => {
    test('names the server, the count, the time lost and the clips it concerns', () => {
        expect(risks(jobs(209, 3, 7))).toEqual(['a: 3 of 10 clips over 150 frames failed in the last 14 days (30 min of GPU time) - 1 clip(s) of this run are that long'])
    })
    test('says nothing about few failures or a small share', () => {
        expect(risks(jobs(209, 2, 1))).toEqual([])
        expect(risks(jobs(209, 3, 20))).toEqual([])
    })
    test('only clips of the length this run has count', () => {
        expect(risks(jobs(209, 5, 5), 100)).toEqual([])
    })
    test('another server, another workflow and old jobs do not count', () => {
        expect(risks(jobs(209, 5, 0, {server: 'b'}))).toEqual([])
        expect(risks(jobs(209, 5, 0, {name: 'other'}))).toEqual([])
        expect(risks(jobs(209, 5, 0, {at: '2026-10-01T00:00:00.000Z'}))).toEqual([])
    })
    test('a retry is no failure and no success', () => {
        expect(risks([...jobs(209, 3, 0), ...jobs(209, 0, 0), job(209, false, {outcome: 'retry'})])).toHaveLength(1)
        expect(risks(jobs(209, 2, 0, {}).concat(job(209, false, {outcome: 'retry'})))).toEqual([])
    })
})
