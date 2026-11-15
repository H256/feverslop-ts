import {expect, test} from 'bun:test'
import {defaults, lipsyncDummiesProblem, lipsyncDummyProblem, lipsyncScaleProblem} from './config.ts'
import {dummiesOf, lipsyncFingerprint, lipsyncRequests} from './lipsync.ts'
import type {Project, TimedLine} from './project.ts'

const word = (text: string, start: number, end: number) => ({text, start, end})
const line = (n: number, words: ReturnType<typeof word>[]): TimedLine => ({
    line: n,
    sectionIndex: 0,
    section: 'Verse',
    text: words.map(w => w.text).join(' '),
    start: words[0]!.start,
    end: words.at(-1)!.end,
    words,
    confidence: 1,
})
const slot = (id: string, index: number, start: number, end: number) => ({id, index, section: 'Verse', start, end, bars: 4, energy: 0.5, lyrics: []})
const project = (singing?: Project['singing']): Project => ({
    timeline: {maxClipSec: 10, barsPerSlot: 4, aligned: true, sections: [], slots: [slot('slot-001', 0, 0, 8), slot('slot-002', 1, 8, 14)]},
    lyricsTiming: {
        lines: [
            line(0, [word('Hello', 0.5, 1), word('there', 1.2, 2)]),
            line(1, [word('Good', 4, 4.4), word('night', 4.6, 6)]),
            line(2, [word('Alone', 9, 10)]),
        ],
    },
    ...(singing ? {singing} : {}),
})
const settings = {...defaults, lipsyncDummies: 1 as 1 | 2}
const two = {...settings, lipsyncDummies: 2 as 1 | 2}
const duet = {
    singers: ['anna', 'ben'],
    lines: [
        {line: 0, text: 'Hello there', singers: ['anna']},
        {line: 1, text: 'Good night', singers: ['ben']},
        {line: 2, text: 'Alone', singers: ['ben']},
    ],
}

test('every clip of the cut gets a preview, with the vocals as the sung words of the saved timing', () => {
    const clips = lipsyncRequests(project(), settings)
    expect(clips.map(c => c.id)).toEqual(['slot-001', 'slot-002'])
    expect(clips[0]!.vocals.map(v => v.text)).toEqual(['Hello there', 'Good night'])
    expect(clips[0]!.frames).toBe(192)
    expect(clips[0]!.shots).toEqual([{at: 0, dummy: 0}])
    expect(clips[0]!.prompt).toContain('<d>[English] Hello there.</d>')
    expect(clips[0]!.prompt).toContain('<Audio 1> is the isolated lead vocal')
    expect(clips[0]!.prompt).toContain('<Subject 1> is a dummy singer, ')
    expect(clips[0]!.prompt).not.toContain('<Subject 2>')
})

test('without timed lyrics or a cut there is nothing to preview', () => {
    expect(lipsyncRequests({}, settings)).toEqual([])
    expect(lipsyncRequests({timeline: project().timeline}, settings)).toEqual([])
})

test('the preview follows a line left out on the Timing page', () => {
    const data = project()
    data.lyricsTiming!.lines[1]!.off = true
    expect(lipsyncRequests(data, settings)[0]!.vocals.map(v => v.text)).toEqual(['Hello there'])
})

test('a clip nobody sings in still has the vocals stem: the preview is made to show a mouth that moves on what is not a lyric', () => {
    const clips = lipsyncRequests({...project(), lyricsTiming: {lines: [line(0, [word('Hello', 0.5, 1)])]}}, settings)
    expect(clips[1]!.prompt).toContain('nobody sings in this clip')
    expect(clips[1]!.prompt).toContain('<Audio 1> is the isolated vocal stem')
})

