import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {helpDetails} from "./cli-help.ts";
import {FILM_STEP_NAMES} from "./film/store.ts";
import {STEP_NAMES} from "./project.ts";

const root = join(import.meta.dir, '..')
// the options of a script's parseArgs call, from its source: the help cannot forget a new one
const optionsOf = (file: string) => {
    const source = readFileSync(join(root, file), 'utf8')
    const block = source.slice(source.indexOf('options: {'), source.indexOf('} catch', source.indexOf('options: {')))
    return [...block.matchAll(/^\s+'?([a-z-]+)'?: \{type:/gm)].map(match => match[1]!)
}
const common = ['verbose', 'debug', 'quiet', 'banner']

describe.each([['plan', 'index.ts', STEP_NAMES as string[]], ['film', 'film.ts', FILM_STEP_NAMES as string[]]] as const)('%s --help', (command, file, steps) => {
    test('explains every option of the script', () => {
        const options = optionsOf(file)
        expect(options).toContain('redo')
        const explained = options.filter(option => !common.includes(option)).filter(option => new RegExp(`^  --${option}(=\\S*)?\\s+\\S`, 'm').test(helpDetails(command)))
        expect(explained).toEqual(options.filter(option => !common.includes(option)))
    })
    test('names every step and only real ones', () => {
        const section = helpDetails(command).split('Steps for --redo:')[1]!.split('\n\n')[0]!
        const named = section.trim().split('\n').flatMap(line => line.trim().split(/\s{2,}/)[1]!.replace(/ \([^)]*\)/g, '').split(', '))
        expect(named.toSorted()).toEqual([...steps].toSorted())
    })
})
