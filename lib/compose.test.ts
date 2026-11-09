import {describe, expect, test} from 'bun:test'
import {buildClipRequests, type Input, layoutLine, singingPerBeat} from './compose.ts'
import type {Character, StoryBeat} from './project.ts'
import {slotVocals} from './lyrics.ts'

const characters: Character[] = [
    {id: 'shaman', name: 'Shaman', role: 'drummer'},
    {id: 'runa', name: 'Runa', role: 'cat'},
]
const beat = {
    id: 'b1',
    order: 1,
    summary: 'The Shaman drums.',
    moments: ['The Shaman drums.'],
    locationId: 'clearing',
    characterIds: ['shaman'],
    intensity: 0.5,
    weight: 1,
    kind: 'build',
    stateAfter: [],
} as StoryBeat

test('a split word reaches two final prompts without a false stop before its continuation', () => {
    const words = [
        {text: 'Rosma', start: 3, end: 4},
        {text: 'rienbaum.', joined: true, start: 4, end: 5.9},
    ]
    const lyricsTiming = {lines: [{line: 0, sectionIndex: 0, section: 'Verse', text: 'Rosmarienbaum.', start: 3, end: 5.9, words, confidence: 1}]}
    const slots = [0, 4].map((start, index) => ({
        id: `slot-${index}`,
        index,
        section: 'Verse',
        start,
        end: start + 4,
        bars: 2,
        energy: 0.5,
        lyrics: [],
        vocals: slotVocals({start, end: start + 4}, lyricsTiming),
    }))
    const input: Input = {
        slots,
        mapping: slots.map(s => ({slotId: s.id, beatId: 'b1'})),
        beats: [beat],
        characters,
        locations: [{id: 'clearing', name: 'Clearing'}],
        characterDescriptions: {shaman: 'A singer.'},
        locationDescriptions: {clearing: 'A clearing.'},
        lookBrief: '',
        music: {bpm: 120, durationSec: 8, downbeats: [0, 2, 4, 6], barEnergy: [0.5, 0.5, 0.5, 0.5], sections: []},
        language: 'German',
        stemsAvailable: true,
        singing: {singers: ['shaman'], lines: [{line: 0, text: 'Rosmarienbaum.', singers: ['shaman']}]},
        lyricsTiming,
        shotMoments: {b1: {shots: [{action: 'The Shaman sings.', characters: ['shaman']}]}},
    }
    const [head, tail] = buildClipRequests(input)
    expect([head, tail].map(clip => ({prompt: clip!.prompt, assets: clip!.assets, startsFrom: clip!.startsFrom}))).toMatchSnapshot(
        'music composition: split lyrics, cast, audio and continuation (#658)',
    )
    expect(head!.prompt).toContain('<d>[German] Rosma-</d>')
    expect(tail!.prompt).toContain('<d>[German] -rienbaum.</d>')
    expect(tail!.vocals![0]!.at).toBe(0)
    expect(tail!.prompt).toContain('only actually sings from 00:04.000')
})

function clipFor(shotCharacters: string[][]) {
    const input: Input = {
        slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 4, bars: 2, energy: 0.5, lyrics: []}],
        mapping: [{slotId: 'slot-001', beatId: 'b1'}],
        beats: [beat],
        characters,
        locations: [{id: 'clearing', name: 'Clearing'}],
        characterDescriptions: {shaman: 'A stocky shaman.', runa: 'A small grey cat.'},
        locationDescriptions: {clearing: 'A forest clearing.'},
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.5, 0.5], sections: []},
        language: 'English',
        stemsAvailable: false,
        shotMoments: {b1: {shots: shotCharacters.map(c => ({action: 'The Shaman drums.', characters: c}))}},
    }
    return buildClipRequests(input)[0]!
}

describe('buildClipRequests cast', () => {
    test('a character a shot shows gets its picture although the beat forgot it', () => {
        const pictures = clipFor([['shaman', 'runa'], ['shaman']]).assets.pictures
        expect(pictures.map(p => p.id)).toEqual(['clearing', 'shaman', 'runa'])
    })

    test('a character in the beat and in the shots is one picture', () => {
        const pictures = clipFor([['shaman'], ['shaman']]).assets.pictures
        expect(pictures.map(p => p.id)).toEqual(['clearing', 'shaman'])
    })
})

