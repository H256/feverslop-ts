import {describe, expect, test} from 'bun:test'
import {MAX_REFERENCE_IMAGES} from '../comfy/helpers.ts'
import {buildClipRequests, groupMemberId} from './compose.ts'
import type {Character, StoryBeat} from './project.ts'

const beat = {
    id: 'b1',
    order: 1,
    summary: 'The orcs charge.',
    moments: ['The orcs charge.'],
    locationId: 'pass',
    characterIds: ['orcs'],
    intensity: 0.8,
    weight: 1,
    kind: 'hit',
    stateAfter: [],
} as StoryBeat
const clipInput = (groupSize: number, characters: Character[], extra: string[] = [], index = 0) => ({
    slots: [{id: 'slot-001', index, section: 'Verse', start: 0, end: 4, bars: 2, energy: 0.8, lyrics: []}],
    mapping: [{slotId: 'slot-001', beatId: 'b1'}],
    beats: [{...beat, characterIds: ['orcs', ...extra], groupSize: {orcs: groupSize}}],
    characters,
    locations: [{id: 'pass', name: 'Pass'}],
    characterDescriptions: {orcs: 'an orc'},
    characterDescriptionVariants: {orcs: ['a scarred orc', 'a tall orc', 'a one-eyed orc']},
    locationDescriptions: {},
    lookBrief: '',
    music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.8, 0.8], sections: []},
    language: 'English',
    stemsAvailable: false,
})
const clip = (groupSize: number, characters: Character[], extra: string[] = [], index = 0) =>
    buildClipRequests(clipInput(groupSize, characters, extra, index))[0]!

describe('group members together in one shot (#9)', () => {
    const orcs: Character = {id: 'orcs', name: 'Orcs', role: 'raiders', isGroup: true}
    test('a beat that shows three of a group binds three different member pictures, each with its own description', () => {
        const c = clip(3, [orcs])
        const members = c.assets.pictures.filter(p => p.id === 'orcs')
        expect(members.map(p => p.file)).toEqual([0, 1, 2].map(m => `assets/characters/${groupMemberId('orcs', m)}.png`))
        expect(members.map(p => p.description)).toEqual(['a scarred orc', 'a tall orc', 'a one-eyed orc'])
        expect(c.prompt).toContain(
            '<Subject 2> is Orcs, a group of 3 different individuals (<Subject 2> is the one in <Picture 2>, <Subject 3> the one in <Picture 3> and <Subject 4> the one in <Picture 4>; there are 3 of them in all, never more)',
        )
        expect(c.prompt).toContain('<Subject 3> is another one of Orcs (the group <Subject 2>), the individual in <Picture 3>')
        expect(c.prompt).toContain('with <Subject 3> and <Subject 4> beside them - 2 more of the Orcs, each the one in their own picture')
        expect(c.prompt).toMatch(/<Subject 4> \(appears in \[Shot 1\]/)
    })
    test('the members rotate with the clip, the group subject keeps the clip’s own member', () => {
        const files = clip(2, [orcs], [], 1)
            .assets.pictures.filter(p => p.id === 'orcs')
            .map(p => p.file)
        expect(files).toEqual([1, 0].map(m => `assets/characters/${groupMemberId('orcs', m)}.png`))
    })
    test('one of them at a time, or a species of one look, stays one subject', () => {
        expect(clip(1, [orcs]).assets.pictures.filter(p => p.id === 'orcs')).toHaveLength(1)
        expect(clip(3, [{...orcs, alike: true}]).assets.pictures.filter(p => p.id === 'orcs')).toHaveLength(1)
    })
    test('the members only take the picture slots left over - nobody else gives way for them', () => {
        const others: Character[] = Array.from({length: MAX_REFERENCE_IMAGES - 3}, (_, i) => ({id: `p${i}`, name: `P${i}`, role: 'fighter'}))
        const c = clip(
            3,
            [orcs, ...others],
            others.map(o => o.id),
        )
        expect(c.assets.pictures).toHaveLength(MAX_REFERENCE_IMAGES)
        expect(c.assets.pictures.filter(p => p.id === 'orcs')).toHaveLength(2)
        expect(c.dropped).toBeUndefined()
        // the third member has no picture left: it is said in words, the first sentence of its description
        expect(c.prompt).toContain('another face, hair, build and clothing; among the others are a one-eyed orc; there are 3 of them')
    })
    // tides-261115, slot-014: one picture, one person described and "keep their face from the picture" - 20 copies of her
    test('a crowd with one picture: the others in words, and only the clothing kept from the picture', () => {
        const words = {orcs: ['A scarred orc with a shaved head. He wears a black cloak.', 'A tall orc with braids. She wears a black cloak.']}
        const others: Character[] = Array.from({length: MAX_REFERENCE_IMAGES - 2}, (_, i) => ({id: `p${i}`, name: `P${i}`, role: 'fighter'}))
        const c = buildClipRequests({
            ...clipInput(
                20,
                [orcs, ...others],
                others.map(o => o.id),
            ),
            characterDescriptionVariants: words,
        })[0]!
        expect(c.assets.pictures.filter(p => p.id === 'orcs')).toHaveLength(1)
        expect(c.prompt).toContain('share only the general style of the group; among the others are a tall orc with braids; there are 20 of them')
        expect(c.prompt).toContain('keep the style and colors of their clothing from the picture, each with a face, hair and build of their own')
        expect(clip(3, [{...orcs, alike: true}]).prompt).toContain('keep their build, skin, face, costume and colors from the picture')
    })
})
