import {describe, expect, test} from 'bun:test'
import type {Project} from '../project.ts'
import {applySinging, singingView} from './singing.ts'

const character = (id: string, name: string) =>
    ({id, name, role: '', description: '', isGroup: false}) as unknown as NonNullable<Project['cast']>['characters'][number]
const beat = (id: string, characterIds: string[]) =>
    ({id, order: 0, summary: '', moments: [], locationId: 'hall', characterIds, intensity: 0.5, weight: 1, kind: 'build'}) as unknown as NonNullable<
        Project['beats']
    >[number]
const pictures = (...ids: string[]) => ({pictures: ids.map(id => ({kind: 'character', id}))})
const vocal = (line: number) => ({at: 0, end: 1, line, text: `line ${line}`, singers: []})

// three lines: 0 and 1 in beat b1 (clips c-1, c-2), 2 in beat b2 (clip c-3); Ann sings all, Ben is in the cast and in b1 only
const project = (): Project => ({
    cast: {characters: [character('ann', 'Ann'), character('ben', 'Ben'), character('cat', 'Cat')], locations: []},
    singing: {singers: ['ann'], lines: [0, 1, 2].map(line => ({line, text: `line ${line}`, singers: ['ann']}))},
    beats: [beat('b1', ['ann', 'ben']), beat('b2', ['ann'])],
    blocking: {b1: {staging: 's1', starts: {}, ends: {}}, b2: {staging: 's2', starts: {}, ends: {}}},
    shotMoments: {b1: {shots: []}, b2: {shots: []}} as unknown as Project['shotMoments'],
    lyricsTiming: {
        lines: [0, 1, 2].map(line => ({
            line,
            sectionIndex: 0,
            section: line < 2 ? 'Verse' : 'Chorus',
            text: `line ${line}`,
            start: line * 2,
            end: line * 2 + 1.5,
            words: [],
            confidence: 1,
        })),
    },
})
const requests = [
    {id: 'c-1', beatId: 'b1', vocals: [vocal(0)], assets: pictures('ann', 'ben')},
    {id: 'c-2', beatId: 'b1', vocals: [vocal(1)], assets: pictures('ann')},
    {id: 'c-3', beatId: 'b2', vocals: [vocal(2)], assets: pictures('ann', 'ben')},
    {id: 'c-4', beatId: 'b2', assets: pictures('cat')},
]

describe('applySinging - who sings which line, set by hand', () => {
    test('a duet line: the line gets both, the song a second singer, and only its beat loses the shot plan', () => {
        const data = project()
        const result = applySinging(data, {lines: [{line: 1, singers: ['ann', 'ben']}]}, requests)
        // Ben becomes a singer: c-3 shows him too, and says from now on that he keeps his mouth closed there
        expect(result).toEqual({changed: [1], replanned: ['b1'], added: [], newSingers: ['ben'], formerSingers: [], staleClips: ['c-1', 'c-2', 'c-3']})
        expect(data.singing!.lines[1]!.singers).toEqual(['ann', 'ben'])
        expect(data.singing!.singers).toEqual(['ann', 'ben'])
        expect(Object.keys(data.shotMoments!)).toEqual(['b2'])
        // Ben was in b1 already: its floor plan stays
        expect(data.blocking!.b1).toBeDefined()
        expect(data.beats![0]!.characterIds).toEqual(['ann', 'ben'])
    })

    test('the wrong singer swapped: a singer who is not in the beat is added to it, and the beat loses its floor plan', () => {
        const data = project()
        const result = applySinging(data, {lines: [{line: 2, singers: ['cat']}]}, requests)
        expect(result.added).toEqual([{beat: 'b2', character: 'cat'}])
        // Cat sings now, Ann still sings lines 0 and 1: c-4 (Cat's) goes stale besides b2's own clips
        expect(result.newSingers).toEqual(['cat'])
        expect(result.staleClips).toEqual(['c-3', 'c-4'])
        expect(result.replanned).toEqual(['b2'])
        expect(data.beats![1]!.characterIds).toEqual(['ann', 'cat'])
        expect(data.blocking!.b2).toBeUndefined()
        expect(data.blocking!.b1).toBeDefined()
        expect(data.singing!.singers).toEqual(['ann', 'cat'])
    })

    test('a singer left with no line is no singer any more; the lead stays first', () => {
        const data = project()
        data.singing = {
            singers: ['ann', 'ben'],
            lines: [
                {line: 0, text: '', singers: ['ben']},
                {line: 1, text: '', singers: ['ann']},
                {line: 2, text: '', singers: ['ann']},
            ],
        }
        const result = applySinging(data, {lines: [{line: 0, singers: ['ann']}]}, requests)
        expect(data.singing!.singers).toEqual(['ann'])
        expect(result.formerSingers).toEqual(['ben'])
    })

    test('nothing changed: nothing is dropped', () => {
        const data = project()
        const result = applySinging(data, {lines: [{line: 0, singers: ['ann']}]}, requests)
        expect(result).toEqual({changed: [], replanned: [], added: [], newSingers: [], formerSingers: [], staleClips: []})
        expect(Object.keys(data.shotMoments!)).toEqual(['b1', 'b2'])
    })

    test('a kept answer of a stopped run for a replanned beat goes too', () => {
        const data = project()
        data.partials = {shotMoments: {b1: {fingerprint: 'x', value: {}}, b2: {fingerprint: 'y', value: {}}}}
        applySinging(data, {lines: [{line: 0, singers: ['ben']}]}, requests)
        expect(Object.keys(data.partials.shotMoments!)).toEqual(['b2'])
    })

    test('refuses what is not there: an unknown line, a character not in the cast, a line without a singer', () => {
        expect(() => applySinging(project(), {lines: [{line: 9, singers: ['ann']}]}, requests)).toThrow('no sung line 9')
        expect(() => applySinging(project(), {lines: [{line: 0, singers: ['zed']}]}, requests)).toThrow('not in the cast: zed')
        expect(() => applySinging(project(), {lines: [{line: 0, singers: []}]}, requests)).toThrow('needs a singer')
        expect(() => applySinging({}, {lines: []}, requests)).toThrow('nobody sings')
    })
})

