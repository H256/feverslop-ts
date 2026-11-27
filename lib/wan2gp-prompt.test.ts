import {describe, expect, test} from 'bun:test'
import {wan2gpPictureOrder, wan2gpPromptInput, wan2gpPromptProblem, writeWan2gpPrompt, type PromptAsker} from './wan2gp-prompt.ts'

const pictures = [
    {kind: 'location', name: 'Laboratory'},
    {kind: 'character', name: 'Lyra'},
    {kind: 'character', name: 'Dr. Elias Voss'},
]
const good = `subject_definitions:
<Subject 1> is Lyra in <Picture 1>. <Subject 2> is Voss in <Picture 2>. <Subject 3> is the laboratory in <Picture 3>.
summary: [reference generation + audio reference] Lyra sings, Voss watches.
detailed_description: [Shot 1] Lyra sings with natural lip movements synchronized.`

describe("a clip's short prompt for wan2gp (#1214)", () => {
    test('the people first, a prop with them, a start frame next, the place last - otherwise in the order they came', () => {
        expect(wan2gpPictureOrder(pictures)).toEqual([1, 2, 0])
        expect(wan2gpPictureOrder([{kind: 'location'}, {kind: 'frame'}, {kind: 'prop'}, {kind: 'character'}])).toEqual([3, 2, 1, 0])
    })
    test('the model is told the budget and which old picture is which new one', () => {
        const input = wan2gpPromptInput('the long prompt', pictures, [1, 2, 0], 2500)
        expect(input).toContain('At most 2500 characters.')
        expect(wan2gpPromptInput('p', pictures, [1, 2, 0])).toContain('At most 2000 characters.')
        expect(input).toContain('<Picture 2> (character: Lyra) is now <Picture 1>')
        expect(input).toContain('<Picture 1> (location: Laboratory) is now <Picture 3>')
        expect(input).toContain('the long prompt')
    })
    test('code counts: length, every picture there and none beyond, no lyrics, no audio label, one shot', () => {
        expect(wan2gpPromptProblem(good, 3)).toBeUndefined()
        expect(wan2gpPromptProblem(good + 'x'.repeat(3000), 3)).toContain('the limit is 2500')
        expect(wan2gpPromptProblem(good.replace('<Picture 2>', 'the picture'), 3)).toBe('<Picture 2> is missing.')
        expect(wan2gpPromptProblem(good + ' <Picture 4>', 3)).toBe('There are only 3 pictures.')
        expect(wan2gpPromptProblem(good + ' sings <d>[German] ein Puls</d>', 3)).toBe('It still has <d> lyrics.')
        expect(wan2gpPromptProblem(good + ' <Audio 1> is the vocal', 3)).toBe('It still has an <Audio N> label.')
        expect(wan2gpPromptProblem(good + ' [Shot 2] At 00:02.618 a close-up', 3)).toBe('It still has more than one shot.')
    })
    test('a first answer over the budget is shown back with what is wrong; a second one that passes is taken', async () => {
        const inputs: string[] = []
        const answers = [good + 'x'.repeat(3000), good]
        const ask: PromptAsker = async ({input}) => (inputs.push(input), answers.shift()!)
        expect(await writeWan2gpPrompt(ask, {id: 'slot-009', prompt: 'long', assets: {pictures}})).toEqual({prompt: good})
        expect(inputs).toHaveLength(2)
        expect(inputs[1]).toContain('Your answer was:')
        expect(inputs[1]).toContain('the limit is 2500')
    })
    test('two answers that do not pass: no short prompt, and why', async () => {
        const ask: PromptAsker = async () => 'no pictures at all'
        const result = await writeWan2gpPrompt(ask, {id: 'slot-009', prompt: 'long', assets: {pictures}})
        expect(result).toEqual({problem: '<Picture 1> is missing. <Picture 2> is missing. <Picture 3> is missing.'})
    })
})
