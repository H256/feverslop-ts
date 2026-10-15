import {describe, expect, test} from "bun:test";
import {asBeatShots, parseShotLines, readBeatPlan} from "./shot-plan.ts";
import type {Character, StoryBeat} from "./project.ts";

const cael: Character = {id: 'cael', name: 'Cael', role: 'singer'}
const maren: Character = {id: 'maren', name: 'Maren', role: 'miner'}
const beat = {id: 'b1', characterIds: ['cael', 'maren']} as StoryBeat

describe('readBeatPlan', () => {
    test('resolves names to ids, takes the staging and the ends, pads to the shots needed and asks again', () => {
        const r = readBeatPlan({staging: 'the shaft on the left', ends: {Cael: 'stands at the shaft'}, shots: [
            {action: 'Cael lifts the hammer', characters: ['Cael', 'Maren'], people: {Cael: {state: 'stands', frame: 'left', motion: 'stays'}}, hold: true},
        ]}, beat, [cael, maren], 2)!
        // a count that does not fit is padded, and the planner is asked again
        expect(r.problems).toEqual(['shot count: needed 2, got 1'])
        expect(r.plan.shots).toHaveLength(2)
        expect(r.plan.shots[0]!.characters).toEqual(['cael', 'maren'])
        expect(r.plan.shots[0]!.people!.cael!.frame).toBe('left')
        expect(r.plan.ends).toEqual({cael: 'stands at the shaft'})
    })
    test('asks again for an unknown name, a stranger in the text and a singing shot without a singer', () => {
        const r = readBeatPlan({shots: [{action: 'Maren swings', characters: ['Cael', 'Nobody']}]}, beat, [cael, maren], 1, {singerIds: ['cael'], singingPerShot: [true]})!
        expect(r.problems.length).toBe(2)
        const q = readBeatPlan({shots: [{action: 'Maren swings', characters: ['Cael']}]}, beat, [cael, maren], 1)!
        expect(q.problems[0]).toContain('Maren')
        const none = readBeatPlan({shots: [{action: 'x', characters: ['Maren']}]}, beat, [cael, maren], 1, {singerIds: ['cael'], singingPerShot: [true]})!
        expect(none.problems[0]).toContain('sung')
    })
    test('an old plan of actions stays usable', () => {
        expect(asBeatShots(['a', 'b']).shots.map(s => s.action)).toEqual(['a', 'b'])
    })
})