describe('buildClipRequests cast, characters the text names', () => {
    const earlier = {...beat, id: 'b0', order: 0, characterIds: ['shaman', 'runa'], stateAfter: ['Runa sits at the fire']} as StoryBeat
    const input = (staging: string | undefined, beats: StoryBeat[]): Input => ({
        slots: beats.map((b, n) => ({id: `slot-00${n + 1}`, index: n, section: 'A', start: n * 4, end: n * 4 + 4, bars: 2, energy: 0.5, lyrics: []})),
        mapping: beats.map((b, n) => ({slotId: `slot-00${n + 1}`, beatId: b.id})),
        beats,
        characters,
        locations: [{id: 'clearing', name: 'Clearing'}],
        characterDescriptions: {shaman: 'A stocky shaman.', runa: 'A small grey cat.'},
        locationDescriptions: {clearing: 'A forest clearing.'},
        lookBrief: '',
        music: {bpm: 120, durationSec: 8, downbeats: [0, 2, 4, 6], barEnergy: [0.5, 0.5, 0.5, 0.5], sections: []},
        language: 'English',
        stemsAvailable: false,
        shotMoments: {b1: {staging, shots: [{action: 'The Shaman drums.', characters: ['shaman']}]}},
    })

    test('the layout of the place names a character: the picture is a reference', () => {
        const clip = buildClipRequests(input('Runa steps from the tree line.', [beat]))[0]!
        expect(clip.assets.pictures.map(p => p.id)).toEqual(['clearing', 'shaman', 'runa'])
    })

    test('a continuity fact names a character: the picture is a reference', () => {
        const clip = buildClipRequests(input(undefined, [earlier, beat]))[1]!
        expect(clip.assets.pictures.map(p => p.id)).toEqual(['clearing', 'shaman', 'runa'])
    })

    test('nobody named, nobody added', () => {
        const clip = buildClipRequests(input('The shaman stands by the fire.', [beat]))[0]!
        expect(clip.assets.pictures.map(p => p.id)).toEqual(['clearing', 'shaman'])
    })
})

describe('a piece of a fight clip names only the people it has pictures for', () => {
    const party: Character[] = [
        {id: 'greta', name: 'Greta', role: 'leader'},
        {id: 'mira', name: 'Mira', role: 'youngest'},
        {id: 'kael', name: 'Kael', role: 'warrior'},
        {id: 'orcs', name: 'Orcs', role: 'crowd', isGroup: true, alike: true},
    ]
    const fight = {
        id: 'b9',
        order: 1,
        summary: 'Seven hammers swing against a dozen Orcs. Greta, Mira and Kael sing.',
        moments: [],
        locationId: 'cave',
        characterIds: ['greta', 'mira', 'kael', 'orcs'],
        intensity: 0.9,
        weight: 1,
        kind: 'hit',
        stateAfter: ['Kael is bleeding'],
        continuous: false,
    } as unknown as StoryBeat
    const input = (micro: boolean): Input => ({
        slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 2, bars: 1, energy: 0.8, lyrics: [], ...(micro ? {micro: true} : {})}],
        mapping: [{slotId: 'slot-001', beatId: 'b9'}],
        beats: [fight],
        characters: party,
        locations: [{id: 'cave', name: 'Cave'}],
        characterDescriptions: {greta: 'An old woman.', mira: 'A young woman.', kael: 'A tall woman.', orcs: 'A stocky orc.'},
        locationDescriptions: {cave: 'A blue-stone cave.'},
        lookBrief: '',
        music: {bpm: 120, durationSec: 2, downbeats: [0], barEnergy: [0.8], sections: []},
        language: 'English',
        stemsAvailable: false,
        shotMoments: {
            b9: {
                staging: 'Greta stands in front, Mira and Kael behind her in a file.',
                shots: [
                    {action: 'Greta drives her hammer into the Orcs.', characters: ['greta', 'orcs'], rest: 'Mira parries an orc, Kael shoves another back.'},
                ],
            },
        },
    })

    test('the summary is the shot, no layout, no rest, no fact about somebody without a picture', () => {
        const clip = buildClipRequests(input(true))[0]!
        expect(clip.assets.pictures.map(p => p.id)).toEqual(['cave', 'greta', 'orcs'])
        const text = clip.prompt
        expect(text).toContain('<Subject 2> drives her hammer into the <Subject 3>.')
        expect(text).not.toContain('Seven hammers')
        expect(text).not.toContain('Layout of the place')
        expect(text).not.toMatch(/Mira|Kael/)
    })
    test('a normal clip of the same beat is unchanged: summary and layout name everybody', () => {
        const clip = buildClipRequests(input(false))[0]!
        expect(clip.prompt).toContain('Seven hammers swing')
        expect(clip.prompt).toContain('Layout of the place')
    })
})

