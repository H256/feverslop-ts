import {describe, expect, test} from 'bun:test'
import type {StoryBeat} from './project.ts'
import {
    ALL_NEEDS,
    beatsPrompt,
    blockingPrompt,
    musicStretches,
    type PlanContext,
    plannerCalls,
    planInstructions,
    planInstructionsFor,
    planPrompt,
} from './shot-planner.ts'
import {PERSON_FIELDS, SHOT_FIELDS} from './shot-plan.ts'

const beat = {
    id: 'beat-01',
    order: 1,
    summary: 'Runa walks in.',
    moments: ['Runa walks in.'],
    locationId: 'hall',
    characterIds: ['runa'],
    intensity: 0.5,
    weight: 1,
    kind: 'build',
    stateAfter: [],
} as StoryBeat
const context: PlanContext = {
    characters: [{id: 'runa', name: 'Runa', role: 'a girl'}],
    locations: [{id: 'hall', name: 'Hall'}],
    characterDescriptions: {runa: 'A girl in a red coat.'},
    locationDescriptions: {hall: 'A long stone hall with one door on the left.'},
    continuity: 'never',
    slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 8, bars: 4, energy: 0.8, lyrics: []}],
    mapping: [{slotId: 'slot-001', beatId: 'beat-01'}],
    shotCounts: {'beat-01': 6},
    beatSinging: {},
}

describe('the shot planner prompt', () => {
    test('the instructions are the same for every call - which shots and the problems are at the end of the input', () => {
        const first = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        const second = planPrompt(context, [beat], undefined, undefined, ['shot 5: "Bob" is not one of the characters'], {
            from: 4,
            to: 6,
            total: 6,
            written: [{action: 'x'}],
            staging: 'A hall.',
        })
        expect(second.instructions).toBe(first.instructions)
        expect(first.input).toContain('This call writes ONLY shots 1 to 4 of the 6')
        expect(first.input).toContain('Write the STAGING line first.')
        expect(first.input).toContain('no ENDS block')
        expect(second.input).toContain('end with the ENDS block')
        expect(second.input).toEndWith('- shot 5: "Bob" is not one of the characters')
    })
})

describe('asked again: only the calls whose shots have a problem', () => {
    test('the first time every call is asked', () => {
        expect(plannerCalls(10, 4).map(c => [c.from, c.to, c.keep])).toEqual([
            [0, 4, false],
            [4, 8, false],
            [8, 10, false],
        ])
    })
    test('a problem in shot 6 asks the second call again, with only its problem', () => {
        const calls = plannerCalls(10, 4, {issues: [{shot: 5, message: 'shot 6: "Bob" is not one of the characters'}], previousShots: 10})
        expect(calls.map(c => c.keep)).toEqual([true, false, true])
        expect(calls[1]!.problems).toEqual(['shot 6: "Bob" is not one of the characters'])
    })
    test('a problem of the whole beat asks every call again', () => {
        const calls = plannerCalls(10, 4, {issues: [{message: 'shot count: needed 10, got 9'}], previousShots: 9})
        expect(calls.every(c => !c.keep && c.problems.length === 1)).toBe(true)
    })
})

describe('people walk forward, not backwards (#412)', () => {
    const {instructions} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
    test('a walk names its direction to the camera, and only a short one leads away from it with the face visible', () => {
        expect(instructions).toContain('gets the direction of the walk relative to THIS shot')
        expect(instructions).toContain('Nobody walks backwards unless the beat itself says so')
    })
    test('no example or rule tells people to step back', () => {
        expect(instructions).not.toMatch(/steps? back|gives a step back/)
        expect(blockingPrompt(context, beat, undefined, undefined).instructions).not.toMatch(/steps? back/)
    })
    test('layout directions are tied to the first view in the staging and the blocking rules', () => {
        expect(instructions).toContain('is fixed to the camera of its first view')
        expect(blockingPrompt(context, beat, undefined, undefined).instructions).toContain('is fixed to the camera of its first view')
    })
    // the blocking is "fixed, keep to it" for the shots: a drummer's start "her mouth open as she sings through the blows" came from a
    // beat's summary and went into every shot of the beat, sung from the first frame (tides-261115, a test re-plan)
    test('the start and the end of the blocking never have an open mouth', () => {
        expect(blockingPrompt(context, beat, undefined, undefined).instructions).toContain('never an open mouth, a dropped jaw, a shout or a scream')
    })
})