describe('readBeatPlan - checks that ask again and checks that only note', () => {
    const names = ['Anna', 'Bea', 'Cora', 'Dina', 'Edda', 'Fay']
    const cast: Character[] = [...names.map(name => ({id: name.toLowerCase(), name, role: 'x'})), {id: 'orcs', name: 'Orcs', role: 'crowd', isGroup: true, alike: true}]
    const beat = {id: 'b2', characterIds: cast.map(c => c.id)} as StoryBeat
    const same = (n: string) => ({state: `stands at place ${n}`, motion: 'drives the hammer down in an overhead arc'})
    const own = (n: number) => ({state: `stands at place ${n}`, motion: `does move number ${n}`})

    test('three people with the same motion are a chorus line and are asked again', () => {
        const r = readBeatPlan({shots: [{action: 'They strike', characters: ['Anna', 'Bea', 'Cora'], people: {Anna: same('1'), Bea: same('2'), Cora: same('3')}}]}, beat, cast, 1)!
        expect(r.problems).toHaveLength(1)
        expect(r.problems[0]).toContain('Anna, Bea, Cora')
    })
    test('two people with the same motion are a note, no further call', () => {
        const r = readBeatPlan({shots: [{action: 'They strike', characters: ['Anna', 'Bea'], people: {Anna: same('1'), Bea: same('2')}}]}, beat, cast, 1)!
        expect(r.problems).toEqual([])
        expect(r.notes[0]).toContain('Anna, Bea')
    })
    test('different motions, and a crowd entry next to a person, are fine', () => {
        const r = readBeatPlan({shots: [{action: 'They strike', characters: ['Anna', 'Bea', 'Orcs'], people: {Anna: own(1), Bea: own(2), Orcs: {state: 'press in', motion: 'the first lunges, two hang back'}}}]}, beat, cast, 1)!
        expect(r.problems).toEqual([])
        expect(r.notes).toEqual([])
    })
    test('three people and one of them with an entry but no motion: a note, no further call', () => {
        const r = readBeatPlan({shots: [{action: 'Anna and Bea clear the way', characters: ['Anna', 'Bea', 'Cora'], people: {Anna: own(1), Bea: own(2), Cora: {state: 'stands at the back'}}}]}, beat, cast, 1)!
        expect(r.problems).toEqual([])
        expect(r.notes).toHaveLength(1)
        expect(r.notes[0]).toContain('Cora has no motion in a shot of 3 people')
    })
    test('two people and one of them without motion: not a note, the check is for three or more', () => {
        const r = readBeatPlan({shots: [{action: 'Anna speaks, Bea listens', characters: ['Anna', 'Bea'], people: {Anna: own(1), Bea: {state: 'stands at the back'}}}]}, beat, cast, 1)!
        expect(r.problems).toEqual([])
        expect(r.notes).toEqual([])
    })
    test('more than four own entries are cut to four by the code: singers first, then the order of the action', () => {
        const people = Object.fromEntries(names.map((n, i) => [n, own(i)]))
        const r = readBeatPlan({shots: [{action: 'Fay leads, then Edda follows', characters: names, framing: 'wide shot', people}]}, beat, cast, 1, {singerIds: ['dina'], singingPerShot: [true]})!
        expect(r.problems).toEqual([])
        expect(Object.keys(r.plan.shots[0]!.people!).sort()).toEqual(['dina', 'edda', 'fay', 'anna'].sort())
        expect(r.plan.shots[0]!.characters).toHaveLength(6)
        expect(r.notes[0]).toContain('kept without one')
    })
    test('five people in a medium shot are a note, not a question', () => {
        const r = readBeatPlan({shots: [{action: 'They march', framing: 'medium shot', characters: names.slice(0, 5)}]}, beat, cast, 1)!
        expect(r.problems).toEqual([])
        expect(r.notes[0]).toContain('5 people')
    })
    test('somebody who does not sing is described singing: a note', () => {
        const r = readBeatPlan({shots: [{action: 'They march', characters: ['Anna', 'Bea'], people: {Anna: {state: 'leads', motion: 'sings'}, Bea: {state: 'follows', motion: 'mouth open on the verse'}}}]}, beat, cast, 1, {singerIds: ['anna'], singingPerShot: [true]})!
        expect(r.problems).toEqual([])
        expect(r.notes).toHaveLength(1)
        expect(r.notes[0]).toContain('Bea')
    })
})

describe('readBeatPlan - compass words', () => {
    const a: Character = {id: 'a', name: 'Anna', role: 'x'}
    const beat = {id: 'b8', characterIds: ['a']} as StoryBeat
    test('a compass point in a shot is a note, no further call', () => {
        const r = readBeatPlan({shots: [{action: 'Anna turns to face the orc to the north', characters: ['Anna'], people: {Anna: {state: 'stands', frame: 'facing south', motion: 'steps eastward'}}}]}, beat, [a], 1)!
        expect(r.problems).toEqual([])
        expect(r.notes.some(n => n.includes('3 compass word'))).toBe(true)
    })
    test('directions as the picture shows them are fine', () => {
        const r = readBeatPlan({shots: [{action: 'Anna turns to the orc on the right of the frame', characters: ['Anna'], people: {Anna: {state: 'stands', frame: 'facing the orc', motion: 'steps toward the camera'}}}]}, beat, [a], 1)!
        expect(r.notes).toEqual([])
    })
})