describe('the background of the place', () => {
    const input = (anchors: Record<string, string> | undefined, beats: StoryBeat[]): Input => ({
        slots: beats.map((b, n) => ({id: `slot-00${n + 1}`, index: n, section: 'A', start: n * 4, end: n * 4 + 4, bars: 2, energy: 0.5, lyrics: []})),
        mapping: beats.map((b, n) => ({slotId: `slot-00${n + 1}`, beatId: b.id})),
        beats,
        characters,
        locations: [{id: 'clearing', name: 'Clearing'}],
        characterDescriptions: {shaman: 'A stocky shaman.', runa: 'A small grey cat.'},
        locationDescriptions: {clearing: 'A forest clearing, tall pines, a fire pit. Moss on the stones.'},
        locationAnchors: anchors,
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.5, 0.5], sections: []},
        language: 'English',
        stemsAvailable: false,
    })

    test('the phrase of the place stands behind the people, as written', () => {
        const clip = buildClipRequests(input({clearing: 'the tall pines and the fire pit'}, [beat]))[0]!
        expect(clip.prompt).toContain('Behind them: the tall pines and the fire pit.')
        expect(clip.prompt).not.toContain('still visible behind them')
    })
    test('no phrase: no background sentence, and no piece of the description', () => {
        const clip = buildClipRequests(input(undefined, [beat]))[0]!
        expect(clip.prompt).not.toContain('Behind them')
        expect(clip.prompt).not.toContain('still visible behind them')
    })
    describe('a close-up of one person has nobody else in it', () => {
        const shotOf = (size: 'wide' | 'medium' | 'close' | 'extreme', characters: string[], anchors?: Record<string, string>) =>
            buildClipRequests({...input(anchors, [beat]), shotMoments: {b1: {shots: [{action: 'The Shaman drums.', characters, size}]}}})[0]!.prompt
        const anchor = {clearing: 'the tall pines and the fire pit'}
        test('close and extreme: the background names the one person and says nobody else is there', () => {
            for (const size of ['close', 'extreme'] as const) {
                const prompt = shotOf(size, ['shaman'], anchor)
                expect(prompt).toContain('Behind <Subject 2>, out of focus: the tall pines and the fire pit; no other person is in the frame.')
                // only the shot with the plan: the clip's second shot has none and is as it was
                expect(prompt.match(/no other person/g)).toHaveLength(1)
            }
        })
        test('without a phrase of the place the sentence stands alone', () => {
            expect(shotOf('extreme', ['shaman'])).toContain('No other person is in the frame.')
        })
        test('a wide or medium shot keeps "Behind them" - the others of the scene may stand there', () => {
            for (const size of ['wide', 'medium'] as const) {
                const prompt = shotOf(size, ['shaman'], anchor)
                expect(prompt).toContain('Behind them: the tall pines and the fire pit.')
                expect(prompt).not.toContain('no other person')
            }
        })
        test('two people in a close-up are not alone', () => {
            const prompt = shotOf('close', ['shaman', 'runa'], anchor)
            expect(prompt).toContain('Behind them: the tall pines and the fire pit.')
            expect(prompt).not.toContain('no other person')
        })
        test('a shot without a size, from a plan made before it, is as it was', () => {
            const prompt = buildClipRequests({
                ...input(anchor, [beat]),
                shotMoments: {b1: {shots: [{action: 'The Shaman drums.', characters: ['shaman']}]}},
            })[0]!.prompt
            expect(prompt).toContain('Behind them: the tall pines and the fire pit.')
        })
    })
    test('a continuing clip with one person says "is"', () => {
        const clips = buildClipRequests(input(undefined, [beat, beat]))
        expect(clips[1]!.prompt).toContain('<Subject 2> is already present')
    })
})

describe('more people than reference pictures', () => {
    const crowd: Character[] = Array.from({length: 10}, (_, n) => ({id: `p${n}`, name: `P${n}`, role: 'villager'}))
    const input = (count: number): Input => ({
        slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 4, bars: 2, energy: 0.5, lyrics: []}],
        mapping: [{slotId: 'slot-001', beatId: 'b1'}],
        beats: [{...beat, characterIds: crowd.slice(0, count).map(c => c.id)}],
        characters: crowd,
        locations: [{id: 'clearing', name: 'Clearing'}],
        characterDescriptions: Object.fromEntries(crowd.map(c => [c.id, 'A villager.'])),
        locationDescriptions: {clearing: 'A forest clearing.'},
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.5, 0.5], sections: []},
        language: 'English',
        stemsAvailable: false,
    })

    test('whoever does not fit is listed as dropped', () => {
        const clip = buildClipRequests(input(10))[0]!
        expect(clip.assets.pictures).toHaveLength(9)
        expect(clip.dropped).toEqual(['p8', 'p9'])
    })
    test('a clip where everybody fits has no dropped list', () => {
        expect(buildClipRequests(input(8))[0]!.dropped).toBeUndefined()
    })
})

