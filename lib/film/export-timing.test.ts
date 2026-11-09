import {expect, test} from 'bun:test'
import {timelineEdl} from './timeline.ts'
import {subtitleCues} from './subtitles.ts'
import type {FilmClipRequest} from './compose.ts'

test('EDL accepts the actual assembly cuts, including context and extra dialogue frames (#651)', () => {
    const edl = timelineEdl(
        'film',
        [
            {id: 'clip-001', frames: 48},
            {id: 'clip-002', frames: 48, startsFrom: 'clip-001'},
        ],
        {used: [60, 72], skipped: [0, 0]},
    )
    expect(edl).toContain('00:00:00:00 00:00:02:12 00:00:00:00 00:00:02:12')
    expect(edl).toContain('00:00:00:00 00:00:03:00 00:00:02:12 00:00:05:12')
})

test('subtitle cues use the actual assembled span and offset after a skipped frame (#652)', () => {
    const clip = {
        sceneId: 's1',
        seconds: 2,
        dialogue: [{line: 0, at: 0, text: 'A long line that continues speaking past the planned end of this shot.'}],
    } as FilmClipRequest
    const cues = subtitleCues([clip], [0], {'s1:0': 'translated'}, {used: [72], skipped: [1]})
    expect(cues[0]!.end).toBeCloseTo(71 / 24)
    expect(cues[0]!.start).toBeLessThan(subtitleCues([clip], [0], {'s1:0': 'translated'})[0]!.start)
})
