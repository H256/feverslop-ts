import {expect, test} from 'bun:test'
import {dryRun} from './dry-run.ts'

// #836: the question before a plan run asks the command's --dry-run --json; a step that is none is refused
test('the dry run of a plan run: an unknown step or scene is refused before anything runs', async () => {
    await expect(dryRun({id: 'demo', kind: 'film', dir: '/nowhere'}, {type: 'plan', scenes: ['s6 --render=all']})).rejects.toThrow('no such scenes')
    await expect(dryRun({id: 'demo', kind: 'music', dir: '/nowhere'}, {type: 'plan', redo: ['nonsense']})).rejects.toThrow('no such steps')
})