describe('{Name} tokens', () => {
    const tokenBeat = {...beat, summary: '{Shaman} drums for {Runa}.', moments: ['{Shaman} drums.'], tokens: true} as StoryBeat
    const input = (action: string, staging?: string): Input => ({
        slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 4, bars: 2, energy: 0.5, lyrics: []}],
        mapping: [{slotId: 'slot-001', beatId: 'b1'}],
        beats: [tokenBeat],
        characters,
        locations: [{id: 'clearing', name: 'Clearing'}],
        characterDescriptions: {shaman: 'A stocky shaman.', runa: 'A small grey cat.'},
        locationDescriptions: {clearing: 'A forest clearing.'},
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.5, 0.5], sections: []},
        language: 'English',
        stemsAvailable: false,
        shotMoments: {b1: {tokens: true, ...(staging ? {staging} : {}), shots: [{action, characters: ['shaman']}]}},
    })

    test('a token is the label of its picture, a plain name stays a word', () => {
        const clip = buildClipRequests(input('{Shaman} beats the drum while the shaman hums.'))[0]!
        expect(clip.prompt).toContain('<Subject 2> beats the drum while the shaman hums.')
        expect(clip.prompt).not.toContain('{')
    })
    test('a character the layout names by token is in the clip with its picture', () => {
        const clip = buildClipRequests(input('{Shaman} drums.', '{Runa} sits by the fire pit.'))[0]!
        expect(clip.assets.pictures.map(p => p.id)).toEqual(['clearing', 'shaman', 'runa'])
        expect(clip.prompt).toContain(
            'Layout of the place when the scene begins - a floor plan, not a shot of its own; the clip opens on [Shot 1]: <Subject 3> sits by the fire pit.',
        )
    })
    test('a token that is nobody of the cast is left as its word, without braces', () => {
        const clip = buildClipRequests(input('{Shaman} nods to {the stranger}.'))[0]!
        expect(clip.prompt).toContain('<Subject 2> nods to the stranger.')
    })
})

describe('a fact goes with whom it is about, or stays at its place', () => {
    const at = (id: string, locationId: string, characterIds: string[], stateAfter: StoryBeat['stateAfter'] = []) =>
        ({...beat, id, locationId, characterIds, summary: 'x', moments: ['x'], stateAfter, tokens: true}) as StoryBeat
    const beats = [
        at(
            'b1',
            'forge',
            ['shaman'],
            [
                {fact: "{Shaman}'s drum is torn", place: false},
                {fact: 'the fire burns low', place: true},
            ],
        ),
        at('b2', 'clearing', ['shaman']),
        at('b3', 'forge', ['runa']),
    ]
    const clips = buildClipRequests({
        slots: beats.map((b, n) => ({id: `slot-00${n + 1}`, index: n, section: 'A', start: n * 4, end: n * 4 + 4, bars: 2, energy: 0.5, lyrics: []})),
        mapping: beats.map((b, n) => ({slotId: `slot-00${n + 1}`, beatId: b.id})),
        beats,
        characters,
        locations: [
            {id: 'forge', name: 'Forge'},
            {id: 'clearing', name: 'Clearing'},
        ],
        characterDescriptions: {shaman: 'A stocky shaman.', runa: 'A small grey cat.'},
        locationDescriptions: {forge: 'A forge.', clearing: 'A clearing.'},
        lookBrief: '',
        music: {bpm: 120, durationSec: 12, downbeats: [0, 2, 4, 6, 8, 10], barEnergy: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], sections: []},
        language: 'English',
        stemsAvailable: false,
    })

    test('the fact about the shaman comes with the shaman to another place, the fact of the forge stays there', () => {
        expect(clips[1]!.prompt).toContain("Continuity from earlier scenes: <Subject 2>'s drum is torn.")
        expect(clips[1]!.prompt).not.toContain('the fire burns low')
    })
    test('back at the forge without the shaman: the fire, not the drum', () => {
        expect(clips[2]!.prompt).toContain('Continuity from earlier scenes: the fire burns low.')
        expect(clips[2]!.prompt).not.toContain('drum is torn')
    })
})

