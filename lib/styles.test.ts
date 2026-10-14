import {expect, test} from "bun:test";
import {isRealistic, pickStyle, REALISTIC_SHARE, STYLES} from "./styles.ts";
import {styleShortlistPrompt} from "./prompts.ts";

const live = STYLES.filter(isRealistic)
const artistic = STYLES.filter(s => !isRealistic(s))

// a random source that answers with the given values, then goes on with the last one
const sequence = (...values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]! }

test('the list has both kinds', () => {
    expect(live.length).toBeGreaterThan(0)
    expect(artistic.length).toBeGreaterThan(live.length)
})

test('a candidate list with both kinds draws live action below the share, artistic above it', () => {
    const candidates = [live[0]!, live[1]!, artistic[0]!, artistic[1]!, artistic[2]!]
    expect(isRealistic(pickStyle(candidates, sequence(REALISTIC_SHARE - 0.01, 0)))).toBe(true)
    expect(isRealistic(pickStyle(candidates, sequence(REALISTIC_SHARE, 0)))).toBe(false)
    expect(isRealistic(pickStyle(candidates, sequence(0, 0.99)))).toBe(true)
})

test('over many draws live action is the large majority, also from the whole list', () => {
    let seed = 42
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    const draws = Array.from({length: 2000}, () => pickStyle(undefined, random))
    const share = draws.filter(isRealistic).length / draws.length
    expect(share).toBeGreaterThan(0.8)
    expect(share).toBeLessThan(0.9)
})

test('candidates of one kind are drawn from as they are', () => {
    expect(pickStyle([artistic[0]!], sequence(0))).toBe(artistic[0]!)
    expect(pickStyle([live[0]!, live[1]!], sequence(0.99, 0.99))).toBe(live[1]!)
})

test('the shortlist prompt shows the group of every style, so the live action ones can be told', () => {
    const prompt = styleShortlistPrompt('a song', [{id: 'a', name: 'A', group: 'Live action - eras'}, {id: 'b', name: 'B'}], 5).input
    expect(prompt).toContain('- a: A [Live action - eras]')
    expect(prompt).toContain('- b: B\n')
})

test('the shortlist prompt makes live action the default', () => {
    const prompt = styleShortlistPrompt('a song', [{id: 'a', name: 'A'}], 5).input
    expect(prompt).toContain('Realistic live action is the default')
    expect(prompt).toContain('at least 3 of the 5')
    expect(prompt).not.toContain('spread over at least 3 different kinds of medium')
})
