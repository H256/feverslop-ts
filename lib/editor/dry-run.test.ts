import {expect, test} from 'bun:test'
import {dryRun} from './dry-run.ts'

// #836: the question before a plan run asks the command's --dry-run --json; a film has none as data yet, a step that is none is refused
test('the dry run of a plan run: a film has none yet, an unknown step is refused before anything runs', async () => {
    expect(await dryRun({id: 'demo', kind: 'film', dir: '/nowhere'}, {type: 'plan'})).toBeUndefined()
    await expect(dryRun({id: 'demo', kind: 'music', dir: '/nowhere'}, {type: 'plan', redo: ['nonsense']})).rejects.toThrow('no such steps')
})
