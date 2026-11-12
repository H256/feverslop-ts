import {describe, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {initOptions} from './init-options.ts'

// #827: a project made by options, nothing asked - for a script and for the workspace, which has no terminal.
const init = join(import.meta.dir, '..', 'tools', 'init.ts')
const run = (cwd: string, ...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, init, ...args], {
        cwd,
        env: {...process.env, NO_COLOR: '1', FEVERSLOP_SETTINGS: join(cwd, 'no-settings.json')},
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 20_000,
    })
    return {code: result.exitCode, out: result.stdout.toString() + result.stderr.toString()}
}

describe('init by options', () => {
    test('none of the options: the wizard asks, nothing is read from the command line', async () => {
        expect(await initOptions([])).toBeUndefined()
        expect(await initOptions(['my-project'])).toBeUndefined()
    })
    test('what is missing or wrong is said in the words of the options', async () => {
        const wrong = (argv: string[]) =>
            initOptions(argv).then(
                () => 'no error',
                (e: unknown) => (e as Error).message,
            )
        expect(await wrong(['--idea=rain'])).toContain('the project id comes first')
        expect(await wrong(['Not An Id', '--idea=rain'])).toContain('is not a project id')
        expect(await wrong(['p', '--song=missing.wav', '--lyrics=la'])).toBe('--song: no file missing.wav')
        expect(await wrong(['p', '--style=noir'])).toContain('a song (--song with --lyrics and/or --story-idea), or an idea')
        expect(await wrong(['p', '--story-idea=a walk', '--singers=auto'])).toContain('--singers needs sung lines')
        expect(await wrong(['p', '--idea=rain', '--language=klingon'])).toContain('--language')
        // a song of the library is the song, with its own lyrics (#835)
        expect(await wrong(['p', '--library-song=rain', '--idea=x'])).toContain('--library-song is the song')
        expect(await wrong(['p', '--library-song=rain', '--lyrics=la'])).toContain('brings its own lyrics')
        expect(await wrong(['p', '--library-song=../x'])).toContain('a song id of the library')
        expect(await initOptions(['p', '--library-song=rain', '--story-idea=a walk', '--language=de'])).toEqual({
            id: 'p',
            seed: {storyIdea: 'a walk', style: undefined, config: {lyricsLanguage: 'de'}},
            librarySong: 'rain',
        })
    })
    test('with no terminal and all it needs given, the project is written and the next command said', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'init-options-'))
        try {
            writeFileSync(join(cwd, 'lyrics.txt'), 'Verse 1\nRain on the glass\n')
            writeFileSync(join(cwd, 'song.mp3'), 'not really a song')
            const made = run(cwd, 'rain', '--song=song.mp3', '--lyrics=lyrics.txt', '--story-idea=A walk at night', '--singers=auto', '--language=de')
            expect(made.out).toContain('bun run plan rain')
            expect(made.code).toBe(0)
            const dir = join(cwd, 'projects', 'rain')
            expect(existsSync(join(dir, 'input', 'song.mp3'))).toBe(true)
            // a value that names a file is its text, anything else the text itself
            expect(readFileSync(join(dir, 'input', 'lyrics.txt'), 'utf8')).toBe('Verse 1\nRain on the glass')
            expect(readFileSync(join(dir, 'input', 'story-idea.txt'), 'utf8')).toBe('A walk at night')
            expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toEqual({singers: ['auto'], lyricsLanguage: 'de'})

            // a second one of the same id is refused, nothing overwritten
            const again = run(cwd, 'rain', '--idea=another')
            expect(again.code).toBe(1)
            expect(again.out).toContain('is there already')
            // and without the options there is nobody to ask
            const asked = run(cwd, 'other')
            expect(asked.code).toBe(1)
            expect(asked.out).toContain('No terminal to ask in')
            expect(asked.out).toContain('--song=<file>')
        } finally {
            rmSync(cwd, {recursive: true, force: true})
        }
    }, 60_000)
})
