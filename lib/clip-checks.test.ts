import {expect, test} from 'bun:test'
import {grittierJoins, type TextureJoin} from './clip-checks.ts'

const j = (to: string, kind: TextureJoin['kind'], fine: number): TextureJoin => ({from: 'x', to, kind, fine, structure: 1})

// #836: a continuing join counts as grittier only by more than clips differ at an ordinary cut anyway
test('the continuing joins grittier than an ordinary cut', () => {
    const joins = [j('a', 'cut', 0.9), j('b', 'cut', 1.1), j('c', 'cut', 1.0), j('d', 'context', 1.19), j('e', 'context', 1.25), j('f', 'last frame', 1.5)]
    expect(grittierJoins(joins).map(g => [g.to, g.usual])).toEqual([
        ['e', 1],
        ['f', 1],
    ])
    // no cut to measure by: against no change at all
    expect(grittierJoins([j('d', 'context', 1.3)]).map(g => g.to)).toEqual(['d'])
    // a cut that got grittier is no finding
    expect(grittierJoins([j('a', 'cut', 2)])).toEqual([])
})
