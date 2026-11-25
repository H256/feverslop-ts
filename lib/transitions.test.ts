import {describe, expect, test} from 'bun:test'
import {mkdtempSync, existsSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {joinGraph, readTransitions, transitionProblem, transitionsFile, writeTransition} from './transitions.ts'

describe('the transitions of a project (#1195)', () => {
    test('written and taken away; the file goes when the last one goes', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tr-'))
        writeTransition(dir, 'slot-002', {type: 'crossfade', seconds: 0.5})
        writeTransition(dir, 'slot-003', {type: 'fade-black', seconds: 1})
        expect(readTransitions(dir).transitions).toEqual({'slot-002': {type: 'crossfade', seconds: 0.5}, 'slot-003': {type: 'fade-black', seconds: 1}})
        writeTransition(dir, 'slot-002', null)
        writeTransition(dir, 'slot-003', null)
        expect(existsSync(transitionsFile(dir))).toBe(false)
    })
    test('a wrong type or length is refused when written, and left out with its reason when read', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tr-'))
        expect(() => writeTransition(dir, 'slot-002', {type: 'wipe' as never, seconds: 1})).toThrow('type must be one of')
        expect(transitionProblem({type: 'crossfade', seconds: 9})).toContain('seconds must be')
        writeFileSync(transitionsFile(dir), JSON.stringify({a: {type: 'crossfade', seconds: 0.5}, b: {type: 'crossfade', seconds: 0}}))
        const {transitions, problems} = readTransitions(dir)
        expect(Object.keys(transitions)).toEqual(['a'])
        expect(problems).toEqual(['b: seconds must be from 0.1 to 3'])
    })
})

describe('joinGraph', () => {
    test('a cut is a concat, a transition an xfade at the end of the clip before, as long as it has frames past its end', () => {
        const {graph, extra, used} = joinGraph(
            ['a', 'b', 'c'],
            [24, 24, 24],
            24,
            {b: {type: 'crossfade', seconds: 0.5}, c: {type: 'fade-white', seconds: 1}},
            [12, 6, 0],
        )
        expect(used).toEqual({b: 12, c: 6})
        expect(extra).toEqual([12, 6, 0])
        expect(graph).toEqual([
            '[v0][v1]xfade=transition=fade:duration=0.500000:offset=1.000000[j1]',
            '[j1][v2]xfade=transition=fadewhite:duration=0.250000:offset=2.000000[out]',
        ])
    })
    test('nothing past the end: the transition stays a cut', () => {
        const {graph, used} = joinGraph(['a', 'b'], [24, 24], 24, {b: {type: 'crossfade', seconds: 0.5}}, [0, 0])
        expect(used).toEqual({b: 0})
        expect(graph).toEqual(['[v0][v1]concat=n=2:v=1:a=0[out]'])
    })
})