describe('the planner sees what the pictures show', () => {
    test('the descriptions of the place and of the people of the beat are in the input', () => {
        const {input} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(input).toContain('"hall":{"name":"Hall","description":"A long stone hall with one door on the left."}')
        expect(input).toContain('"Runa":"A girl in a red coat."')
    })
    test('the film look is in the input, and the framing follows it - not "everyone the beat has" (#333)', () => {
        const {input, instructions} = planPrompt({...context, filmLook: 'Dark night close-ups by firelight.'}, [beat], undefined, undefined, [], {
            from: 0,
            to: 4,
            total: 6,
            written: [],
        })
        expect(input).toContain(
            "film look (the director's style - the shot sizes, the camera and the light of the shots follow it): Dark night close-ups by firelight.",
        )
        expect(instructions).toContain('chosen by what the shot is about and by the "film look" in the input')
        expect(instructions).not.toContain('what can show everyone')
        // a project without a look brief plans as before, without the line
        expect(planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []}).input).not.toContain('film look')
    })
})

describe('the fixed layout of the place', () => {
    test('a place with a layout gives it to the planner; a place without one gives only its description', () => {
        const withLayout = planPrompt(
            {...context, locationLayouts: {hall: {layout: 'The door is on the left, the hearth at the back.', views: []}}},
            [beat],
            undefined,
            undefined,
            [],
            {from: 0, to: 4, total: 6, written: []},
        )
        expect(withLayout.input).toContain('"layout":"The door is on the left, the hearth at the back."')
        const without = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(without.input).not.toContain('"layout"')
        expect(withLayout.instructions).toBe(without.instructions)
    })
})

describe('the answer format and its parser', () => {
    test('every field the parser reads is asked for, and shown in the example shot', () => {
        const {instructions} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        const [spec, example] = instructions.split('One shot as it should be written')
        for (const part of [spec!, example!]) {
            for (const field of SHOT_FIELDS) expect(part).toMatch(new RegExp(`^${field}: `, 'm'))
            for (const field of PERSON_FIELDS) expect(part).toMatch(new RegExp(`^person: .*\\| ${field}: `, 'm'))
        }
    })
})

describe('the example shot', () => {
    test('one complete shot in the answer format instead of weak/strong pairs', () => {
        const {instructions} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(instructions).not.toContain('Weak:')
        expect(instructions).toContain('One shot as it should be written')
        for (const field of ['framing:', 'size:', 'camera:', 'view:', 'hold:', 'risky:', 'characters:', 'action:', 'person: Kara |', 'rest:'])
            expect(instructions.split('One shot as it should be written')[1]).toContain(field)
    })
})

describe('blocking first, then the shots', () => {
    test('the blocking call: the same instructions for every beat, the beat before and its ends in the input', () => {
        const first = blockingPrompt(context, beat, undefined, undefined)
        const second = blockingPrompt(context, {...beat, id: 'beat-02'}, {beatId: 'beat-01', staging: 'A hall.', ends: {Runa: 'stands at the door'}}, undefined)
        expect(second.instructions).toBe(first.instructions)
        expect(first.input).toContain('This is the first beat of the video.')
        expect(second.input).toContain('"ends":{"Runa":"stands at the door"}')
        expect(first.reasoning).toBe('low')
    })
    test('a shot call with a blocking writes neither the staging nor the ends', () => {
        const blocking = {staging: 'A hall, the door on the left.', starts: {Runa: 'stands at the door'}, ends: {Runa: 'sits by the fire'}}
        const {input} = planPrompt(context, [beat], undefined, undefined, [], {from: 4, to: 6, total: 6, written: [], blocking})
        expect(input).toContain('Blocking of this beat - fixed, keep to it:')
        expect(input).toContain('write no STAGING line and no ENDS block')
        expect(input).toContain('the last shot of the beat leaves everybody where the blocking ends them')
    })
})

