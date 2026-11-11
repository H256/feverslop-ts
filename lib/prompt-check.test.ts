import {describe, expect, test} from 'bun:test'
import {checkPrompt, checkPrompts, LONG_PROMPT} from './prompt-check.ts'

const assets = {
    pictures: [
        {label: '<Picture 1>', subject: '<Subject 1>'},
        {label: '<Picture 2>', subject: '<Subject 2>'},
    ],
    audio: [{label: '<Audio 1>'}],
}
const good = `subject_definitions:
<Subject 1> is the empty rooms environment in <Picture 1>: a room.
<Subject 2> is Elias, the character in <Picture 2>.
<Audio 1> is the isolated lead vocal.

detailed_description:
[Shot 1] A medium shot of <Subject 2> in <Subject 1>; slow push in. From 00:00.321 to 00:03.207, <Subject 2> (S1) sings <d>[German] Nimm mich mit mit mit.</d> while he walks.
[Shot 2] At 00:03.398, the shot cuts to a close-up of <Subject 2>; locked off.`

describe('the check of a composed prompt', () => {
    test('a prompt as it should be has no finding - repeated words of the lyrics are the song’s', () => {
        expect(checkPrompt({id: 'slot-007', prompt: good, duration: 7.4, assets})).toEqual([])
    })
    test('a word twice in a row', () => {
        expect(checkPrompt({id: 'a', prompt: good.replace('is the empty rooms', 'is the the empty rooms'), assets})).toEqual([
            'a word twice in a row: "the the"',
        ])
    })
    test('an empty part between two joins', () => {
        expect(checkPrompt({id: 'a', prompt: good.replace('; slow push in.', '; ; slow push in.'), assets})[0]).toContain('an empty part')
    })
    test('a label without a picture, and a picture without a mention', () => {
        expect(checkPrompt({id: 'a', prompt: good + ' <Subject 3> waits.', assets})).toEqual(['named but not given to the clip: <Subject 3>'])
        expect(checkPrompt({id: 'a', prompt: good, assets: {...assets, audio: [...assets.audio, {label: '<Audio 2>'}]}})).toEqual([
            'given to the clip but never named: <Audio 2>',
        ])
    })
    test('shots out of order or after the end', () => {
        expect(checkPrompt({id: 'a', prompt: good, duration: 3, assets})).toEqual(['[Shot 2] cuts in after the clip has ended'])
        const twice = good + '\n[Shot 3] At 00:02.000, the shot cuts to a wide shot of <Subject 1>.'
        expect(checkPrompt({id: 'a', prompt: twice, assets})).toEqual(['[Shot 3] cuts in before [Shot 2] has begun'])
    })
    test('a long prompt is said with its length', () => {
        const long = good + ' ' + 'x'.repeat(LONG_PROMPT)
        expect(checkPrompt({id: 'a', prompt: long, assets}).at(-1)).toBe(`${long.length} characters long`)
    })
    test('all clips, each finding with its clip', () => {
        expect(
            checkPrompts([
                {id: 'slot-001', prompt: good, assets},
                {id: 'slot-002', prompt: 'A shot of of the hall.'},
            ]),
        ).toEqual(['slot-002: a word twice in a row: "of of"'])
    })
})
