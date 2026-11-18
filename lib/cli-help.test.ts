import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {helpDetails} from './cli-help.ts'
import {FILM_STEP_NAMES} from './film/store.ts'
import {filmCommand, planCommand} from './pipeline-commands.ts'
import {STEP_NAMES} from './project.ts'

const root = join(import.meta.dir, '..')

describe.each([
    ['plan', 'index.ts', planCommand, STEP_NAMES as string[]],
    ['film', 'film.ts', filmCommand, FILM_STEP_NAMES as string[]],
] as const)('%s --help', (command, file, schema, steps) => {
    // #1154: the script parses by its schema, and the help explains every option of it - one list for both
    test('explains every option of the script', () => {
        expect(readFileSync(join(root, file), 'utf8')).toContain(`options: parseArgsOptions(${command}Command.options)`)
        const options = Object.keys(schema.options)
        expect(options).toContain('redo')
        const explained = options.filter(option => new RegExp(`^  --${option}(=\\S*)?\\s+\\S`, 'm').test(helpDetails(command)))
        expect(explained).toEqual(options)
    })
    test('names every step and only real ones', () => {
        const section = helpDetails(command).split('Steps for --redo:')[1]!.split('\n\n')[0]!
        const named = section
            .trim()
            .split('\n')
            .flatMap(line =>
                line
                    .trim()
                    .split(/\s{2,}/)[1]!
                    .replace(/ \([^)]*\)/g, '')
                    .split(', '),
            )
        expect(named.toSorted()).toEqual([...steps].toSorted())
    })
})
