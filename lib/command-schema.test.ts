import {describe, expect, test} from 'bun:test'
import {parseCommand, requestArgs, UsageError, usageArgs, usageOf} from './command-schema.ts'
import {introCommand, labelCommand} from './postwork/commands.ts'

// #826: one description per option - the parser, the usage and the workspace's arguments come from it.
describe('a command by its schema', () => {
    test('the usage line, groups of either-or where their first option stands', () => {
        expect(usageOf(introCommand)).toBe(
            'usage: bun run intro <id> [--film] [--from=<video>] [--file=<video>] [--fade=0.5] [--save | --save-default] [--dry-run]',
        )
        expect(usageArgs(labelCommand)).toContain('[--corner=top-right|top-left|bottom-right|bottom-left]')
    })

    test('a command line is read: flags, texts, numbers', () => {
        const args = parseCommand(labelCommand, ['my-project', '--film', '--corner=top-left', '--size=4.5', '--marker=logo.png'])
        expect(args.positionals).toEqual(['my-project'])
        expect(args.flag('film')).toBe(true)
        expect(args.flag('save')).toBe(false)
        expect(args.text('corner')).toBe('top-left')
        expect(args.number('size')).toBe(4.5)
        expect(args.number('margin')).toBeUndefined()
    })

    test('what the schema does not allow is a usage error in its words', () => {
        const wrong = (argv: string[]) => {
            try {
                parseCommand(labelCommand, argv)
            } catch (e) {
                expect(e).toBeInstanceOf(UsageError)
                return (e as Error).message
            }
            throw new Error('no error')
        }
        expect(wrong(['x', '--corner=middle'])).toBe('--corner must be one of top-right, top-left, bottom-right, bottom-left, got "middle"')
        expect(wrong(['x', '--size=big'])).toBe('--size must be a number, got "big"')
        expect(wrong(['x', '--save', '--save-default'])).toBe('--save and --save-default: one of them, not both')
        expect(wrong(['x', '--nope'])).toContain("Unknown option '--nope'")
    })

    test('asking for an option the schema does not have is a mistake of the tool, said at once', () => {
        expect(() => parseCommand(introCommand, ['x']).text('corner')).toThrow('intro has no option --corner')
    })

    test('a request of the page becomes arguments, in the order of the schema', () => {
        expect(requestArgs(labelCommand, {film: true, from: 'a-final.mp4', corner: 'top-left', size: 4, saveDefault: true})).toEqual([
            '--film',
            '--from=a-final.mp4',
            '--corner=top-left',
            '--size=4',
            '--save-default',
        ])
        // nothing said, an empty field and false are left out
        expect(requestArgs(labelCommand, {film: false, marker: '', size: undefined})).toEqual([])
        // an empty value that means something is passed on: the intro without a file is the one of the project
        expect(requestArgs(introCommand, {file: '', fade: 0.5})).toEqual(['--file=', '--fade=0.5'])
    })

    test('a request is checked by the schema: no path as a video name, no line break, no option only a terminal has', () => {
        expect(() => requestArgs(labelCommand, {from: '../other/video.mp4'})).toThrow('no such from')
        expect(() => requestArgs(labelCommand, {corner: 'middle'})).toThrow('no such corner')
        expect(() => requestArgs(labelCommand, {size: '4; rm'})).toThrow('no such size')
        expect(() => requestArgs(introCommand, {file: 'a\nb'})).toThrow('no such file')
        expect(() => requestArgs(labelCommand, {marker: 'anything'})).toThrow('no such marker')
        // --dry-run is for a terminal: asked by a page it is not passed on
        expect(requestArgs(introCommand, {dryRun: true})).toEqual([])
    })
})

// #826: the post-work tools read their command line by their schema only - an option is one entry, never parsed beside it
test('the post-work tools parse by their schema, and nothing else', async () => {
    const {readFileSync} = await import('node:fs')
    const {join} = await import('node:path')
    for (const tool of ['label', 'intro', 'credits', 'description', 'refinish']) {
        const source = readFileSync(join(import.meta.dir, '..', 'tools', `${tool}.ts`), 'utf8')
        expect(source).toContain('parseCommand(')
        expect(source.includes('parseArgs(')).toBe(false)
        expect(/Bun\.argv\.(includes|find|filter)\(/.test(source)).toBe(false)
    }
})

test('a switch and a list: on, off or not said; lines, none, or not said - parsed and asked for alike', async () => {
    const {creditsCommand} = await import('./postwork/commands.ts')
    const parsed = parseCommand(creditsCommand, ['demo', '--no-facts', '--line=one', '--line=two', '--opening'])
    expect([parsed.switched('facts'), parsed.switched('opening'), parsed.switched('end'), parsed.list('line')]).toEqual([
        false,
        true,
        undefined,
        ['one', 'two'],
    ])
    expect(parseCommand(creditsCommand, ['demo', '--no-lines']).list('line')).toEqual([])
    expect(() => parseCommand(creditsCommand, ['demo', '--facts', '--no-facts'])).toThrow('one of them, not both')
    expect(() => parseCommand(creditsCommand, ['demo', '--line=x', '--no-lines'])).toThrow('one of them, not both')
    expect(requestArgs(creditsCommand, {facts: false, opening: true, extra: []})).toEqual(['--no-lines', '--no-facts', '--opening'])
    expect(requestArgs(creditsCommand, {extra: ['one', 'two']})).toEqual(['--line=one', '--line=two'])
    expect(() => requestArgs(creditsCommand, {extra: ['a\nb']})).toThrow('one line of text each')
})
