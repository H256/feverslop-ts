import {describe, expect, test} from 'bun:test'
import {closest, noProject, optionsIn, usageMessage} from './usage.ts'

const usage = 'bun index.ts [project-id] [--redo=story,beats] [--render=song,images] [--only=slot-001] [--again] [--refresh=pictures,clips]'

describe('usage errors', () => {
    test('an unknown option is said in our words, with the one it most likely means', () => {
        const said =
            "Unknown option '--rendr'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--rendr\"'"
        expect(usageMessage(said, usage)).toBe('Unknown option --rendr - did you mean --render?')
        expect(usageMessage("Unknown option '--agian'. To specify …", usage)).toBe('Unknown option --agian - did you mean --again?')
    })
    test('nothing near: no guess', () => {
        expect(usageMessage("Unknown option '--zzzzzz'. To specify …", usage)).toBe('Unknown option --zzzzzz')
        expect(closest('--zzzzzz', optionsIn(usage))).toBeUndefined()
    })
    test('every other message stays', () => {
        expect(usageMessage('--until: unknown "plan" - use story, cast, look', usage)).toBe('--until: unknown "plan" - use story, cast, look')
    })
    test('no project: the ones there are, what was typed as a beginning first', () => {
        expect(noProject('project', 'schwarzer', ['ab767', 'schwarzer-flur'])).toBe('No project "schwarzer" - the projects here are: schwarzer-flur, ab767')
        expect(noProject('project', undefined, ['a', 'b'])).toBe('No project id given - the projects here are: a, b')
    })
    test('no project and none there: how the first one is made', () => {
        expect(noProject('project', undefined, [])).toBe('No project id given, and there is no project yet - create one with: bun run init')
        expect(noProject('film', 'x', [])).toBe('No film "x", and there is no film yet - create one with: bun run film:init')
    })
    test('many projects: a line of them, the rest counted', () => {
        const ids = Array.from({length: 12}, (_, n) => `p${n}`)
        expect(noProject('project', undefined, ids)).toEndWith('p7 and 4 more')
    })
})