describe('the music of a beat in the planner prompt', () => {
    test('per shot, who sings and whose instrument is heard - by name', () => {
        const withMusic: PlanContext = {
            ...context,
            characters: [...context.characters, {id: 'kai', name: 'Kai', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}],
            shotCounts: {'beat-01': 2},
            beatProps: {'beat-01': [{characterId: 'kai', prop: 'guitar', activePerShot: [true, false]}]},
            beatSinging: {'beat-01': {singerIds: ['runa', 'kai'], singingPerShot: [true, true], singersPerShot: [['runa'], ['runa', 'kai']]}},
        }
        const {input} = planPrompt(withMusic, [{...beat, characterIds: ['runa', 'kai']}], undefined, undefined, [], {from: 0, to: 2, total: 2, written: []})
        expect(input).toContain('"music":[{"shot":1,"sings":["Runa"],"plays":["Kai"]},{"shot":2,"sings":["Runa","Kai"],"plays":[]}]')
        expect(input).not.toContain('activePerShot')
    })

    test('an instrument heard for part of a shot: when, in seconds of the shot (#968)', () => {
        const withMusic: PlanContext = {
            ...context,
            characters: [...context.characters, {id: 'kai', name: 'Kai', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}],
            shotCounts: {'beat-01': 2},
            beatProps: {'beat-01': [{characterId: 'kai', prop: 'guitar', activePerShot: [true, true], heardPerShot: [[{start: 0, end: 2.2}], undefined]}]},
            beatSinging: {},
        }
        const {input, instructions} = planPrompt(withMusic, [{...beat, characterIds: ['runa', 'kai']}], undefined, undefined, [], {
            from: 0,
            to: 2,
            total: 2,
            written: [],
        })
        expect(input).toContain('"music":[{"shot":1,"sings":[],"plays":["Kai (0.0-2.2 s)"]},{"shot":2,"sings":[],"plays":["Kai"]}]')
        expect(instructions).toContain('A time after a name in "plays"')
    })

    test('players whose instruments are silent in every shot still get the rules: they are "playing: no"', () => {
        const silent: PlanContext = {
            ...context,
            characters: [...context.characters, {id: 'kai', name: 'Kai', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}],
            shotCounts: {'beat-01': 2},
            beatProps: {'beat-01': [{characterId: 'kai', prop: 'guitar', activePerShot: [false, false]}]},
            beatSinging: {},
        }
        const {input, instructions} = planPrompt(silent, [{...beat, characterIds: ['runa', 'kai']}], undefined, undefined, [], {
            from: 0,
            to: 2,
            total: 2,
            written: [],
        })
        expect(input).toContain('"plays":[]')
        expect(instructions).toContain('Everybody else with an instrument is "playing: no"')
        expect(instructions).toContain('A beat may list "music"')
    })

    test('the players of a band play one calm action, a hit has its form, the instrument is in their hands from the first frame (#1024)', () => {
        const band: PlanContext = {
            ...context,
            characters: [...context.characters, {id: 'kai', name: 'Kai', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}],
            shotCounts: {'beat-01': 2},
            beatProps: {'beat-01': [{characterId: 'kai', prop: 'guitar', activePerShot: [true, true]}]},
            beatSinging: {},
        }
        const {instructions} = planPrompt(band, [{...beat, characterIds: ['runa', 'kai']}], undefined, undefined, [], {from: 0, to: 2, total: 2, written: []})
        expect(instructions).toContain('as ONE calm, steady action')
        expect(instructions).toContain('never a fast run, a sweep, an arpeggio')
        expect(instructions).toContain('"playing" is the form of one hit')
        expect(instructions).toContain("in the player's hands from the first frame")
        // the hands of a solo are not an extreme close-up of the fingers on the neck
        expect(instructions).toContain('Never an extreme close-up, and never a view along the neck')
        expect(instructions).toContain('never takes its speed from a hand or an instrument')
    })

    test('the shots that open a clip are marked for a beat with players, and the rule about them is told (#1024)', () => {
        const band: PlanContext = {
            ...context,
            characters: [...context.characters, {id: 'kai', name: 'Kai', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}],
            shotCounts: {'beat-01': 4},
            clipOpens: {'beat-01': [1, 3]},
            beatProps: {'beat-01': [{characterId: 'kai', prop: 'guitar', activePerShot: [true, true, true, true]}]},
            beatSinging: {},
        }
        const call = {from: 0, to: 4, total: 4, written: []}
        const {input, instructions} = planPrompt(band, [{...beat, characterIds: ['runa', 'kai']}], undefined, undefined, [], call)
        expect(input).toContain('"opensClip":[1,3]')
        expect(instructions).toContain('A beat may list "opensClip"')
        // without a player in the beat the mark and the rule are left out, whatever the clips are
        const noPlayers = planPrompt({...band, beatProps: undefined}, [beat], undefined, undefined, [], call)
        expect(noPlayers.input).not.toContain('opensClip')
        expect(noPlayers.instructions).not.toContain('A beat may list "opensClip"')
    })

    test('how an instrument is heard in a shot is said after the name: through, single hits with silence between, quiet, who leads (#1024)', () => {
        const band: PlanContext = {
            ...context,
            characters: [...context.characters, {id: 'kai', name: 'Kai', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}],
            shotCounts: {'beat-01': 3},
            beatProps: {
                'beat-01': [
                    {
                        characterId: 'kai',
                        prop: 'guitar',
                        activePerShot: [true, true, true],
                        heardPerShot: [[{start: 0, end: 2.2}], undefined, undefined],
                        howPerShot: [{articulation: 'sustained', leads: true}, {articulation: 'hits'}, {articulation: 'partial', quiet: true}],
                    },
                ],
            },
            beatSinging: {},
        }
        const {input, instructions} = planPrompt(band, [{...beat, characterIds: ['runa', 'kai']}], undefined, undefined, [], {
            from: 0,
            to: 3,
            total: 3,
            written: [],
        })
        expect(input).toContain('"plays":["Kai (0.0-2.2 s; plays through; leads)"]')
        expect(input).toContain('"plays":["Kai (single hits with silence between)"]')
        expect(input).toContain('"plays":["Kai (quiet, under the others)"]')
        expect(instructions).toContain('"plays through" - it sounds without a pause from the first frame to the last')
        // a guitar with a pick, and nobody who does not sing opens the mouth (tides-261115: an open hand stroking the strings, a guitarist singing along)
        expect(instructions).toContain('a guitar is struck with a pick held between the thumb and the first finger')
        expect(instructions).toContain('Whoever does not sing in a shot still acts with the whole face and body')
        expect(instructions).toContain('Only the mouth stays closed in every field')
        // a drummer's "bared-teeth snarl" and an audience with "their mouths open" came out screaming (tides-261115, slot-019/024/031)
        expect(instructions).not.toContain('teeth bared')
        expect(instructions).toContain('never a dropped jaw, an open mouth, bared teeth, a snarl')
        expect(instructions).toContain('every member of a crowd or a group too')
        expect(instructions).toContain('"single hits with silence between" - "playing" is then the form of one hit')
    })

    test('a beat with no instrument of the song has none of the playing rules (#1024)', () => {
        const {instructions} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 2, total: 2, written: []})
        expect(instructions).not.toContain('as ONE calm, steady action')
        expect(instructions).not.toContain('never takes its speed from a hand or an instrument')
        expect(instructions).not.toContain('Never an extreme close-up, and never a view along the neck')
    })
})

