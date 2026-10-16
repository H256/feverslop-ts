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