describe('singingPerBeat', () => {
    test('per shot, the singers of the lines sung in it - not all singers of the beat', () => {
        const beat = {
            id: 'b1',
            order: 1,
            summary: 's',
            moments: ['m'],
            locationId: 'hall',
            characterIds: ['lead', 'band'],
            intensity: 0.5,
            weight: 1,
            kind: 'build',
            stateAfter: [],
        } as StoryBeat
        const slot = {
            id: 'slot-001',
            index: 0,
            section: 'Verse',
            start: 0,
            end: 8,
            bars: 4,
            energy: 0.3,
            lyrics: [],
            vocals: [
                {line: 0, text: 'a verse line', start: 0.2, end: 3.5, words: []},
                {line: 1, text: 'a refrain line', start: 4.2, end: 7.8, words: []},
            ],
        }
        const singing = {
            singers: ['lead', 'band'],
            lines: [
                {line: 0, text: 'a verse line', singers: ['lead']},
                {line: 1, text: 'a refrain line', singers: ['lead', 'band']},
            ],
        }
        const result = singingPerBeat({slots: [slot], mapping: [{slotId: 'slot-001', beatId: 'b1'}], beats: [beat], singing})
        const shots = result.b1!.singersPerShot
        expect(shots.length).toBeGreaterThanOrEqual(2)
        expect(shots[0]).toEqual(['lead'])
        expect(shots.at(-1)).toEqual(['lead', 'band'])
    })

    test('a line whose singer changes within it: each shot has the singer of the words sung in it', () => {
        const beat = {
            id: 'b1',
            order: 1,
            summary: 's',
            moments: ['m'],
            locationId: 'hall',
            characterIds: ['ann', 'ben'],
            intensity: 0.5,
            weight: 1,
            kind: 'build',
            stateAfter: [],
        } as StoryBeat
        // one line over the whole clip: Ann sings its first four words (0.2-3.5 s), Ben the last four (4.2-7.8 s)
        const words = Array.from({length: 8}, (_, n) => ({
            text: `w${n}`,
            start: n < 4 ? 0.2 + n * 0.8 : 4.2 + (n - 4) * 0.9,
            end: n < 4 ? 0.9 + n * 0.8 : 4.9 + (n - 4) * 0.9,
        }))
        const slot = {
            id: 'slot-001',
            index: 0,
            section: 'Verse',
            start: 0,
            end: 8,
            bars: 4,
            energy: 0.3,
            lyrics: [],
            vocals: [{line: 0, text: words.map(w => w.text).join(' '), start: 0.2, end: 7.8, words}],
        }
        const lyricsTiming = {lines: [{line: 0, sectionIndex: 0, section: 'Verse', text: slot.vocals[0]!.text, start: 0.2, end: 7.8, words, confidence: 1}]}
        const singing = {
            singers: ['ann', 'ben'],
            lines: [
                {
                    line: 0,
                    text: slot.vocals[0]!.text,
                    singers: ['ann', 'ben'],
                    parts: [
                        {from: 0, singers: ['ann']},
                        {from: 4, singers: ['ben']},
                    ],
                },
            ],
        }
        const shots = singingPerBeat({slots: [slot], mapping: [{slotId: 'slot-001', beatId: 'b1'}], beats: [beat], singing, lyricsTiming}).b1!.singersPerShot
        expect(shots[0]).toEqual(['ann'])
        expect(shots.at(-1)).toEqual(['ben'])
        // without the word times the whole line is sung by both, in every shot
        expect(singingPerBeat({slots: [slot], mapping: [{slotId: 'slot-001', beatId: 'b1'}], beats: [beat], singing}).b1!.singersPerShot.at(-1)).toEqual([
            'ann',
            'ben',
        ])
    })
})

// #740: the layout is a floor plan, never a shot of its own - read as one, the clip opened on it before [Shot 1]
describe('the layout of the place', () => {
    test('where the scene opens: the staging, as where everyone is then, and the clip opens on [Shot 1]', () => {
        expect(layoutLine(true, 'Elias walks down the corridor.', 'A long corridor.')).toBe(
            'Layout of the place when the scene begins - a floor plan, not a shot of its own; the clip opens on [Shot 1]: Elias walks down the corridor.',
        )
    })
    test('a later clip of the scene: the floor plan of the place without people - or the staging said to be from before', () => {
        expect(layoutLine(false, 'Elias walks down the corridor.', 'A long corridor.')).toBe(
            'Layout of the place - a floor plan, not a shot of its own: A long corridor.',
        )
        expect(layoutLine(false, 'Elias walks down the corridor.', undefined)).toContain(
            'as the scene began - a floor plan, not a shot of its own; everyone is now where the shots below put them',
        )
    })
})