describe('musicStretches - the music along the way for the beats', () => {
    // 60 s at 120 bpm: a bar every 2 s, quiet first half, loud second half
    const music = {durationSec: 60, downbeats: Array.from({length: 30}, (_, i) => i * 2), barEnergy: Array.from({length: 30}, (_, i) => (i < 15 ? 0.2 : 0.8))}
    test('one line per stretch with its time and mean loudness', () => {
        expect(musicStretches(music, 2)).toEqual(['0:00-0:30 loudness 0.20', '0:30-1:00 loudness 0.80'])
    })
    test('whose instrument is heard over most of a stretch', () => {
        const players = [
            {name: 'Kael', prop: 'guitar', ranges: [{start: 0, end: 60}]},
            {name: 'Mara', prop: 'drum kit', ranges: [{start: 25, end: 60}]},
        ]
        expect(musicStretches(music, 3, players)).toEqual([
            "0:00-0:20 loudness 0.20 · heard: Kael's guitar",
            "0:20-0:40 loudness 0.50 · heard: Kael's guitar, Mara's drum kit",
            "0:40-1:00 loudness 0.80 · heard: Kael's guitar, Mara's drum kit",
        ])
        expect(musicStretches(music, 1, [{name: 'Kael', prop: 'guitar', ranges: [{start: 0, end: 5}]}])[0]).toContain('heard: none of the instruments')
    })
    // tides-261115: the guitar solo at 1:56 was written as a quiet bridge, Kael playing "softly" - nothing told the beats of it
    test('where an instrument carries the part, a fill of a bar or two is no part', () => {
        const kael = {name: 'Kael', prop: 'guitar', ranges: [{start: 0, end: 60}], leads: [{start: 36, end: 48}]}
        const mara = {name: 'Mara', prop: 'drum kit', ranges: [{start: 0, end: 60}], leads: [{start: 10, end: 12}]}
        expect(musicStretches(music, 3, [kael, mara])).toEqual([
            "0:00-0:20 loudness 0.20 · heard: Kael's guitar, Mara's drum kit",
            "0:20-0:40 loudness 0.50 · heard: Kael's guitar, Mara's drum kit · leads: Kael's guitar 0:36-0:40",
            "0:40-1:00 loudness 0.80 · heard: Kael's guitar, Mara's drum kit · leads: Kael's guitar 0:40-0:48",
        ])
        const args = {durationSec: 60, beatCount: 3, characters: [], locations: [{id: 'hall', name: 'Hall'}], lyrics: '', story: 'x', performance: ''}
        expect(beatsPrompt({...args, stretches: musicStretches(music, 3, [kael])}).input).toContain(
            'Where an instrument "leads", it carries the music there - a solo',
        )
        expect(beatsPrompt({...args, stretches: musicStretches(music, 3, [mara])}).input).not.toContain('Where an instrument "leads"')
    })
    test('the beats prompt carries them and the rules that follow them', () => {
        const args = {
            durationSec: 60,
            beatCount: 2,
            characters: [{id: 'kael', name: 'Kael', role: 'guitarist'}],
            locations: [{id: 'hall', name: 'Hall'}],
            lyrics: '',
            story: 'They play.',
            performance: '',
        }
        const input = beatsPrompt({...args, stretches: musicStretches(music, 2, [{name: 'Kael', prop: 'guitar', ranges: [{start: 0, end: 60}]}])}).input
        expect(input).toContain("0:30-1:00 loudness 0.80 · heard: Kael's guitar")
        expect(input).toContain('the last beats are a last surge, not an aftermath')
        expect(input).toContain('nobody lowers, rests, sets down or silences an instrument that is still heard')
        expect(beatsPrompt(args).input).not.toContain('The music along the way')
    })

    test('stateAfter keeps the music out of its facts only when a band is on screen', () => {
        const args = {durationSec: 60, beatCount: 2, locations: [{id: 'hall', name: 'Hall'}], lyrics: '', story: 'They play.', performance: ''}
        const rule = 'A fact is never about sound or the music'
        const band = beatsPrompt({...args, characters: [{id: 'kael', name: 'Kael', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}]}).input
        const singers = beatsPrompt({...args, characters: [{id: 'kael', name: 'Kael', role: 'singer'}]}).input
        expect(band).toContain(rule)
        expect(singers).not.toContain(rule)
        expect(singers).toContain('Empty array if nothing changes.')
    })

    // "{Sera}'s violet alloy armor is now pure white": the story's look of the costume, not the picture's, went into every later clip
    // as continuity (tides-261115, slot-040)
    test('a fact about what a character wears names the change only, never the look before', () => {
        const args = {durationSec: 60, beatCount: 2, locations: [{id: 'hall', name: 'Hall'}], lyrics: '', story: 'They play.', performance: ''}
        const input = beatsPrompt({...args, characters: [{id: 'kael', name: 'Kael', role: 'singer'}]}).input
        expect(input).toContain('names only what the story changes on it')
        expect(input).toContain('never its colors, material or look before')
        expect(input).toContain('Never describe how a character looks')
    })

    // tides-261115: the cast's role kept the story's "black wet hair", the picture has silver-white hair - the beats copied the role
    test('the picture look goes with each character, and it wins over the role', () => {
        const args = {durationSec: 60, beatCount: 2, locations: [{id: 'hall', name: 'Hall'}], lyrics: '', story: 'She sings.', performance: ''}
        const characters = [{id: 'maren', name: 'Maren', role: 'a singer with black wet hair'}]
        const input = beatsPrompt({...args, characters, looks: {maren: 'long silver-white hair'}}).input
        expect(input).toContain('"looks":"long silver-white hair"')
        expect(input).toContain('that is not how they look in this video - it is left out of every field')
        expect(beatsPrompt({...args, characters}).input).not.toContain('that is not how they look in this video')
    })

    // "{Vex} has both drumsticks lifted" and "{Vex}'s drumsticks are lowered" both went into slot-040 (tides-261115)
    test('a fact quotes in "ends" the earlier facts it undoes, the schema asks for it', () => {
        const args = {durationSec: 60, beatCount: 2, locations: [{id: 'hall', name: 'Hall'}], lyrics: '', story: 'They play.', performance: ''}
        const prompt = beatsPrompt({...args, characters: [{id: 'kael', name: 'Kael', role: 'singer'}]})
        expect(prompt.input).toContain('names that one in "ends", quoted exactly as written there')
        expect(JSON.stringify(prompt.schema)).toContain('"required":["fact","kind","about","ends"]')
    })

    // "{Kael} holds his guitar at his side, not playing" despite "never where they are": a kind of its own to put it in
    test('a fact says its kind, only a fact of the place and one on a character go on', () => {
        const args = {durationSec: 60, beatCount: 2, locations: [{id: 'hall', name: 'Hall'}], lyrics: '', story: 'They play.', performance: ''}
        const prompt = beatsPrompt({...args, characters: [{id: 'kael', name: 'Kael', role: 'singer'}]})
        expect(prompt.input).toContain('Only "place" and "on them" go on to the later clips')
        expect(JSON.stringify(prompt.schema)).toContain('"kind":{"enum":["place","on them","where","doing","sound"]}')
    })
})

