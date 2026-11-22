import {describe, expect, test} from 'bun:test'
import type {ClipRequest} from './compose.ts'
import type {Character, ShotPlan} from './project.ts'
import {startFrameRequests} from './startframe-prompt.ts'
import {startFrameSize} from './render/startframes.ts'

// tides-261115 slot-033: a wide shot over the crowd with the band beyond it, then a medium shot of three players
const characters: Character[] = [
    {id: 'maren', name: 'Maren', role: 'the singer'},
    {id: 'kael', name: 'Kael', role: 'guitarist', prop: 'black guitar'},
    {id: 'vex', name: 'Vex', role: 'drummer', prop: 'coral drum kit', propCarried: false},
    {id: 'crowd', name: 'The audience', role: 'spectators', isGroup: true},
]
const picture = (kind: 'character' | 'location' | 'prop', id: string, name: string, file = `assets/${kind}s/${id}.png`) => ({
    label: '',
    file,
    subject: '',
    kind,
    id,
    name,
    description: `${name}, described.`,
})
const wide: ShotPlan = {
    action: '{Maren} sings.',
    view: 'from behind The audience, over their heads toward the stage',
    size: 'wide',
    characters: ['maren', 'kael', 'vex', 'crowd'],
    people: {
        maren: {state: 'on the stage, arms raised', frame: 'centre of the stage', singing: true},
        kael: {state: "at {Maren}'s left", frame: 'left of centre on the stage'},
        crowd: {state: 'packed in the nave', frame: 'at the bottom, backs to the camera'},
    },
}
const medium: ShotPlan = {
    action: '{Kael} plays.',
    view: 'from the front of the stage',
    size: 'medium',
    characters: ['kael'],
    people: {kael: {state: 'on the stage'}},
}
const clip = {
    id: 'slot-033',
    shots: [
        {label: '[Shot 1]', at: 0, framing: 'wide shot', camera: 'slow pan', subjects: [], plan: wide},
        {label: '[Shot 2]', at: 2, framing: 'medium shot', camera: 'hold', subjects: [], plan: medium},
        // a shot from a plan without people: no start picture
        {label: '[Shot 3]', at: 4, framing: 'wide shot', camera: 'hold', subjects: [], plan: {action: 'The light peaks.'}},
    ],
    assets: {
        pictures: [
            picture('location', 'hall', 'The hall', 'assets/sequence/locations/hall/frames/frame_02.png'),
            picture('character', 'maren', 'Maren'),
            picture('character', 'kael', 'Kael'),
            picture('character', 'vex', 'Vex'),
            picture('character', 'crowd', 'The audience', 'assets/characters/crowd-v2.png'),
            picture('prop', 'black-guitar', 'black guitar'),
            picture('prop', 'coral-drum-kit', 'coral drum kit'),
        ],
        audio: [],
    },
} as unknown as Pick<ClipRequest, 'id' | 'shots' | 'assets'>
const requests = startFrameRequests({
    clip,
    characters,
    look: 'Live-action fantasy, golden light.',
    set: {stage: 'In front of the throne.', spots: {Vex: 'The kit stands at the throne wall.', Nobody: 'Elsewhere.'}},
    megapixels: () => 1,
})

describe('the start pictures of a clip', () => {
    test('one per shot with people, at the shot, with only the pictures it needs, numbered in order', () => {
        expect(requests.map(r => [r.shot, r.at])).toEqual([
            [0, 0],
            [1, 2],
        ])
        expect(requests[0]!.pictures.map(p => `${p.label} ${p.id}`)).toEqual([
            '<Picture 1> hall',
            '<Picture 2> maren',
            '<Picture 3> kael',
            '<Picture 4> vex',
            '<Picture 5> crowd',
            '<Picture 6> black-guitar',
            '<Picture 7> coral-drum-kit',
        ])
        expect(requests[1]!.pictures.map(p => `${p.label} ${p.id}`)).toEqual(['<Picture 1> hall', '<Picture 2> kael', '<Picture 3> black-guitar'])
    })

    test('the frame first, then everybody once with their words, their prop and their mouth; names instead of tokens', () => {
        const prompt = requests[0]!.prompt
        // the medium comes from the look alone - no film still, no photograph of our own
        expect(prompt.split('\n')[0]).toBe(
            'One frame of the film itself, 16:9, made in exactly the medium and look it is filmed in: Live-action fantasy, golden light. Nothing more painted, polished or dramatic than that look says.',
        )
        expect(prompt).toContain('The place is The hall of <Picture 1>, kept as it is there')
        expect(prompt).toContain('The stage: In front of the throne. Fixed places: Vex: The kit stands at the throne wall.')
        expect(prompt).not.toContain('Nobody')
        expect(prompt).toContain('The camera: from behind The audience, over their heads toward the stage; wide shot.')
        expect(prompt).toContain('- Maren, the person of <Picture 2>: on the stage, arms raised; in the picture: centre of the stage; singing, mouth open.')
        expect(prompt).toContain(
            "- Kael, the person of <Picture 3>, with the black guitar of <Picture 6>: at Maren's left; in the picture: left of centre on the stage; mouth closed.",
        )
        // a standing instrument: the player is at it, not holding it
        expect(prompt).toContain('- Vex, the person of <Picture 4>, at the coral drum kit of <Picture 7>; mouth closed.')
        expect(prompt).toContain('- The audience: a crowd of different people - <Picture 5> shows one of them')
    })

    // slot-028: told the band in its places, the singer stood among the crowd - the crowd first, the band far beyond it
    test('a crowd with the band: the crowd nearest with its back to the camera, the band small on the stage beyond it', () => {
        expect(requests[0]!.prompt).toContain(
            'The audience are nearest to the camera with their backs to it, facing the band; far beyond them, small on the stage, Maren, Kael, Vex - nobody of the band is among The audience or near the camera.',
        )
        expect(requests[0]!.prompt).toContain('In the picture, each exactly once:')
        expect(requests[1]!.prompt).toContain('In the picture, each exactly once, nobody else:')
        expect(requests[1]!.prompt).not.toContain('far beyond')
    })
})

// nine reference pictures (about 15 MP) ran the 32 GB Radeon out of memory in the text encoder, six (9.6 MP) went through
test('over the budget of reference pictures the props go first, drawn from their words then', () => {
    const [wide] = startFrameRequests({clip, characters, look: '', megapixels: p => (p.kind === 'prop' ? 1 : 1.9)})
    // a place and four people: 9.5 MP, room for no prop
    expect(wide!.pictures.map(p => p.kind)).toEqual(['location', 'character', 'character', 'character', 'character'])
    expect(wide!.megapixels).toBe(9.5)
    expect(wide!.prompt).toContain('- Kael, the person of <Picture 3>, with the black guitar: ')
    expect(wide!.prompt).toContain('- Vex, the person of <Picture 4>, at the coral drum kit; mouth closed.')
})

test('the size of a start picture: about 2.4 MP in the video aspect, on a 32 px grid', () => {
    expect(startFrameSize('16:9')).toEqual({width: 2048, height: 1152})
    expect(startFrameSize('9:16')).toEqual({width: 1152, height: 2048})
    expect(startFrameSize('1:1')).toEqual({width: 1536, height: 1536})
})
