import {describe, expect, test} from "bun:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describeEstimate, estimateRemaining, keepTimingsIn, median, readTimings, recordTiming, type Timing} from "./timings.ts";

const clip = (seconds: number, name = 'wan'): Timing => ({at: '', kind: 'clip', name, seconds})

describe('estimateRemaining', () => {
    test('median of the earlier jobs of the same kind and workflow', () => {
        const timings = [clip(100), clip(200), clip(1000), clip(5, 'other')]
        expect(estimateRemaining(timings, 'clip', 'wan', 3)).toEqual({seconds: 600, perJob: 200, samples: 3})
    })
    test('servers share the work', () => {
        expect(estimateRemaining([clip(100)], 'clip', 'wan', 4, 2)?.seconds).toBe(200)
    })
    test('nothing to say without earlier jobs or without jobs left', () => {
        expect(estimateRemaining([], 'clip', 'wan', 3)).toBeUndefined()
        expect(estimateRemaining([clip(10)], 'clip', 'wan', 0)).toBeUndefined()
    })
})

test('median of an even count is the middle pair', () => expect(median([1, 2, 3, 4])).toBe(2.5))

test('describeEstimate', () => {
    expect(describeEstimate('clip', 12, {seconds: 6000, perJob: 500, samples: 31})).toBe('12 clips left, about 1h 40m at the median of 31 earlier clips (estimate)')
    expect(describeEstimate('clip', 1, undefined)).toBe('1 clip left')
})

test('timings are appended as JSON lines and read back, damaged lines skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timings-'))
    keepTimingsIn(dir)
    recordTiming({kind: 'clip', name: 'wan', seconds: 12.5, resolution: '1280x720', frames: 97})
    recordTiming({kind: 'llm', name: 'm', seconds: 3, tokensPerSecond: 40})
    await Bun.write(join(dir, 'timings.jsonl'), (await Bun.file(join(dir, 'timings.jsonl')).text()) + 'garbage\n')
    keepTimingsIn(undefined)
    recordTiming({kind: 'clip', name: 'x', seconds: 1})
    const read = readTimings(dir)
    expect(read.map(t => t.kind)).toEqual(['clip', 'llm'])
    expect(read[0]).toMatchObject({seconds: 12.5, frames: 97})
})