describe('the rules a beat needs (#825)', () => {
    const chunk = {from: 0, to: 4, total: 6, written: []}
    test('a beat of one person, without singing, props or a group, is told none of their rules', () => {
        const {instructions} = planPrompt(context, [beat], undefined, undefined, [], chunk)
        for (const rule of [
            'When a singer sings in a shot',
            '"castProps" below lists',
            'A cast entry with "group": true',
            'In a shot with three or more people',
            'A beat with "micro": true',
        ])
            expect(instructions).not.toContain(rule)
        expect(instructions.length).toBeLessThan(planInstructions.length * 0.8)
        // what every beat needs stays
        expect(instructions).toContain('Nobody walks backwards unless the beat itself says so')
        expect(instructions).toContain('SHOT <number>')
    })
    test('a beat with a singer, a group of three and a prop is told theirs', () => {
        const crowd = {
            ...context,
            characters: [
                {id: 'runa', name: 'Runa', role: 'a girl', prop: 'lute'},
                {id: 'orcs', name: 'Orcs', role: 'orcs', isGroup: true},
                {id: 'tom', name: 'Tom', role: 'a boy'},
            ],
            beatSinging: {'beat-01': {singerIds: ['runa'], singingPerShot: [true], singersPerShot: [['runa']]}},
        }
        const {instructions} = planPrompt(crowd, [{...beat, characterIds: ['runa', 'orcs', 'tom']}], undefined, undefined, [], chunk)
        for (const rule of [
            'When a singer sings in a shot',
            '"castProps" below lists',
            'A cast entry with "group": true',
            'In a shot with three or more people',
            // tides-261115 slot-040: a wide shot from the side wall put the band among the audience
            'A shot of the crowd together with the band looks along the line between them',
            'on the side the spot says they play it from, never at its back',
            // tides 028: the kit behind Kael and Sera, Vex not in the shot - Vex drawn with the bass, Sera at the kit
            'a shot whose picture shows the instrument has them at it',
            // zz-stille-261118 slot-007: "facing the proscenium wall" put the pianist at the back of the piano
            'their "frame" says how the camera sees them there',
            // tides-261115 slot-028: "near the door wall, looking up at the stage" drew the crowd on the stage around the band
            'from behind the crowd, over their heads toward the stage',
            // and the band came out big in front of the crowd it was seen over: each frame says how near
            'how near: in front, in the middle or small at the back of the picture',
        ])
            expect(instructions).toContain(rule)
    })
    // stille-im-spiegel 037/038: a guitar in one hand and the other on a friend's shoulder - the player drawn twice, or with three hands
    test('the hands do one thing: who plays touches nobody, who touches has the prop out of the hands', () => {
        expect(planInstructions).toContain(
            'Their hands do one thing at a time: whoever plays or uses their prop in a shot touches nobody and nothing else with those hands',
        )
    })
    // tides-261115: in the guitar solo Kael stood with his head bowed, "a slow, gentle pull across the strings", Sera in front
    test('a shot where somebody leads is about them, their whole body playing the part', () => {
        // in the way of the song's genre, not of a rock guitar only
        expect(planInstructions).toContain(
            "A shot where somebody leads is about them: they are in it, in front and sharp, and their whole body plays the part the way a player of this song's genre and of this instrument does in a solo",
        )
    })
    test('with everything needed the rules are the whole set', () => {
        expect(planInstructionsFor(ALL_NEEDS)).toBe(planInstructions)
    })
})
