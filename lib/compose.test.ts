import {describe, expect, test} from "bun:test";
import {buildClipRequests, type Input} from "./compose.ts";
import type {Character, StoryBeat} from "./project.ts";

const characters: Character[] = [
    {id: 'shaman', name: 'Shaman', role: 'drummer'},
    {id: 'runa', name: 'Runa', role: 'cat'},
]
const beat = {id: 'b1', order: 1, summary: 'The Shaman drums.', moments: ['The Shaman drums.'], locationId: 'clearing', characterIds: ['shaman'], intensity: 0.5, weight: 1, kind: 'build', stateAfter: []} as StoryBeat

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
    const fight = {id: 'b9', order: 1, summary: 'Seven hammers swing against a dozen Orcs. Greta, Mira and Kael sing.', moments: [], locationId: 'cave', characterIds: ['greta', 'mira', 'kael', 'orcs'], intensity: 0.9, weight: 1, kind: 'hit', stateAfter: ['Kael is bleeding'], continuous: false} as unknown as StoryBeat
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
        shotMoments: {b9: {staging: 'Greta stands in front, Mira and Kael behind her in a file.', shots: [{action: 'Greta drives her hammer into the Orcs.', characters: ['greta', 'orcs'], rest: 'Mira parries an orc, Kael shoves another back.'}]}},
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
        expect(clip.prompt).toContain('Layout of the place: <Subject 3> sits by the fire pit.')
    })
    test('a token that is nobody of the cast is left as its word, without braces', () => {
        const clip = buildClipRequests(input('{Shaman} nods to {the stranger}.'))[0]!
        expect(clip.prompt).toContain('<Subject 2> nods to the stranger.')
    })
})
