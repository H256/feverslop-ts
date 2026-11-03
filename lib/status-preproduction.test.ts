import {describe, expect, test} from "bun:test";
import {withPreproduction} from "./status.ts";

const plain = {command: 'bun index.ts demo', why: '3 step(s) to generate'}
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '')

describe('bun run status and the preproduction', () => {
    test('planned up to a stage: it is named with the run that plans the next one; the next command stays', () => {
        const {next, notes} = withPreproduction(plain, {stage: 'cast', next: 'look', casting: {changes: [], redo: []}, storyProposal: false}, 'music', 'demo')
        expect(next).toEqual(plain)
        expect(notes.map(([label, text]) => [label, strip(text)])).toEqual([['Stage', 'planned up to the cast - next: the look (bun index.ts demo --until=look)']])
    })

    test('a casting.json not taken over yet comes first, with its --redo; a waiting story proposal is named', () => {
        const pre = {stage: 'plan' as const, casting: {changes: ['hall is played by library:hall-v2'], redo: ['blocking']}, storyProposal: true, nextCommand: 'bun index.ts demo --redo=blocking'}
        const {next, notes} = withPreproduction(plain, pre, 'music', 'demo')
        expect(next).toEqual({command: 'bun index.ts demo --redo=blocking', why: 'casting.json changed: hall is played by library:hall-v2 - planned again: blocking'})
        expect(notes.map(([label]) => label)).toEqual(['Casting', 'Story'])
    })

    test('a film names its screenplay', () => {
        const {notes} = withPreproduction(plain, {stage: 'story', next: 'cast', casting: {changes: [], redo: []}, storyProposal: false}, 'film', 'f')
        expect(strip(notes[0]![1])).toBe('planned up to the screenplay - next: the cast (bun film.ts f --until=cast)')
    })
})