test('with two dummies the clip cuts where the singer changes, halfway through the pause', () => {
    const [first, second] = lipsyncRequests(project(duet), two)
    expect(first!.shots).toEqual([
        {at: 0, dummy: 0},
        {at: 3, dummy: 1},
    ])
    expect(first!.vocals.map(v => v.dummy)).toEqual([0, 1])
    expect(first!.prompt).toContain('<Subject 1> and <Subject 2>')
    expect(first!.prompt).toContain('At 00:03.000, the shot cuts to a frontal close-up of <Subject 2>')
    expect(first!.prompt).toContain('<Subject 2> sings <d>[English] Good night.</d>')
    // the second clip is sung by the second singer alone: one shot, the second dummy
    expect(second!.shots).toEqual([{at: 0, dummy: 1}])
    expect(second!.prompt).not.toContain('<Subject 1>')
})

test('with one dummy the singers change nothing', () => {
    const [first] = lipsyncRequests(project(duet), settings)
    expect(first!.shots).toEqual([{at: 0, dummy: 0}])
    expect(first!.prompt).not.toContain('<Subject 2>')
})

test('a change of singer less than 0.6 s after the shot began is no cut of its own', () => {
    const data = project(duet)
    data.lyricsTiming!.lines[0] = line(0, [word('Hello', 0.1, 0.3)])
    data.lyricsTiming!.lines[1] = line(1, [word('Good', 0.4, 0.5)])
    expect(lipsyncRequests(data, two)[0]!.shots).toEqual([{at: 0, dummy: 0}])
})

test('the dummy of a singer: the order they are first named, one dummy for everyone when asked for one', () => {
    expect(['anna', 'ben', 'carl'].map(dummiesOf(duet, 2))).toEqual([0, 1, 0])
    expect(['anna', 'ben'].map(dummiesOf(duet, 1))).toEqual([0, 0])
    expect(dummiesOf(undefined, 2)('anyone')).toBe(0)
})

test('the dummy is the settings text, and the preview is outdated by another size, workflow, audio or prompt', () => {
    const clip = lipsyncRequests(project(), {...settings, lipsyncDummy: 'a mannequin'})[0]!
    expect(clip.prompt).toContain('<Subject 1> is a dummy singer, a mannequin;')
    const audio = {vocals: 'a', song: 'b'}
    const base = JSON.stringify(lipsyncFingerprint(clip, {...defaults, lipsyncScale: 0.125}, audio))
    expect(JSON.stringify(lipsyncFingerprint(clip, {...defaults, lipsyncScale: 0.25}, audio))).not.toBe(base)
    expect(JSON.stringify(lipsyncFingerprint(clip, {...defaults, lipsyncScale: 0.125, videoWorkflow: 'other'}, audio))).not.toBe(base)
    expect(JSON.stringify(lipsyncFingerprint(clip, {...defaults, lipsyncScale: 0.125}, {...audio, vocals: 'c'}))).not.toBe(base)
    expect(JSON.stringify(lipsyncFingerprint({...clip, prompt: 'another'}, {...defaults, lipsyncScale: 0.125}, audio))).not.toBe(base)
    expect(JSON.stringify(lipsyncFingerprint(clip, {...defaults, lipsyncScale: 0.125}, audio))).toBe(base)
})

test('the settings are checked as config.json is', () => {
    expect(lipsyncScaleProblem(0.125)).toBeUndefined()
    expect(lipsyncScaleProblem(0)).toContain('lipsyncScale')
    expect(lipsyncScaleProblem(2)).toContain('lipsyncScale')
    expect(lipsyncDummiesProblem(2)).toBeUndefined()
    expect(lipsyncDummiesProblem(3)).toContain('lipsyncDummies')
    expect(lipsyncDummyProblem('lipsyncDummy', 'a puppet')).toBeUndefined()
    expect(lipsyncDummyProblem('lipsyncDummy', '')).toContain('lipsyncDummy')
    expect(lipsyncDummyProblem('lipsyncDummy', 'a\nb')).toContain('lipsyncDummy')
    expect(defaults.lipsyncScale).toBe(0.125)
    expect(defaults.lipsyncDummies).toBe(1)
})