describe('readBeatPlan - the rest of a shot', () => {
    const a: Character = {id: 'a', name: 'Anna', role: 'x'}
    const b: Character = {id: 'b', name: 'Bea', role: 'x'}
    const beat = {id: 'b9', characterIds: ['a', 'b']} as StoryBeat
    test('what the others do is read and kept with the shot', () => {
        const r = readBeatPlan({shots: [{action: 'Anna strikes', characters: ['Anna', 'Bea'], people: {Anna: {motion: 'strikes'}}, rest: ' Bea parries an orc and answers with the haft. '}]}, beat, [a, b], 1)!
        expect(r.plan.shots[0]!.rest).toBe('Bea parries an orc and answers with the haft.')
        expect(r.problems).toEqual([])
    })
    test('a shot without it has none', () => {
        const r = readBeatPlan({shots: [{action: 'Anna strikes', characters: ['Anna']}]}, beat, [a, b], 1)!
        expect(r.plan.shots[0]!.rest).toBeUndefined()
    })
})

describe('parseShotLines', () => {
    const answer = `STAGING: The tunnel mouth is at the left of the frame. The women stand on the shelf.
SHOT 1
framing: medium shot
camera: The camera tracks slowly from left to right.
view: From the shelf looking toward the formations.
hold: no
characters: Vael, The orcs
action: The orc lunges at Vael, blade low; she says "no" and turns to face it.
person: Vael | state: stands at the front, hammer in her right hand | frame: sharp, centre, three-quarter view | motion: turns to face the orc
person: The orcs | state: the tallest in front | frame: right of the frame | motion: lunges, blade low
rest: Brenna and Kessa hold their hammers cocked; Dara steps in on a second orc.
SHOT 2
framing: close-up
camera: held
view: tight on the arm
hold: yes
characters: Vael
action: The blade strikes her silver forearm and splits.
ENDS
end: Vael | stands at the river's edge, hammer low
end: The orcs | driven back to the water`

    test('shots, people, rest, staging and ends are read', () => {
        const r = parseShotLines(answer)
        expect(r.staging).toContain('tunnel mouth')
        expect(r.shots).toHaveLength(2)
        expect(r.shots[0]!.characters).toEqual(['Vael', 'The orcs'])
        expect(r.shots[0]!.action).toContain('"no"')
        expect(Object.keys(r.shots[0]!.people as object)).toEqual(['Vael', 'The orcs'])
        expect((r.shots[0]!.people as any).Vael.motion).toBe('turns to face the orc')
        expect(r.shots[0]!.rest).toContain('Dara steps in')
        expect(r.shots[1]!.hold).toBe(true)
        expect(r.ends).toEqual({Vael: "stands at the river's edge, hammer low", 'The orcs': 'driven back to the water'})
    })
    test('markdown around the keys and a code fence are tolerated, unknown lines skipped', () => {
        const r = parseShotLines('```\n**SHOT 1**\n- **framing:** wide shot\n- action: They run.\nnonsense without a key\n- characters: Anna and Bea\n```')
        expect(r.shots).toHaveLength(1)
        expect(r.shots[0]!.framing).toBe('wide shot')
        expect(r.shots[0]!.characters).toEqual(['Anna', 'Bea'])
    })
    test('what it reads is what readBeatPlan takes', () => {
        const a: Character = {id: 'vael', name: 'Vael', role: 'x'}
        const b: Character = {id: 'the-orcs', name: 'The orcs', role: 'crowd', isGroup: true}
        const beat = {id: 'b1', characterIds: ['vael', 'the-orcs']} as StoryBeat
        const parsed = parseShotLines(answer)
        const r = readBeatPlan({staging: parsed.staging, ends: parsed.ends, shots: parsed.shots}, beat, [a, b], 2)!
        expect(r.problems).toEqual([])
        expect(r.plan.shots[0]!.people!.vael!.motion).toBe('turns to face the orc')
        expect(r.plan.shots[0]!.rest).toContain('Brenna')
        expect(r.plan.ends).toEqual({vael: "stands at the river's edge, hammer low", 'the-orcs': 'driven back to the water'})
    })
})