describe('singingView', () => {
    test('per line its time, section, beats and clips; per beat whether it has a shot plan', () => {
        const data = project()
        delete data.shotMoments!.b2
        const view = singingView('/nowhere', data, requests)!
        expect(view.characters.find(c => c.id === 'ben')!.clips).toEqual(['c-1', 'c-3'])
        expect(view.lines[2]).toEqual({
            line: 2,
            text: 'line 2',
            singers: ['ann'],
            words: [],
            estimated: false,
            section: 'Chorus',
            start: 4,
            end: 5.5,
            beats: ['b2'],
            clips: ['c-3'],
        })
        expect(view.unplanned).toEqual(['b2'])
        expect(view.characters.find(c => c.id === 'ben')!.beats).toEqual(['b1'])
        expect(view.beats[0]).toEqual({id: 'b1', characterIds: ['ann', 'ben'], planned: true, clips: ['c-1', 'c-2']})
    })
})

describe('applySinging - a singer change within a line', () => {
    const withWords = () => {
        const data = project()
        data.lyricsTiming!.lines[1]!.words = ['we', 'rise', 'and', 'fall'].map((text, n) => ({text, start: 2 + n * 0.4, end: 2.3 + n * 0.4}))
        return data
    }

    test('parts are kept sorted from word 0, the line sung by all of their singers', () => {
        const data = withWords()
        const result = applySinging(
            data,
            {
                lines: [
                    {
                        line: 1,
                        singers: [],
                        parts: [
                            {from: 2, singers: ['ben']},
                            {from: 0, singers: ['ann']},
                        ],
                    },
                ],
            },
            requests,
        )
        expect(result.changed).toEqual([1])
        expect(data.singing!.lines[1]).toEqual({
            line: 1,
            text: 'line 1',
            singers: ['ann', 'ben'],
            parts: [
                {from: 0, singers: ['ann']},
                {from: 2, singers: ['ben']},
            ],
        })
    })

    test('a change of the split alone is a change; taking the split back leaves no parts', () => {
        const data = withWords()
        applySinging(
            data,
            {
                lines: [
                    {
                        line: 1,
                        singers: [],
                        parts: [
                            {from: 0, singers: ['ann']},
                            {from: 2, singers: ['ben']},
                        ],
                    },
                ],
            },
            requests,
        )
        expect(
            applySinging(
                data,
                {
                    lines: [
                        {
                            line: 1,
                            singers: [],
                            parts: [
                                {from: 0, singers: ['ann']},
                                {from: 3, singers: ['ben']},
                            ],
                        },
                    ],
                },
                requests,
            ).changed,
        ).toEqual([1])
        // both parts sung by Ann: one part, so no parts at all
        applySinging(
            data,
            {
                lines: [
                    {
                        line: 1,
                        singers: [],
                        parts: [
                            {from: 0, singers: ['ann']},
                            {from: 3, singers: ['ann']},
                        ],
                    },
                ],
            },
            requests,
        )
        expect(data.singing!.lines[1]).toEqual({line: 1, text: 'line 1', singers: ['ann']})
    })

    test('no parts on a line without word times', () => {
        expect(() =>
            applySinging(
                project(),
                {
                    lines: [
                        {
                            line: 1,
                            singers: [],
                            parts: [
                                {from: 0, singers: ['ann']},
                                {from: 1, singers: ['ben']},
                            ],
                        },
                    ],
                },
                requests,
            ),
        ).toThrow('no word times')
    })
})
